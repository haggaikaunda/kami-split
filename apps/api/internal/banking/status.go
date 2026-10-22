package banking

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/jackc/pgx/v5"
)

// ConnectionStatus is one freshly authorized persisted snapshot. Revision changes
// invalidate the whole projection; it never grants access on subsequent reads.
type ConnectionStatus struct {
	ID                 string          `json:"id"`
	State              string          `json:"state"`
	Generation         string          `json:"generation"`
	DeletionGeneration string          `json:"deletionGeneration"`
	Permission         string          `json:"permission"`
	EnrollmentPending  bool            `json:"enrollmentPending"`
	ProviderRemoved    bool            `json:"providerRemoved"`
	Health             string          `json:"health"`
	Cleanup            string          `json:"cleanup"`
	Purge              string          `json:"purge"`
	SnapshotRevision   string          `json:"snapshotRevision"`
	Accounts           []StatusAccount `json:"accounts"`
}

// StatusAccount reuses enrollment's logical-account and immutable stream IDs.
// Each replacement stream has its own status; intervals describe one shared plan.
type StatusAccount struct {
	ID                   string       `json:"id"`
	StreamID             string       `json:"streamId"`
	Name                 string       `json:"name"`
	Kind                 string       `json:"kind"`
	Currency             string       `json:"currency"`
	RequestedHistoryDays int          `json:"requestedHistoryDays"`
	ProviderAccountID    string       `json:"providerAccountId"`
	Selected             bool         `json:"selected"`
	Status               ImportStatus `json:"status"`
}

// ImportStatus separates durable operation, usability, collection and provider
// evidence. Nil dates/timestamps mean unknown, never empty or complete history.
type ImportStatus struct {
	ReportingState       string           `json:"reportingState"`
	CollectionStopped    bool             `json:"collectionStopped"`
	ImportState          string           `json:"importState"`
	ImportRevision       string           `json:"importRevision"`
	DataRevision         string           `json:"dataRevision"`
	BindingGeneration    string           `json:"bindingGeneration"`
	AccountGeneration    string           `json:"accountGeneration"`
	ReportingRevision    string           `json:"reportingRevision"`
	PlanRevision         *string          `json:"planRevision"`
	Intervals            []StatusInterval `json:"intervals"`
	HistoryAvailability  string           `json:"historyAvailability"`
	CoverageAfter        *string          `json:"coverageAfter"`
	CoverageThrough      *string          `json:"coverageThrough"`
	RequestedAfter       *string          `json:"requestedAfter"`
	RequestedThrough     *string          `json:"requestedThrough"`
	LastLocalCommit      *time.Time       `json:"lastLocalCommit"`
	ProviderUpdateStatus *string          `json:"providerUpdateStatus"`
	ProviderSuccessAt    *time.Time       `json:"providerSuccessAt"`
	ProviderFailedAt     *time.Time       `json:"providerFailedAt"`
	HistoricalUpdateAt   *time.Time       `json:"historicalUpdateAt"`
	DiscrepancyCount     string           `json:"discrepancyCount"`
	Work                 *importWork      `json:"work"`
	Operation            string
	Recovery             string
	Freshness            string
	Coverage             string
	HistoricalUpdate     string
	Collection           string
	Usable               bool
}

// StatusInterval is a disjoint posted-date owner in the current reporting plan.
// Staged and archive-only streams never add a second reporting contribution.
type StatusInterval struct {
	BindingID   string  `json:"bindingId"`
	AfterDate   *string `json:"afterDate"`
	ThroughDate *string `json:"throughDate"`
}

type importWork struct {
	State    string     `json:"state"`
	Code     string     `json:"code"`
	Attempts int        `json:"attempts"`
	RetryAt  *time.Time `json:"retryAt"`
}

// ReadConnectionStatus reauthorizes the enabled owner and reads all lifecycle,
// account, operation and reporting facts in one statement. It performs no provider
// I/O. Deleted connections retain opaque cleanup state but expose no account data.
func (s *Service) ReadConnectionStatus(ctx context.Context, id uuid.UUID) (ConnectionStatus, Result) {
	var snapshot ConnectionStatus
	outcome := Result{Code: "NOT_FOUND"}
	err := auth.WithActor(ctx, s.db, func(tx pgx.Tx, _ auth.Actor) error {
		if _, err := tx.Exec(ctx, `SELECT app.lock_banking_owner()`); err != nil {
			return err
		}
		var raw []byte
		if err := tx.QueryRow(ctx, `SELECT app.banking_connection_status($1)`, id).Scan(&raw); err != nil {
			return err
		}
		if len(raw) == 0 {
			return nil
		}
		if err := json.Unmarshal(raw, &snapshot); err != nil {
			return err
		}
		for i := range snapshot.Accounts {
			deriveImportStatus(snapshot, &snapshot.Accounts[i])
		}
		outcome.Code = "READY"
		return nil
	})
	if err != nil {
		return ConnectionStatus{}, failure(ctx, err)
	}
	return snapshot, outcome
}

func deriveImportStatus(c ConnectionStatus, a *StatusAccount) {
	s := &a.Status
	s.Usable = s.ImportState == "usable"
	s.Collection = "COLLECTING"
	switch {
	case s.ReportingState == "retired":
		s.Collection = "RETIRED"
	case s.ReportingState == "cancelled":
		s.Collection = "CANCELLED"
	case c.Permission == "revoked":
		s.Collection = "REVOKED"
	case c.State != "active" || c.ProviderRemoved:
		s.Collection = "DISCONNECTED"
	case c.Permission != "granted" || c.EnrollmentPending:
		s.Collection = "UNKNOWN"
	case !a.Selected || s.CollectionStopped:
		s.Collection = "DESELECTED"
	case c.Health == "repair_required":
		s.Collection = "RECONNECT_REQUIRED"
	}
	s.Operation = "UNKNOWN"
	s.Recovery = "NONE"
	if s.Usable {
		s.Operation = "COMMITTED"
	}
	if s.Work != nil {
		switch s.Work.State {
		case "running":
			s.Operation = "RUNNING"
			s.Recovery = "WAIT"
		case "pending":
			s.Operation = "QUEUED"
			s.Recovery = "WAIT"
			if s.Work.Code == "AWAITING_PROVIDER_HISTORY" {
				s.Operation = "HISTORY_PENDING"
			}
			if s.Work.Attempts > 0 {
				s.Recovery = "RETRY_SCHEDULED"
				if s.Operation != "HISTORY_PENDING" {
					s.Operation = "RETRY_WAIT"
				}
			}
		case "needs_attention":
			s.Operation = "NEEDS_ATTENTION"
			s.Recovery = "CONTACT_SUPPORT"
		}
		if s.Work.Code == "REPAIR_REQUIRED" {
			s.Recovery = "RECONNECT"
		}
	}
	// Failed retained usability must not hide a live retry or its recovery action.
	if (s.ImportState == "failed" || s.ImportState == "unavailable") && (s.Work == nil || s.Work.State == "complete") {
		s.Operation = "NEEDS_ATTENTION"
		s.Recovery = "CONTACT_SUPPORT"
	}
	if s.Collection == "RECONNECT_REQUIRED" {
		s.Recovery = "RECONNECT"
	}
	if s.Collection != "COLLECTING" && s.Collection != "RECONNECT_REQUIRED" {
		s.Operation = "STOPPED"
		s.Recovery = "STOPPED"
	}
	s.Freshness = "UNKNOWN"
	if s.LastLocalCommit != nil {
		s.Freshness = "OBSERVED"
	}
	if s.Usable && (s.Collection != "COLLECTING" || s.Operation == "NEEDS_ATTENTION" || s.Recovery == "RECONNECT" || (s.ProviderFailedAt != nil && (s.ProviderSuccessAt == nil || s.ProviderFailedAt.After(*s.ProviderSuccessAt)))) {
		s.Freshness = "STALE"
	}
	s.Coverage = "UNKNOWN"
	if s.HistoryAvailability == "provider_reported" || s.CoverageAfter != nil || s.CoverageThrough != nil {
		s.Coverage = "LIMITED"
	}
	if c.Permission == "revoked" || c.State == "stopped" || s.Collection == "DESELECTED" {
		s.Coverage = "KNOWN_GAP"
	}
	s.HistoricalUpdate = "UNKNOWN"
	if s.ProviderUpdateStatus != nil {
		switch *s.ProviderUpdateStatus {
		case "NOT_READY":
			s.HistoricalUpdate = "PENDING"
		case "INITIAL_UPDATE_COMPLETE":
			s.HistoricalUpdate = "INITIAL_AVAILABLE"
		case "HISTORICAL_UPDATE_COMPLETE":
			s.HistoricalUpdate = "COMPLETE"
		}
	}
	if s.HistoricalUpdateAt != nil {
		s.HistoricalUpdate = "COMPLETE"
	}
	s.ReportingState = strings.ToUpper(s.ReportingState)
	s.ImportState = strings.ToUpper(s.ImportState)
}
