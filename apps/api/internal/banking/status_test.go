package banking

import (
	"testing"
	"time"
)

func TestImportStatusDimensions(t *testing.T) {
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	complete := "HISTORICAL_UPDATE_COMPLETE"
	future := "FUTURE_PROVIDER_STATUS"
	for _, tc := range []struct {
		name                                                 string
		connection                                           ConnectionStatus
		status                                               ImportStatus
		selected                                             bool
		operation, recovery, freshness, coverage, historical string
		usable                                               bool
	}{
		{"queued absent", ConnectionStatus{}, ImportStatus{Work: &importWork{State: "pending", Code: "QUEUED"}}, true, "QUEUED", "WAIT", "UNKNOWN", "UNKNOWN", "UNKNOWN", false},
		{"running absent", ConnectionStatus{}, ImportStatus{Work: &importWork{State: "running", Code: "RUNNING"}}, true, "RUNNING", "WAIT", "UNKNOWN", "UNKNOWN", "UNKNOWN", false},
		{"history pending", ConnectionStatus{}, ImportStatus{Work: &importWork{State: "pending", Code: "AWAITING_PROVIDER_HISTORY", Attempts: 1}}, true, "HISTORY_PENDING", "RETRY_SCHEDULED", "UNKNOWN", "UNKNOWN", "UNKNOWN", false},
		{"retry absent", ConnectionStatus{}, ImportStatus{Work: &importWork{State: "pending", Code: "RETRYABLE", Attempts: 1}}, true, "RETRY_WAIT", "RETRY_SCHEDULED", "UNKNOWN", "UNKNOWN", "UNKNOWN", false},
		{"running with failed prior usability", ConnectionStatus{}, ImportStatus{ImportState: "failed", Work: &importWork{State: "running", Code: "RUNNING"}}, true, "RUNNING", "WAIT", "UNKNOWN", "UNKNOWN", "UNKNOWN", false},
		{"retry with unavailable prior usability", ConnectionStatus{}, ImportStatus{ImportState: "unavailable", Work: &importWork{State: "pending", Code: "RETRYABLE", Attempts: 2}}, true, "RETRY_WAIT", "RETRY_SCHEDULED", "UNKNOWN", "UNKNOWN", "UNKNOWN", false},
		{"failed usability with repair outcome", ConnectionStatus{}, ImportStatus{ImportState: "failed", Work: &importWork{State: "needs_attention", Code: "REPAIR_REQUIRED"}}, true, "NEEDS_ATTENTION", "RECONNECT", "UNKNOWN", "UNKNOWN", "UNKNOWN", false},
		{"exhaustion", ConnectionStatus{}, ImportStatus{Work: &importWork{State: "needs_attention", Code: "RETRYABLE", Attempts: 10}}, true, "NEEDS_ATTENTION", "CONTACT_SUPPORT", "UNKNOWN", "UNKNOWN", "UNKNOWN", false},
		{"repair retained", ConnectionStatus{}, ImportStatus{ImportState: "usable", LastLocalCommit: &now, Work: &importWork{State: "needs_attention", Code: "REPAIR_REQUIRED"}}, true, "NEEDS_ATTENTION", "RECONNECT", "STALE", "UNKNOWN", "UNKNOWN", true},
		{"historical complete unknown coverage", ConnectionStatus{}, ImportStatus{ImportState: "usable", LastLocalCommit: &now, HistoricalUpdateAt: &now, ProviderUpdateStatus: &complete}, true, "COMMITTED", "NONE", "OBSERVED", "UNKNOWN", "COMPLETE", true},
		{"unknown provider phase", ConnectionStatus{}, ImportStatus{ImportState: "usable", ProviderUpdateStatus: &future}, true, "COMMITTED", "NONE", "UNKNOWN", "UNKNOWN", "UNKNOWN", true},
		{"reported limited", ConnectionStatus{}, ImportStatus{ImportState: "usable", HistoryAvailability: "provider_reported"}, true, "COMMITTED", "NONE", "UNKNOWN", "LIMITED", "UNKNOWN", true},
		{"disconnected retained", ConnectionStatus{State: "stopped"}, ImportStatus{ImportState: "usable", LastLocalCommit: &now}, true, "STOPPED", "STOPPED", "STALE", "KNOWN_GAP", "UNKNOWN", true},
		{"revoked absent", ConnectionStatus{Permission: "revoked"}, ImportStatus{}, true, "STOPPED", "STOPPED", "UNKNOWN", "KNOWN_GAP", "UNKNOWN", false},
		{"deselected retained", ConnectionStatus{}, ImportStatus{ImportState: "usable"}, false, "STOPPED", "STOPPED", "STALE", "KNOWN_GAP", "UNKNOWN", true},
		{"staged usable", ConnectionStatus{}, ImportStatus{ReportingState: "staged", ImportState: "usable"}, true, "COMMITTED", "NONE", "UNKNOWN", "UNKNOWN", "UNKNOWN", true},
		{"retired retained", ConnectionStatus{}, ImportStatus{ReportingState: "retired", ImportState: "usable"}, false, "STOPPED", "STOPPED", "STALE", "UNKNOWN", "UNKNOWN", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := tc.connection
			if c.State == "" {
				c.State = "active"
			}
			if c.Permission == "" {
				c.Permission = "granted"
			}
			a := StatusAccount{Selected: tc.selected, Status: tc.status}
			if a.Status.ImportState == "" {
				a.Status.ImportState = "unknown"
			}
			if a.Status.ReportingState == "" {
				a.Status.ReportingState = "current"
			}
			deriveImportStatus(c, &a)
			got := a.Status
			if got.Operation != tc.operation || got.Recovery != tc.recovery || got.Freshness != tc.freshness || got.Coverage != tc.coverage || got.HistoricalUpdate != tc.historical || got.Usable != tc.usable {
				t.Fatalf("dimensions: operation=%s recovery=%s freshness=%s coverage=%s historical=%s usable=%v", got.Operation, got.Recovery, got.Freshness, got.Coverage, got.HistoricalUpdate, got.Usable)
			}
		})
	}
}
