package database

import (
	"context"
	"time"
)

// PurgeInvitationDelivery removes encrypted snapshots whose bounded recovery
// window ended. This narrow operation discloses no recipient or capability data.
func (d *DB) PurgeInvitationDelivery(ctx context.Context) error {
	_, err := d.Pool.Exec(ctx, `SELECT app.invitation_purge()`)
	return err
}

// RunInvitationMaintenance is owned by the server lifecycle. It purges at startup
// and once per minute until cancellation; failures retry on the next bounded tick.
// Claims independently deny deadline-expired material even during an outage.
func (d *DB) RunInvitationMaintenance(ctx context.Context, report func()) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		probe, cancel := context.WithTimeout(ctx, 10*time.Second)
		err := d.PurgeInvitationDelivery(probe)
		cancel()
		if err != nil && ctx.Err() == nil && report != nil {
			report()
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
