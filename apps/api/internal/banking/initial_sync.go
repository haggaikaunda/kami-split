package banking

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/jackc/pgx/v5"
)

// TransactionSyncer reads one account-filtered page outside database transactions.
// The worker retains the batch's original cursor until its atomic final commit.
type TransactionSyncer interface {
	SyncTransactions(context.Context, SyncBinding, Credential, SyncCursor) (SyncPage, error)
}

// initialSync consumes the recurring exact-binding intent; the committed cursor
// determines whether this is the first batch or an incremental pass.
func (w *Worker) initialSync(ctx context.Context, job database.BankingWork) (confirmed bool, delay time.Duration, resultErr error) {
	provider, ok := w.provider.(TransactionSyncer)
	if !ok {
		return false, -1, nil
	}
	binding, err := w.db.InitialBankingTarget(ctx, job)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, -1, nil
	}
	if err != nil {
		return false, 0, err
	}
	batch, err := BeginSyncBatch(ctx, w.db, job, binding, uuid.New())
	if err != nil {
		return false, 0, err
	}
	// Interrupted attempts leave bounded staging for housekeeping. Every new attempt
	// starts from the committed checkpoint, never from a private staged page.
	committed := false
	defer func() {
		if !committed && ctx.Err() == nil {
			if _, err := CancelSyncBatch(ctx, w.db, job, batch); err != nil && resultErr == nil {
				resultErr = err
			}
		}
	}()
	if _, err := w.db.RecordInitialBankingOutcome(ctx, job, "RUNNING"); err != nil {
		return false, 0, err
	}
	cursor := batch.Cursor()
	for ordinal := 0; ordinal < 1000; ordinal++ {
		page, err := w.initialPage(ctx, job, provider, batch.Binding(), cursor)
		if err != nil {
			code, delay := initialSyncFailure(err)
			if _, recordErr := w.db.RecordInitialBankingOutcome(ctx, job, code); recordErr != nil {
				return false, 0, recordErr
			}
			var expected *SyncError
			if errors.As(err, &expected) {
				return false, delay, nil
			}
			return false, delay, err
		}
		code, err := StageSyncPage(ctx, w.db, job, batch, ordinal, cursor, page)
		if err != nil {
			return false, 0, err
		}
		if code != "READY" {
			return false, -1, nil
		}
		cursor = page.NextCursor
		if page.HasMore {
			continue
		}
		outcome, err := CommitSyncBatch(ctx, w.db, job, batch)
		if err != nil {
			return false, 0, err
		}
		committed = outcome.Code == "READY"
		return committed, -1, nil
	}
	if _, err := w.db.RecordInitialBankingOutcome(ctx, job, "INVALID_DATA"); err != nil {
		return false, 0, err
	}
	return false, -1, nil
}

func (w *Worker) initialPage(ctx context.Context, job database.BankingWork, provider TransactionSyncer, binding SyncBinding, cursor SyncCursor) (SyncPage, error) {
	// Recheck current selection, owner and all lifecycle fences before every
	// credential use. The network never holds database locks.
	protected, err := w.db.ReadInitialBankingCredential(ctx, job)
	if errors.Is(err, pgx.ErrNoRows) {
		return SyncPage{}, &SyncError{Kind: SyncReconnect}
	}
	if err != nil {
		return SyncPage{}, err
	}
	if protected.Environment != binding.Environment || protected.ProviderItemID != binding.ItemID {
		return SyncPage{}, &SyncError{Kind: SyncInvalidRequest}
	}
	raw, err := w.protector.decrypt(protected.Ciphertext, protected.KeyVersion, protected.OwnerID.String(), protected.ConnectionID.String(), protected.Environment)
	if err != nil {
		return SyncPage{}, err
	}
	defer clear(raw)
	providerCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return provider.SyncTransactions(providerCtx, binding, Credential{raw: raw}, cursor)
}

func initialSyncFailure(err error) (string, time.Duration) {
	var failure *SyncError
	if !errors.As(err, &failure) {
		return "RETRYABLE", 0
	}
	switch failure.Kind {
	case SyncNotReady:
		return "AWAITING_PROVIDER_HISTORY", failure.RetryAfter
	case SyncPaginationMutation:
		return "PAGINATION_RESTART", failure.RetryAfter
	case SyncTemporary, SyncRateLimited:
		return "RETRYABLE", failure.RetryAfter
	case SyncReconnect:
		return "REPAIR_REQUIRED", -1
	default:
		return "INVALID_DATA", -1
	}
}
