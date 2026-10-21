package database

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
)

// BankingSyncBatch is protected stream provenance read under a restricted lease.
// Cursor and provider identities must never enter logs or queue messages.
type BankingSyncBatch struct {
	ID          uuid.UUID `json:"batch_id"`
	BindingID   uuid.UUID `json:"binding_id"`
	Environment string    `json:"environment"`
	ItemID      string    `json:"item_id"`
	AccountID   string    `json:"account_id"`
	Cursor      string    `json:"cursor"`
}

// String redacts private stream provenance.
func (BankingSyncBatch) String() string { return "[redacted banking sync batch]" }

// GoString redacts private stream provenance in Go diagnostics.
func (b BankingSyncBatch) GoString() string { return b.String() }

// BeginBankingSync reserves a batch using a current reconcile lease. A zero ID
// means denied authority; no owner identity is supplied or impersonated.
func (d *WorkerDB) BeginBankingSync(ctx context.Context, w BankingWork, binding, batch uuid.UUID) (BankingSyncBatch, error) {
	var raw []byte
	err := d.db.pool.QueryRow(ctx, `SELECT app.banking_sync_begin($1,$2,$3,$4)`, w.ID, w.Token, binding, batch).Scan(&raw)
	var result BankingSyncBatch
	if err == nil && len(raw) > 0 {
		err = json.Unmarshal(raw, &result)
	}
	return result, err
}

// StageBankingSync stores one bounded validated page without changing sources or
// the checkpoint. Identical ordinal/payload replay is safe; changed replay fails.
func (d *WorkerDB) StageBankingSync(ctx context.Context, w BankingWork, batch uuid.UUID, ordinal int, payload []byte) (string, error) {
	var code string
	err := d.db.pool.QueryRow(ctx, `SELECT app.banking_sync_stage($1,$2,$3,$4,$5)`, w.ID, w.Token, batch, ordinal, payload).Scan(&code)
	return code, err
}

// BankingSyncCommit is one coherent local outcome. Revisions invalidate dependent
// reads; CommittedAt is local storage time, not provider coverage evidence.
type BankingSyncCommit struct {
	Code              string    `json:"code"`
	BindingID         uuid.UUID `json:"binding_id"`
	ImportRevision    int64     `json:"import_revision"`
	DataRevision      int64     `json:"data_revision"`
	ReportingRevision int64     `json:"reporting_revision"`
	CommittedAt       string    `json:"committed_at"`
}

// CommitBankingSync applies a complete batch and its checkpoint in one database
// transaction. Denied/stale/incomplete outcomes produce no current source effect.
func (d *WorkerDB) CommitBankingSync(ctx context.Context, w BankingWork, batch uuid.UUID) (BankingSyncCommit, error) {
	var raw []byte
	err := d.db.pool.QueryRow(ctx, `SELECT app.banking_sync_commit($1,$2,$3)`, w.ID, w.Token, batch).Scan(&raw)
	var result BankingSyncCommit
	if err == nil {
		err = json.Unmarshal(raw, &result)
	}
	return result, err
}

// CancelBankingSync discards uncommitted private pages under the current lease.
func (d *WorkerDB) CancelBankingSync(ctx context.Context, w BankingWork, batch uuid.UUID) (bool, error) {
	var ok bool
	err := d.db.pool.QueryRow(ctx, `SELECT app.banking_sync_cancel($1,$2,$3)`, w.ID, w.Token, batch).Scan(&ok)
	return ok, err
}

// CleanupBankingSync removes at most ten expired staging/receipt batches. Source
// history has no automatic expiry and is never affected by this housekeeping.
func (d *WorkerDB) CleanupBankingSync(ctx context.Context) (int, error) {
	var n int
	err := d.db.pool.QueryRow(ctx, `SELECT app.banking_sync_cleanup()`).Scan(&n)
	return n, err
}
