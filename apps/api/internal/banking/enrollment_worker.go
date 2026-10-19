package banking

import (
	"context"
	"errors"
	"math/rand/v2"
	"time"

	"github.com/jackc/pgx/v5"
)

func (w *Worker) processEnrollment(ctx context.Context) (bool, error) {
	job, err := w.db.ClaimEnrollment(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
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
				ok, err := w.db.RenewEnrollment(workCtx, job)
				if err != nil || !ok {
					cancel()
					return
				}
			}
		}
	}()
	defer func() { cancel(); <-done }()
	ctx = workCtx
	provider, ok := w.provider.(EnrollmentProvider)
	retryAfter := time.Duration(0)
	delay := 60
	confirmed := []string{}
	if !ok {
		delay = 0
	} else if job.ConnectionID == nil || job.ForceDiscovery {
		correlation := EnrollmentCorrelation{UserID: job.UserID, ClientUserID: "kami-" + job.OwnerID.String() + "-" + job.Environment, WebhookURL: job.WebhookURL}
		caps := provider.EnrollmentCapabilities()
		if !caps.UserScopedDiscovery || !caps.UserScopedRemoval {
			delay = 0
			err = &EnrollmentError{}
		}
		if err == nil && correlation.UserID == "" {
			correlation.UserID, err = provider.EnsureUser(ctx, job.Environment, correlation.ClientUserID)
		}
		if err == nil {
			var items []string
			items, err = provider.Discover(ctx, job.Environment, correlation)
			if err == nil {
				targets := make([]string, 0, len(items))
				for _, item := range items {
					if item != job.PreservedItemID {
						targets = append(targets, item)
					}
				}
				items = targets
				persisted, recordErr := w.db.RecordEnrollmentTargets(ctx, job, items)
				if recordErr != nil {
					return true, recordErr
				}
				if !persisted {
					return true, errors.New("banking enrollment lease unavailable")
				}
				for _, item := range items {
					var result RemovalResult
					result, err = provider.RemoveDiscovered(ctx, job.Environment, correlation, item)
					if result.RetryAfter > retryAfter {
						retryAfter = result.RetryAfter
					}
					if err != nil || !result.Confirmed {
						break
					}
					confirmed = append(confirmed, item)
				}
			}
		}
		if err != nil {
			var typed *EnrollmentError
			var removal *RemovalError
			if errors.As(err, &typed) && typed.RetryAfter > retryAfter {
				retryAfter = typed.RetryAfter
			}
			if (errors.As(err, &typed) && !typed.Retryable) || (errors.As(err, &removal) && !removal.Retryable) {
				delay = 0
			}
		}
	}
	// Empty discovery never proves absence. One-Item Link with confirmed narrow
	// removal permits retry; a lost removal acknowledgement retains uncertainty.
	if delay != 0 {
		delay = retrySeconds(job.Attempts, retryAfter, rand.Float64())
	}
	if ctx.Err() != nil {
		return true, ctx.Err()
	}
	_, finishErr := w.db.FinishEnrollment(ctx, job, confirmed, delay)
	return true, finishErr
}
