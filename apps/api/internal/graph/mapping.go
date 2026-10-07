package graph

import (
	"context"
	"errors"
	"math"
	"strings"

	"github.com/99designs/gqlgen/graphql"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph/model"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/vektah/gqlparser/v2/gqlerror"
)

func problem(ctx context.Context, err error) *model.Problem {
	diagnostic.Report(ctx, err)
	code := model.ProblemCodeUnavailable
	var failure expense.Failure
	if errors.As(err, &failure) {
		code = model.ProblemCode(failure)
	}
	return &model.Problem{Code: code, Message: "The requested operation is unavailable."}
}
func fieldError(code string) error {
	return &gqlerror.Error{Message: "The requested field is unavailable.", Extensions: map[string]any{"code": code}}
}
func members(s expense.Snapshot) map[string]*model.Membership {
	result := make(map[string]*model.Membership, len(s.Members))
	for _, m := range s.Members {
		result[m.ID] = &model.Membership{ID: m.ID, DisplayName: m.DisplayName, Status: model.MembershipStatus(m.Status), Role: model.MembershipRole(m.Role), CanParticipate: m.CanParticipate}
	}
	return result
}
func mapExpense(r expense.Record, m map[string]*model.Membership) *model.Expense {
	e := &model.Expense{ID: r.ExpenseID, GroupID: r.GroupID, TotalMinor: ledger.MinorUnits(r.TotalMinor), Currency: model.Currency(r.Currency), Description: r.Description, EffectiveDate: ledger.Date(r.EffectiveDate), Category: model.Category(r.Category), Note: r.Note, Payer: m[r.PayerMembershipID], Creator: m[r.CreatorMembershipID], Split: model.SplitMode(r.Split), CreatedAt: ledger.DateTime(r.CommittedAt), Allocations: []*model.Allocation{}}
	for _, a := range r.Allocations {
		e.Allocations = append(e.Allocations, &model.Allocation{Participant: m[a.ParticipantID], AmountMinor: ledger.MinorUnits(a.Amount), PercentageHundredths: percentageValue(r, a.ParticipantID)})
	}
	return e
}
func mapGroup(ctx context.Context, s expense.Snapshot) *model.Group {
	m := members(s)
	kind, trip := mapTrip(s.Trip)
	g := &model.Group{Kind: kind, Trip: trip, IsHousehold: s.IsHousehold, ID: s.ID, Name: s.Name, Currency: model.Currency(s.Currency), ViewerMembership: m[s.ViewerMembershipID], Members: []*model.Membership{}, Snapshot: s}
	for _, member := range s.Members {
		g.Members = append(g.Members, m[member.ID])
	}
	if s.BalanceError != "" {
		g.Balances = problem(ctx, expense.Failure(s.BalanceError))
		return g
	}
	b := &model.GroupBalances{GroupID: s.ID, Currency: model.Currency(s.Currency), Revision: ledger.Revision(s.Revision), TotalExpenseMinor: ledger.MinorUnits(s.Balance.Total), Settled: s.Balance.Settled, Positions: []*model.MemberPosition{}, Obligations: []*model.Obligation{}}
	for _, p := range s.Balance.Positions {
		b.Positions = append(b.Positions, &model.MemberPosition{Member: m[p.MemberID], PaidMinor: ledger.MinorUnits(p.Paid), OwedMinor: ledger.MinorUnits(p.Owed), NetMinor: ledger.MinorUnits(p.Net), SentMinor: ledger.MinorUnits(p.Sent), ReceivedMinor: ledger.MinorUnits(p.Received)})
	}
	for _, o := range s.Balance.Obligations {
		b.Obligations = append(b.Obligations, &model.Obligation{From: m[o.From], To: m[o.To], AmountMinor: ledger.MinorUnits(o.Amount)})
	}
	g.Balances = b
	return g
}
func mapOutcome(out expense.Outcome) model.CreateExpenseResult {
	switch out.Kind {
	case "COMMITTED":
		r := out.Record
		record := &model.ExpenseOperationRecord{ExpenseID: r.ExpenseID, GroupID: r.GroupID, CreatorMembershipID: r.CreatorMembershipID, PayerMembershipID: r.PayerMembershipID, TotalMinor: ledger.MinorUnits(r.TotalMinor), Currency: model.Currency(r.Currency), Description: r.Description, EffectiveDate: ledger.Date(r.EffectiveDate), Category: model.Category(r.Category), Note: r.Note, Split: model.SplitMode(r.Split), CommittedAt: ledger.DateTime(r.CommittedAt), Revision: ledger.Revision(r.Revision), Allocations: []*model.OperationAllocation{}}
		for _, a := range r.Allocations {
			record.Allocations = append(record.Allocations, &model.OperationAllocation{ParticipantID: a.ParticipantID, AmountMinor: ledger.MinorUnits(a.Amount), PercentageHundredths: percentageValue(*r, a.ParticipantID)})
		}
		return &model.ExpenseCommitted{Key: ledger.OperationKey(out.Key), Record: record}
	case "VALIDATION":
		v := &model.ValidationProblem{Fields: []*model.FieldProblem{}}
		for _, f := range out.Fields {
			v.Fields = append(v.Fields, &model.FieldProblem{Path: f.Path, Code: f.Code, Message: f.Message})
		}
		return v
	case "MISMATCH":
		return &model.OperationMismatch{Key: ledger.OperationKey(out.Key)}
	default:
		return &model.OperationProgress{Key: ledger.OperationKey(out.Key), State: model.OperationState(out.Kind)}
	}
}
func (r *Resolver) groupProjection(ctx context.Context, id string) (*model.Group, error) {
	if r.Expenses == nil {
		return nil, expense.Failure("UNAVAILABLE")
	}
	page := expense.PageRequest{First: 20}
	filter := ledger.Filter{}
	pageError := ""
	count := 0
	repaymentCount := 0
	after := ""
	hasAfter := false
	for _, field := range graphql.CollectFieldsCtx(ctx, []string{"Group"}) {
		if field.Name == "repayments" {
			repaymentCount++
		}
		if field.Name != "expenses" {
			continue
		}
		count++
		args := field.ArgumentMap(graphql.GetOperationContext(ctx).Variables)
		if value, ok := args["first"]; ok {
			v, e := graphql.UnmarshalInt(value)
			if e != nil {
				pageError = "INVALID_INPUT"
			} else {
				page.First = v
			}
		}
		if v, ok := args["after"].(string); ok {
			after = v
			hasAfter = true
		}
		if values, ok := args["filter"].(map[string]any); ok {
			if v, ok := values["from"].(string); ok {
				filter.From = v
			}
			if v, ok := values["to"].(string); ok {
				filter.To = v
			}
			if v, ok := values["category"].(string); ok {
				filter.Category = v
			}
			if v, ok := values["participantId"].(string); ok {
				filter.ParticipantID = v
			}
		}
	}
	if count > 1 || page.First < 1 || page.First > 100 || ledger.ValidateFilter(filter) != nil {
		pageError = "INVALID_INPUT"
	}
	page.From, page.To, page.Category, page.ParticipantID = filter.From, filter.To, filter.Category, filter.ParticipantID
	if hasAfter && pageError == "" {
		if r.Cursors == nil {
			pageError = "UNAVAILABLE"
		} else {
			cursor, e := r.Cursors.Decode(after, id, filter, math.MaxInt64)
			if e != nil {
				pageError = "INVALID_CURSOR"
			} else {
				page.Anchor = &cursor.Revision
				page.LastDate = cursor.EffectiveDate
				page.LastCreated = cursor.CreatedAt
				page.LastID, _ = ledger.ParseID(cursor.ExpenseID, "Expense")
			}
		}
	}
	requested := page
	if pageError != "" {
		page = expense.PageRequest{First: 1}
	}
	snapshot, err := r.Expenses.Read(ctx, id, page)
	if err != nil && pageError == "" && (err == expense.Failure("INVALID_CURSOR") || err == expense.Failure("INVALID_INPUT") || err == expense.Failure("NOT_FOUND")) {
		pageError = string(err.(expense.Failure))
		snapshot, err = r.Expenses.Read(ctx, id, expense.PageRequest{First: 1})
	}
	if err != nil {
		return nil, err
	}
	g := mapGroup(ctx, snapshot)
	g.PageError = pageError
	g.PageRequest = requested
	g.Filter = filter
	if repaymentCount > 1 {
		g.RepaymentError = "INVALID_INPUT"
	}
	return g, nil
}
func nodeKind(id string) string {
	parts := strings.Split(id, ":")
	if len(parts) != 3 {
		return ""
	}
	return parts[1]
}

func mapTrip(trip *database.GroupTripInput) (model.GroupKind, *model.GroupTrip) {
	if trip == nil {
		return model.GroupKindOrdinary, nil
	}
	return model.GroupKindTrip, &model.GroupTrip{Destination: trip.Destination, StartDate: ledger.Date(trip.StartDate), EndDate: ledger.Date(trip.EndDate)}
}

func percentageValue(r expense.Record, id string) *int {
	for _, p := range r.Percentages {
		if p.ParticipantID == id {
			value := int(p.Hundredths)
			return &value
		}
	}
	return nil
}
