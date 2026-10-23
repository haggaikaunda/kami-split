package graph

import (
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/banking"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph/model"
)

func mapBankingStatus(c banking.ConnectionStatus) *model.BankingConnection {
	result := &model.BankingConnection{ID: c.ID, InstitutionName: c.InstitutionName, State: c.State, Generation: c.Generation, DeletionGeneration: c.DeletionGeneration, Permission: c.Permission, Health: c.Health, Cleanup: c.Cleanup, Purge: c.Purge, SnapshotRevision: c.SnapshotRevision, Accounts: []*model.BankingAccount{}}
	for _, a := range c.Accounts {
		result.Accounts = append(result.Accounts, &model.BankingAccount{ID: a.ID, StreamID: a.StreamID, Name: a.Name, Kind: a.Kind, Currency: a.Currency, RequestedHistoryDays: a.RequestedHistoryDays, ProviderAccountID: a.ProviderAccountID, Selected: a.Selected, ImportStatus: mapBankingImportStatus(a.Status)})
	}
	return result
}

func mapBankingImportStatus(s banking.ImportStatus) *model.BankingImportStatus {
	result := &model.BankingImportStatus{
		Operation: model.BankingSyncOperation(s.Operation), ImportState: model.BankingImportState(s.ImportState), Usable: s.Usable,
		Recovery: model.BankingImportRecovery(s.Recovery), Collection: model.BankingCollectionState(s.Collection), ReportingState: model.BankingReportingState(s.ReportingState),
		Freshness: model.BankingImportFreshness(s.Freshness), Coverage: model.BankingHistoryCoverage(s.Coverage), HistoryAvailability: s.HistoryAvailability,
		RequestedAfter: s.RequestedAfter, RequestedThrough: s.RequestedThrough, CoverageAfter: s.CoverageAfter, CoverageThrough: s.CoverageThrough,
		HistoricalUpdate: model.BankingHistoricalUpdate(s.HistoricalUpdate), ProviderUpdateStatus: s.ProviderUpdateStatus,
		HistoricalUpdateAt: statusTime(s.HistoricalUpdateAt), LastLocalCommit: statusTime(s.LastLocalCommit), ProviderSuccessAt: statusTime(s.ProviderSuccessAt), ProviderFailedAt: statusTime(s.ProviderFailedAt),
		ImportRevision: s.ImportRevision, DataRevision: s.DataRevision, BindingGeneration: s.BindingGeneration, AccountGeneration: s.AccountGeneration, ReportingRevision: s.ReportingRevision, PlanRevision: s.PlanRevision,
		Intervals: []*model.BankingReportingInterval{}, DiscrepancyCount: s.DiscrepancyCount,
	}
	if s.Work != nil {
		attempts := s.Work.Attempts
		result.Attempts = &attempts
		if s.Collection == "COLLECTING" {
			result.RetryAt = statusTime(s.Work.RetryAt)
		}
	}
	for _, i := range s.Intervals {
		result.Intervals = append(result.Intervals, &model.BankingReportingInterval{BindingID: i.BindingID, AfterDate: i.AfterDate, ThroughDate: i.ThroughDate})
	}
	return result
}

func statusTime(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339Nano)
	return &formatted
}
