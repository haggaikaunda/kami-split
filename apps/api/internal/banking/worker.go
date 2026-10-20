package banking

import (
	"context"
	"errors"
	"math/rand/v2"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/jackc/pgx/v5"
)

// Remover is the narrow provider boundary used outside all database transactions.
// It may remove only the positively identified Item represented by Credential.
type Remover interface {
	Remove(context.Context, string, Credential) (RemovalResult, error)
}

// Worker owns one sequential durable lifecycle consumer. The caller owns the
// borrowed database/keyring/provider and must wait for Run before closing them.
type Worker struct {
	db        *database.WorkerDB
	protector *Protector
	provider  Remover
}

// NewWorker constructs a cleanup-only consumer; it grants no collection access.
func NewWorker(db *database.WorkerDB, p *Protector, provider Remover) (*Worker, error) {
	if db == nil || p == nil || provider == nil {
		return nil, errors.New("banking worker unavailable")
	}
	return &Worker{db: db, protector: p, provider: provider}, nil
}

// Run polls due work every minute and reconciles healthy binding markers on each
// poll, with a durable daily eligibility guard. onFailure owns safe diagnostics;
// it receives no provider/driver errors. Cancellation leaves claimed intent for
// lease-expiry recovery and joins every renewal goroutine before returning.
func (w *Worker) Run(ctx context.Context, onFailure func()) {
	timer := time.NewTicker(time.Minute)
	defer timer.Stop()
	for {
		if err := w.db.ReconcileBanking(ctx); err != nil && ctx.Err() == nil && onFailure != nil {
			onFailure()
		}
		for ctx.Err() == nil {
			worked, err := w.ProcessOne(ctx)
			if err != nil {
				if ctx.Err() == nil && onFailure != nil {
					onFailure()
				}
				break
			}
			if !worked {
				break
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
	}
}

// ProcessOne claims and executes one durable message. It is exposed for bounded
// startup/integration checks; production scheduling belongs to Run. Concurrent
// invocations are serialized by database leases, never process-local locks.
func (w *Worker) ProcessOne(ctx context.Context) (bool, error) {
	if worked, err := w.processEnrollment(ctx); worked || err != nil {
		return worked, err
	}
	job, err := w.db.ClaimBankingWork(ctx)
	if database.IsEmptyBankingQueue(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	workCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(45 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-workCtx.Done():
				return
			case <-ticker.C:
				ok, err := w.db.RenewBankingWork(workCtx, job)
				if err != nil || !ok {
					cancel()
					return
				}
			}
		}
	}()
	defer func() { cancel(); <-done }()
	confirmed := false
	retryAfter := time.Duration(0)
	switch job.Kind {
	case "reconcile":
		confirmed, retryAfter, err = w.observe(workCtx, job)
	case "teardown":
		confirmed, retryAfter, err = w.teardown(workCtx, job)
	case "purge":
		for workCtx.Err() == nil {
			var n int
			n, err = w.db.PurgeBankingBatch(workCtx, job)
			if err != nil || n < 0 {
				break
			}
			if n == 0 {
				confirmed = true
				break
			}
		}
	default:
		err = errors.New("unknown banking work")
	}
	if workCtx.Err() != nil {
		return true, workCtx.Err()
	}
	// Unexpected local attempts retain intent under bounded retry too. Return only
	// the local error to the owning diagnostic boundary after persistence succeeds.
	delaySeconds := retrySeconds(job.Attempts, retryAfter, rand.Float64())
	_, finishErr := w.db.FinishBankingWork(workCtx, job, confirmed, delaySeconds)
	if finishErr != nil {
		return true, finishErr
	}
	return true, err
}
func (w *Worker) teardown(ctx context.Context, job database.BankingWork) (bool, time.Duration, error) {
	protected, err := w.db.ReadCleanupCredential(ctx, job)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, -1, nil
	}
	if err != nil {
		return false, 0, err
	}
	if protected.Removed {
		return true, 0, nil
	}
	if len(protected.Ciphertext) == 0 {
		return false, -1, nil
	}
	raw, err := w.protector.decrypt(protected.Ciphertext, protected.KeyVersion, protected.OwnerID.String(), protected.ConnectionID.String(), protected.Environment)
	if err != nil {
		return false, -1, err
	}
	defer clear(raw)
	providerCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	result, providerErr := w.provider.Remove(providerCtx, protected.Environment, Credential{raw: raw})
	var removalErr *RemovalError
	if errors.As(providerErr, &removalErr) && !removalErr.Retryable {
		return false, -1, nil
	}
	// Provider failures are expected durable operation outcomes, not driver logs.
	return providerErr == nil && result.Confirmed, result.RetryAfter, nil
}

// PostgreSQL schedules whole seconds. Round conservatively after checking the
// supported provider bound, without adding to an untrusted duration (which could
// overflow). Zero preserves the explicit needs-attention outcome.
func retrySeconds(attempt int, provider time.Duration, jitter float64) int {
	if provider < 0 || provider > 7*24*time.Hour {
		return 0
	}
	delay := retryDelay(attempt, provider, jitter)
	seconds := delay / time.Second
	if delay%time.Second != 0 {
		seconds++
	}
	return int(seconds)
}

func retryDelay(attempt int, provider time.Duration, jitter float64) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 10 {
		attempt = 10
	}
	delay := time.Minute * time.Duration(1<<uint(attempt-1))
	if delay > time.Hour {
		delay = time.Hour
	}
	delay += time.Duration(float64(delay) * 0.2 * jitter)
	if delay > time.Hour {
		delay = time.Hour
	}
	if provider > delay {
		delay = provider
	}
	return delay
}

// AcceptWebhook accepts only verified routing metadata. Nil acknowledges a
// committed receipt and local lifecycle dispatch; provider cleanup remains durable.
func (s *Service) AcceptWebhook(ctx context.Context, correlation uuid.UUID, event VerifiedWebhook) error {
	ok, err := s.db.AcceptBankingWebhook(ctx, correlation, event.Environment, event.ItemID, event.BodySHA256[:], event.WebhookType, event.WebhookCode, event.AccountID, event.Revoked)
	if err != nil {
		diagnostic.Report(ctx, diagnostic.Wrap(errors.New("banking ingress unavailable"), err, "banking.webhook_accept"))
		return err
	}
	if !ok {
		return ErrWebhookMismatch
	}
	return nil
}

// Observer is the provider status boundary used for missed-notification recovery.
// Observations never themselves authorize importing or reactivate a binding.
type Observer interface {
	Observe(context.Context, string, Credential) (Observation, error)
}

func (w *Worker) observe(ctx context.Context, job database.BankingWork) (bool, time.Duration, error) {
	observer, ok := w.provider.(Observer)
	if !ok {
		return false, -1, nil
	}
	protected, err := w.db.ReadCleanupCredential(ctx, job)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, -1, nil
	}
	if err != nil {
		return false, 0, err
	}
	if len(protected.Ciphertext) == 0 {
		return false, -1, nil
	}
	raw, err := w.protector.decrypt(protected.Ciphertext, protected.KeyVersion, protected.OwnerID.String(), protected.ConnectionID.String(), protected.Environment)
	if err != nil {
		return false, -1, err
	}
	defer clear(raw)
	providerCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	result, providerErr := observer.Observe(providerCtx, protected.Environment, Credential{raw: raw})
	matching := providerErr == nil && result.ItemID == protected.ProviderItemID
	revoked := matching && result.Revoked
	healthy := matching && result.Healthy && !revoked
	// The database rechecks this exact lease/generation before status or revocation
	// dispatch. A concurrent stop/delete makes both this and final completion stale.
	if _, err := w.db.RecordBankingObservation(ctx, job, healthy, revoked); err != nil {
		return false, 0, err
	}
	if providerErr != nil {
		var typed *ObservationError
		if errors.As(providerErr, &typed) && !typed.Retryable {
			return false, -1, nil
		}
		return false, result.RetryAfter, nil
	}
	if !healthy {
		return false, -1, nil
	}
	return true, 0, nil
}
