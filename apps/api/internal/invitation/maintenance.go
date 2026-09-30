package invitation

import (
	"context"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
)

// RunMaintenance is owned by the server lifecycle. It purges at startup
// and once per minute until cancellation; failures retry on the next bounded tick.
// Claims independently deny deadline-expired material even during an outage.
func RunMaintenance(ctx context.Context, db *database.DB, report func()) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		probe, cancel := context.WithTimeout(ctx, 10*time.Second)
		err := db.PurgeInvitationDelivery(probe)
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
