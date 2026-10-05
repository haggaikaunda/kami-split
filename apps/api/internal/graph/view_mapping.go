package graph

import (
	"context"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph/model"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
)

func (r *Resolver) expenseView(ctx context.Context, scope string, first int, after *string, filter *model.StructuredExpenseFilter) (model.ExpenseViewResult, error) {
	if r.Expenses == nil {
		return problem(ctx, expense.Failure("UNAVAILABLE")), nil
	}
	request := expense.ExpenseViewRequest{Scope: scope, First: first}
	if after != nil {
		request.After = *after
		request.HasAfter = true
	}
	if filter != nil {
		if filter.GroupID != nil {
			request.Filter.GroupID = *filter.GroupID
		}
		if filter.MemberID != nil {
			request.Filter.MemberID = *filter.MemberID
		}
		if filter.From != nil {
			request.Filter.From = string(*filter.From)
		}
		if filter.To != nil {
			request.Filter.To = string(*filter.To)
		}
		if filter.Category != nil {
			request.Filter.Category = string(*filter.Category)
		}
	}
	out, err := r.Expenses.ReadExpenseView(ctx, request, r.Cursors)
	if err != nil {
		return problem(ctx, err), nil
	}
	result := &model.ExpenseView{TotalExpenseMinor: ledger.MinorUnits(out.Total), ExpenseCount: ledger.MinorUnits(out.Count), Months: []*model.ExpenseMonth{}, Edges: []*model.ExpenseViewEdge{}, PageInfo: &model.PageInfo{HasNextPage: out.HasNext, HasPreviousPage: out.HasPrevious}}
	for _, m := range out.Months {
		result.Months = append(result.Months, &model.ExpenseMonth{Month: m.Month, TotalExpenseMinor: ledger.MinorUnits(m.Total), ExpenseCount: ledger.MinorUnits(m.Count)})
	}
	for _, e := range out.Edges {
		kind, trip := mapTrip(e.Source.Trip)
		source := &model.GroupSummary{ID: e.Source.ID, Name: e.Source.Name, Currency: model.Currency(e.Source.Currency), Kind: kind, Trip: trip, IsHousehold: e.Source.IsHousehold}
		result.Edges = append(result.Edges, &model.ExpenseViewEdge{Cursor: e.Cursor, Node: mapExpense(e.Record, members(expense.Snapshot{Members: e.Members})), Source: source})
	}
	if len(result.Edges) > 0 {
		result.PageInfo.StartCursor = &result.Edges[0].Cursor
		result.PageInfo.EndCursor = &result.Edges[len(result.Edges)-1].Cursor
	}
	return result, nil
}
