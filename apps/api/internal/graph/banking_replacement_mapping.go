package graph

import (
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/banking"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph/model"
	"strconv"
)

func parseReplacementRequest(input model.BankingReplacementRequest) (banking.ReplacementRequest, bool) {
	account, err := uuid.Parse(input.AccountID)
	request := banking.ReplacementRequest{AccountID: account, Action: string(input.Action)}
	if err != nil || account == uuid.Nil {
		return request, false
	}
	if input.BindingID != nil {
		request.BindingID, err = uuid.Parse(*input.BindingID)
		if err != nil {
			return request, false
		}
	}
	if input.TransitionDate != nil {
		request.TransitionDate = *input.TransitionDate
	}
	return request, true
}
func parseReplacementConfirmation(input model.ConfirmBankingReplacementInput) (banking.ReplacementConfirmation, bool) {
	var command banking.ReplacementConfirmation
	if input.Request == nil || input.Expected == nil {
		return command, false
	}
	var err error
	command.AttemptID, err = uuid.Parse(input.AttemptID)
	if err != nil {
		return command, false
	}
	request, ok := parseReplacementRequest(*input.Request)
	if !ok {
		return command, false
	}
	command.Request = request
	e := input.Expected
	command.Expected = banking.ReplacementRevisions{Plan: e.Plan, Import: e.Import, Data: e.Data, Annotation: e.Annotation, Lifecycle: e.Lifecycle}
	return command, true
}
func mapReplacementResult(result banking.Result) *model.BankingReplacementResult {
	mapped := &model.BankingReplacementResult{Code: result.Code}
	if result.ID != uuid.Nil {
		id := result.ID.String()
		mapped.ResultID = &id
	}
	return mapped
}
func mapReplacementImpact(i banking.ReplacementImpact) *model.BankingReplacementImpact {
	return &model.BankingReplacementImpact{Count: i.Count, FromDate: i.FromDate, ThroughDate: i.ThroughDate, SpendingMinor: i.SpendingMinor, AnnotationCount: i.AnnotationCount, PendingCount: i.PendingCount, UnresolvedCount: i.UnresolvedCount}
}
func mapReplacementPreview(p banking.ReplacementPreview) *model.BankingReplacementPreview {
	result := &model.BankingReplacementPreview{Code: p.Code}
	if p.Code != "READY" {
		return result
	}
	revision := strconv.FormatInt(p.ReportingRevision, 10)
	result.ReportingRevision = &revision
	result.Revisions = &model.BankingReplacementRevisions{Plan: p.Revisions.Plan, Import: p.Revisions.Import, Data: p.Revisions.Data, Annotation: p.Revisions.Annotation, Lifecycle: p.Revisions.Lifecycle}
	result.Intervals = []*model.BankingReportingInterval{}
	for _, i := range p.Intervals {
		result.Intervals = append(result.Intervals, &model.BankingReportingInterval{BindingID: i.BindingID.String(), AfterDate: i.AfterDate, ThroughDate: i.ThroughDate})
	}
	result.Prior = mapReplacementImpact(p.Prior)
	result.Proposed = mapReplacementImpact(p.Proposed)
	result.Retained = mapReplacementImpact(p.Retained)
	result.New = mapReplacementImpact(p.New)
	result.Archived = mapReplacementImpact(p.Archived)
	result.Overlap = mapReplacementImpact(p.Overlap)
	result.OldAfterBoundary = mapReplacementImpact(p.OldAfterBoundary)
	result.Coverage = &p.Coverage
	result.CoverageAfter = p.CoverageAfter
	result.CoverageThrough = p.CoverageThrough
	result.DiscrepancyCount = &p.DiscrepancyCount
	result.CollectionState = &p.CollectionState
	return result
}
