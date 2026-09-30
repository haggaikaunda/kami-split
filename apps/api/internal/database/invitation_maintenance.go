package database

import (
	"context"
)

// PurgeInvitationDelivery removes encrypted snapshots whose bounded recovery
// window ended. This narrow operation discloses no recipient or capability data.
func (d *DB) PurgeInvitationDelivery(ctx context.Context) error {
	_, err := d.pool.Exec(ctx, `SELECT app.invitation_purge()`)
	return err
}
