package database

import (
	"context"

	"github.com/google/uuid"
)

// InitialBankingTarget returns only the exact current binding for a live initial
// import lease. No caller-supplied identity can expand collection scope.
func (d *WorkerDB) InitialBankingTarget(ctx context.Context, w BankingWork) (uuid.UUID, error) {
	var id uuid.UUID
	err := d.db.pool.QueryRow(ctx, `SELECT target FROM app.banking_initial_target($1,$2) AS target WHERE target IS NOT NULL`, w.ID, w.Token).Scan(&id)
	return id, err
}

// ReadInitialBankingCredential rechecks collection authority before each provider
// request. Cleanup authority alone can never expose an initial-import credential.
func (d *WorkerDB) ReadInitialBankingCredential(ctx context.Context, w BankingWork) (CleanupCredential, error) {
	var c CleanupCredential
	err := d.db.pool.QueryRow(ctx, `SELECT owner_id,connection_id,environment,provider_item_id,key_version,ciphertext,removed FROM app.banking_initial_credential($1,$2)`, w.ID, w.Token).Scan(&c.OwnerID, &c.ConnectionID, &c.Environment, &c.ProviderItemID, &c.KeyVersion, &c.Ciphertext, &c.Removed)
	return c, err
}

// RecordInitialBankingOutcome persists an allowlisted attempt fact under the
// current lease. Operation state/retry budget remain owned by the durable queue.
func (d *WorkerDB) RecordInitialBankingOutcome(ctx context.Context, w BankingWork, code string) (bool, error) {
	var ok bool
	err := d.db.pool.QueryRow(ctx, `SELECT app.banking_initial_outcome($1,$2,$3)`, w.ID, w.Token, code).Scan(&ok)
	return ok, err
}
