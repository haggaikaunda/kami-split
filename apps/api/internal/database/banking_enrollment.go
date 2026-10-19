package database

import (
	"context"
	"github.com/google/uuid"
)

// EnrollmentWork contains only the restricted cleanup correlation and lease.
// It never grants collection or authority over unrelated provider Items.
type EnrollmentWork struct {
	ID, OwnerID, Token              uuid.UUID
	ConnectionID                    *uuid.UUID
	Environment, UserID, WebhookURL string
	Attempts                        int
	ForceDiscovery                  bool
}

// String redacts provider correlation metadata.
func (EnrollmentWork) String() string { return "[redacted banking enrollment work]" }

// GoString redacts Go-syntax diagnostics.
func (e EnrollmentWork) GoString() string { return e.String() }

// ClaimEnrollment leases durable enrollment recovery, including disabled owners.
func (d *WorkerDB) ClaimEnrollment(ctx context.Context) (EnrollmentWork, error) {
	var e EnrollmentWork
	err := d.db.pool.QueryRow(ctx, `SELECT id,owner_id,lease_token,connection_id,environment,user_id,webhook_url,force_discovery FROM app.banking_enrollment_claim()`).Scan(&e.ID, &e.OwnerID, &e.Token, &e.ConnectionID, &e.Environment, &e.UserID, &e.WebhookURL, &e.ForceDiscovery)
	if err == nil {
		err = d.db.pool.QueryRow(ctx, `SELECT app.banking_enrollment_attempts($1,$2)`, e.ID, e.Token).Scan(&e.Attempts)
	}
	return e, err
}

// FinishEnrollment commits narrow removal evidence or preserves uncertain intent.
func (d *WorkerDB) FinishEnrollment(ctx context.Context, e EnrollmentWork, items []string, delay int) (bool, error) {
	var ok bool
	err := d.db.pool.QueryRow(ctx, `SELECT app.banking_enrollment_recovery_finish($1,$2,$3,$4)`, e.ID, e.Token, items, delay).Scan(&ok)
	return ok, err
}

// RecordEnrollmentTargets persists positive correlation before external removal.
func (d *WorkerDB) RecordEnrollmentTargets(ctx context.Context, e EnrollmentWork, items []string) (bool, error) {
	var ok bool
	err := d.db.pool.QueryRow(ctx, `SELECT app.banking_enrollment_targets($1,$2,$3)`, e.ID, e.Token, items).Scan(&ok)
	return ok, err
}

// RenewEnrollment maintains the current cleanup lease without changing its budget.
func (d *WorkerDB) RenewEnrollment(ctx context.Context, e EnrollmentWork) (bool, error) {
	var ok bool
	err := d.db.pool.QueryRow(ctx, `SELECT app.banking_enrollment_renew($1,$2)`, e.ID, e.Token).Scan(&ok)
	return ok, err
}
