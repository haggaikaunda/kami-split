package database

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// WorkerDB owns a separate, bounded kami_worker pool with only lifecycle wrapper
// grants. It cannot impersonate a user or perform collection/source mutations.
type WorkerDB struct{ db *DB }

// OpenWorker rejects administrative/API credentials and takes ownership of its
// pool. The caller must finish worker calls before Close.
func OpenWorker(ctx context.Context, c Config) (*WorkerDB, error) {
	db, err := openRole(ctx, c, "kami_worker")
	if err != nil {
		return nil, err
	}
	return &WorkerDB{db: db}, nil
}

// Close releases the worker pool after its consumer has stopped.
func (d *WorkerDB) Close() { d.db.Close() }

// Ready probes the restricted worker connection within configured bounds.
func (d *WorkerDB) Ready(ctx context.Context) error { return d.db.Ready(ctx) }

// BankingWork contains only opaque identities and lifecycle/lease versions.
type BankingWork struct {
	ID, ConnectionID, Token uuid.UUID
	Generation              int64
	Kind                    string
	Attempts                int
}

// ClaimBankingWork atomically claims one due message with a two-minute lease.
// An empty queue returns pgx.ErrNoRows; visibility never replaces Token authority.
func (d *WorkerDB) ClaimBankingWork(ctx context.Context) (BankingWork, error) {
	var w BankingWork
	err := d.db.pool.QueryRow(ctx, `SELECT id,connection_id,generation,kind,token,attempts FROM app.banking_claim()`).Scan(&w.ID, &w.ConnectionID, &w.Generation, &w.Kind, &w.Token, &w.Attempts)
	return w, err
}

// RenewBankingWork renews only the currently unexpired random lease token.
func (d *WorkerDB) RenewBankingWork(ctx context.Context, w BankingWork) (bool, error) {
	var ok bool
	err := d.db.pool.QueryRow(ctx, `SELECT app.banking_renew($1,$2)`, w.ID, w.Token).Scan(&ok)
	return ok, err
}

// CleanupCredential contains protected server-only material for one fenced Item.
// Callers must never log it; formatting always redacts its contents.
type CleanupCredential struct {
	OwnerID, ConnectionID                   uuid.UUID
	Environment, ProviderItemID, KeyVersion string
	Removed                                 bool
	Ciphertext                              []byte
}

// String redacts all provider and credential material.
func (CleanupCredential) String() string { return "[redacted banking cleanup credential]" }

// GoString redacts Go-syntax diagnostics.
func (c CleanupCredential) GoString() string { return c.String() }

// ReadCleanupCredential authorizes cleanup even for disabled owners. It never
// grants collection authority and returns a separate durable Removed flag after confirmed teardown. Missing
// ciphertext without that proof requires attention, never guessed success.
func (d *WorkerDB) ReadCleanupCredential(ctx context.Context, w BankingWork) (CleanupCredential, error) {
	var c CleanupCredential
	err := d.db.pool.QueryRow(ctx, `SELECT owner_id,connection_id,environment,provider_item_id,key_version,ciphertext,removed FROM app.banking_cleanup_credential($1,$2)`, w.ID, w.Token).Scan(&c.OwnerID, &c.ConnectionID, &c.Environment, &c.ProviderItemID, &c.KeyVersion, &c.Ciphertext, &c.Removed)
	return c, err
}

// FinishBankingWork commits a confirmed result or safe retry under current
// generation/lease authority. delaySeconds is a minimum on unconfirmed outcomes.
func (d *WorkerDB) FinishBankingWork(ctx context.Context, w BankingWork, confirmed bool, delaySeconds int) (bool, error) {
	var ok bool
	err := d.db.pool.QueryRow(ctx, `SELECT app.banking_finish($1,$2,$3,$4)`, w.ID, w.Token, confirmed, delaySeconds).Scan(&ok)
	return ok, err
}

// PurgeBankingBatch commits bounded dependency-ordered deletion. A negative result
// means lost authority, zero means no affected private data remains.
func (d *WorkerDB) PurgeBankingBatch(ctx context.Context, w BankingWork) (int, error) {
	var n int
	err := d.db.pool.QueryRow(ctx, `SELECT app.banking_purge_batch($1,$2)`, w.ID, w.Token).Scan(&n)
	return n, err
}

// ReconcileBanking records missed work without enabling any stopped binding.
func (d *WorkerDB) ReconcileBanking(ctx context.Context) error {
	_, err := d.db.pool.Exec(ctx, `SELECT app.banking_reconcile()`)
	return err
}

// BankingWorkStatus is a safe bounded operator projection without owner, Item,
// credentials, provider payloads or private financial facts.
type BankingWorkStatus struct {
	OperationID          uuid.UUID
	Kind, State          string
	Attempts             int
	AgeSeconds, Progress int64
}

// BankingStatus returns up to 100 operations, prioritizing incomplete work before
// completed history. A full page is not an
// exhaustive queue count; callers must report that bound honestly.
func (d *WorkerDB) BankingStatus(ctx context.Context) ([]BankingWorkStatus, error) {
	rows, err := d.db.pool.Query(ctx, `SELECT operation_id,kind,state,attempts,age_seconds,progress FROM app.banking_work_status()`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []BankingWorkStatus
	for rows.Next() {
		var s BankingWorkStatus
		if err := rows.Scan(&s.OperationID, &s.Kind, &s.State, &s.Attempts, &s.AgeSeconds, &s.Progress); err != nil {
			return nil, err
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

// AcceptBankingWebhook is callable only after the sole signature verifier has
// authenticated the exact raw body. Database correlation also validates the Item,
// environment and terminal generation before accepting a durable digest receipt.
func (d *DB) AcceptBankingWebhook(ctx context.Context, correlation uuid.UUID, environment, item string, digest []byte, eventType, eventCode, accountID string, revoked bool) (bool, error) {
	if d == nil {
		return false, errors.New("banking ingress unavailable")
	}
	var accepted bool
	err := d.pool.QueryRow(ctx, `SELECT app.banking_accept_lifecycle_webhook($1,$2,$3,$4,$5,$6,$7,$8)`, correlation, environment, item, digest, eventType, eventCode, accountID, revoked).Scan(&accepted)
	return accepted, err
}

// IsEmptyBankingQueue identifies the normal empty-claim outcome.
func IsEmptyBankingQueue(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// RecordBankingObservation records safe health and dispatches positive revocation
// under the current restricted worker lease. A stale observation changes nothing;
// revocation atomically fences collection and enqueues existing narrow teardown.
func (d *WorkerDB) RecordBankingObservation(ctx context.Context, w BankingWork, healthy, revoked bool) (bool, error) {
	var ok bool
	err := d.db.pool.QueryRow(ctx, `SELECT app.banking_observation_result($1,$2,$3,$4)`, w.ID, w.Token, healthy, revoked).Scan(&ok)
	return ok, err
}
