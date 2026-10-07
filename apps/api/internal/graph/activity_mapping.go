package graph

import (
	"context"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph/model"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
)

func (r *queryResolver) activity(ctx context.Context, group string, first int, after *string, filter *model.ActivityFilter) model.ActivityResult {
	if r.Expenses == nil || r.Cursors == nil {
		return problem(ctx, expense.Failure("UNAVAILABLE"))
	}
	in := expense.ActivityRequest{GroupID: group, First: first}
	if after != nil {
		in.After = *after
	}
	if filter != nil {
		if filter.Kind != nil {
			in.Kind = string(*filter.Kind)
		}
		if filter.SourceGroupID != nil {
			in.SourceID = *filter.SourceGroupID
		}
	}
	page, err := r.Expenses.ReadActivity(ctx, in, r.Cursors)
	if err != nil {
		return problem(ctx, err)
	}
	out := &model.ActivityConnection{Edges: []*model.ActivityEdge{}, PageInfo: &model.PageInfo{HasNextPage: page.HasNext, HasPreviousPage: in.After != ""}}
	for i, e := range page.Events {
		event := mapActivityEvent(e)
		out.Edges = append(out.Edges, &model.ActivityEdge{Cursor: page.Cursors[i], Node: event})
	}
	if len(out.Edges) > 0 {
		out.PageInfo.StartCursor = &out.Edges[0].Cursor
		out.PageInfo.EndCursor = &out.Edges[len(out.Edges)-1].Cursor
	}
	return out
}
func activityIdentity(in *expense.ActivityIdentity) *model.ActivityIdentity {
	if in == nil {
		return nil
	}
	return &model.ActivityIdentity{ID: in.ID, DisplayName: in.DisplayName}
}

func mapActivityEvent(e expense.ActivityEvent) *model.ActivityEvent {
	event := &model.ActivityEvent{ID: e.ID, RecordID: e.RecordID, Kind: model.ActivityKind(e.Kind), GroupID: e.GroupID, GroupName: e.GroupName, GroupKind: model.GroupKind(e.GroupKind), IsHousehold: e.IsHousehold, AmountMinor: ledger.MinorUnits(e.AmountMinor), Currency: model.Currency(e.Currency), EffectiveDate: ledger.Date(e.EffectiveDate), Timestamp: ledger.DateTime(e.Timestamp), Creator: activityIdentity(e.Creator), Payer: activityIdentity(e.Payer), Sender: activityIdentity(e.Sender), Recipient: activityIdentity(e.Recipient)}
	event.Description = e.Description
	event.Note = e.Note
	event.Before = activitySnapshot(e.Before, e.SnapshotMembers)
	event.After = activitySnapshot(e.After, e.SnapshotMembers)
	return event
}

func activitySnapshot(r *expense.Record, profiles []expense.Member) *model.ActivityExpenseSnapshot {
	if r == nil {
		return nil
	}
	labels := make(map[string]*model.ActivityIdentity, len(profiles))
	for _, m := range profiles {
		labels[m.ID] = &model.ActivityIdentity{ID: m.ID, DisplayName: m.DisplayName}
	}
	snapshot := &model.ActivityExpenseSnapshot{Description: r.Description, TotalMinor: ledger.MinorUnits(r.TotalMinor), EffectiveDate: ledger.Date(r.EffectiveDate), Category: model.Category(r.Category), Note: r.Note, Payer: labels[r.PayerMembershipID], Split: model.SplitMode(r.Split), Allocations: []*model.ActivityAllocation{}}
	for _, a := range r.Allocations {
		snapshot.Allocations = append(snapshot.Allocations, &model.ActivityAllocation{Participant: labels[a.ParticipantID], AmountMinor: ledger.MinorUnits(a.Amount), PercentageHundredths: percentageValue(*r, a.ParticipantID)})
	}
	return snapshot
}
