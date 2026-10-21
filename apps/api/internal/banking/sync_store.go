package banking

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
)

// SyncBatch retains database-authorized provenance for the complete page sequence.
// Copies contain no mutable slices. It grants no authority without its worker lease.
type SyncBatch struct {
	id      uuid.UUID
	binding SyncBinding
	cursor  SyncCursor
}

// String redacts private identities and checkpoint material.
func (SyncBatch) String() string { return "[redacted banking sync batch]" }

// GoString redacts Go-syntax diagnostics.
func (b SyncBatch) GoString() string { return b.String() }

// Binding supplies the exact account-filtered provider identity authorized by storage.
func (b SyncBatch) Binding() SyncBinding { return b.binding }

// Cursor supplies the original protected checkpoint for this entire batch.
func (b SyncBatch) Cursor() SyncCursor { return b.cursor }

// BeginSyncBatch binds a caller-known batch ID to one current collection lease and
// persisted stream. Provider calls must occur after this method returns.
func BeginSyncBatch(ctx context.Context, db *database.WorkerDB, work database.BankingWork, binding, id uuid.UUID) (SyncBatch, error) {
	stored, err := db.BeginBankingSync(ctx, work, binding, id)
	if err != nil {
		return SyncBatch{}, err
	}
	if stored.ID == uuid.Nil {
		return SyncBatch{}, &SyncError{Kind: SyncInvalidRequest}
	}
	identity := SyncBinding{BindingID: stored.BindingID.String(), Environment: stored.Environment, ItemID: stored.ItemID, AccountID: stored.AccountID}
	cursor, err := NewSyncCursor(identity, stored.Cursor)
	if err != nil {
		return SyncBatch{}, err
	}
	return SyncBatch{id: stored.ID, binding: identity, cursor: cursor}, nil
}

type syncStoredChange struct {
	Operation      string  `json:"operation"`
	ID             string  `json:"id"`
	AccountID      *string `json:"account_id,omitempty"`
	Amount         *string `json:"amount_minor,omitempty"`
	Currency       string  `json:"currency,omitempty"`
	Date           string  `json:"date,omitempty"`
	Pending        *bool   `json:"pending,omitempty"`
	PendingID      *string `json:"pending_transaction_id,omitempty"`
	AuthorizedDate *string `json:"authorized_date,omitempty"`
	Name           *string `json:"name,omitempty"`
	MerchantName   *string `json:"merchant_name,omitempty"`
	Code           *string `json:"transaction_code,omitempty"`
}

type syncStoredPage struct {
	From    string             `json:"from_cursor"`
	Next    string             `json:"next_cursor"`
	More    bool               `json:"has_more"`
	Changes []syncStoredChange `json:"changes"`
	Status  *string            `json:"update_status,omitempty"`
	Success *time.Time         `json:"provider_success_at,omitempty"`
	Failed  *time.Time         `json:"provider_failed_at,omitempty"`
}

func encodeSyncPage(batch SyncBatch, from SyncCursor, page SyncPage) ([]byte, error) {
	if batch.id == uuid.Nil || page.Binding != batch.binding || from.binding != batch.binding || page.NextCursor.binding != batch.binding {
		return nil, &SyncError{Kind: SyncInvalidRequest}
	}
	payload := syncStoredPage{From: from.value, Next: page.NextCursor.value, More: page.HasMore, Changes: []syncStoredChange{}, Status: page.UpdateStatus, Success: page.Freshness.LastSuccessfulUpdate, Failed: page.Freshness.LastFailedUpdate}
	for _, group := range []struct {
		operation string
		rows      []SyncTransaction
	}{{"added", page.Added}, {"modified", page.Modified}} {
		for _, row := range group.rows {
			amount := strconv.FormatInt(row.AmountMinor, 10)
			payload.Changes = append(payload.Changes, syncStoredChange{Operation: group.operation, ID: row.TransactionID, AccountID: &row.AccountID, Amount: &amount, Currency: row.Currency, Date: row.Date, Pending: &row.Pending, PendingID: row.PendingTransactionID, AuthorizedDate: row.AuthorizedDate, Name: row.Name, MerchantName: row.MerchantName, Code: row.TransactionCode})
		}
	}
	for _, row := range page.Removed {
		payload.Changes = append(payload.Changes, syncStoredChange{Operation: "removed", ID: row.TransactionID, AccountID: row.AccountID})
	}
	return json.Marshal(payload)
}

// StageSyncPage persists one page against its exact input cursor. Storage checks
// sequence, facts, page bounds and lease again; no source or checkpoint is visible.
func StageSyncPage(ctx context.Context, db *database.WorkerDB, work database.BankingWork, batch SyncBatch, ordinal int, from SyncCursor, page SyncPage) (string, error) {
	raw, err := encodeSyncPage(batch, from, page)
	if err != nil {
		return "INVALID_BATCH", err
	}
	return db.StageBankingSync(ctx, work, batch.id, ordinal, raw)
}

// CommitSyncBatch commits all validated pages and final cursor once under current
// lifecycle and reporting fences. It performs no provider I/O or retry.
func CommitSyncBatch(ctx context.Context, db *database.WorkerDB, work database.BankingWork, batch SyncBatch) (database.BankingSyncCommit, error) {
	return db.CommitBankingSync(ctx, work, batch.id)
}

// CancelSyncBatch discards the entire uncommitted sequence, including on provider
// pagination mutation. Restart must use a fresh batch and its stored original cursor.
func CancelSyncBatch(ctx context.Context, db *database.WorkerDB, work database.BankingWork, batch SyncBatch) (bool, error) {
	return db.CancelBankingSync(ctx, work, batch.id)
}
