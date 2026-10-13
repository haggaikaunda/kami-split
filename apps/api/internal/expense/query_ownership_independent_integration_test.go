//go:build integration

package expense_test

import (
	"context"
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"testing"
)

// Distinct filter values exercise ordinary-read bindings while the dashboard
// consumes complete financial aggregates without fetching a record page.
func TestIndependentReadBindingsAndDashboardProjection(t *testing.T) {
	f := independentDashboardFixture(t)
	service := expense.New(f.db)
	var records []expense.Record
	for _, row := range []struct {
		date, category string
		participant    int
		total          int64
	}{
		{"2026-08-31", "DINING", 301, 100}, {"2026-09-01", "DINING", 301, 200},
		{"2026-09-02", "OTHER", 302, 300}, {"2026-09-03", "DINING", 301, 400},
	} {
		in := f.input
		in.Key, in.EffectiveDate, in.Category, in.Total = uuid.NewString(), row.date, row.category, row.total
		in.PayerID = f.public("Membership", 301)
		in.ParticipantIDs = []string{f.public("Membership", row.participant)}
		out := f.create(1, in)
		if out.Kind != "COMMITTED" {
			t.Fatalf("seed: %+v", out)
		}
		records = append(records, *out.Record)
	}
	read := func(page expense.PageRequest) expense.Snapshot {
		t.Helper()
		var got expense.Snapshot
		verifiedEditCall(t, f, 1, func(ctx context.Context) {
			var err error
			got, err = service.Read(ctx, f.input.GroupID, page)
			if err != nil {
				t.Fatal(err)
			}
		})
		if got.Total != 1000 || got.Revision != 4 {
			t.Fatalf("page changed complete aggregates: %+v", got)
		}
		return got
	}
	for _, tc := range []struct {
		name  string
		page  expense.PageRequest
		index int
	}{
		{"lower inclusive", expense.PageRequest{First: 10, From: "2026-09-03"}, 3},
		{"upper inclusive", expense.PageRequest{First: 10, To: "2026-08-31"}, 0},
		{"category", expense.PageRequest{First: 10, Category: "OTHER"}, 2},
		{"participant excludes payer only", expense.PageRequest{First: 10, ParticipantID: f.public("Membership", 302)}, 2},
		{"combined", expense.PageRequest{First: 10, From: "2026-09-01", To: "2026-09-02", Category: "DINING", ParticipantID: f.public("Membership", 301)}, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := read(tc.page)
			if len(got.Records) != 1 || got.Records[0].ExpenseID != records[tc.index].ExpenseID {
				t.Fatalf("wrong filtered records: %+v", got.Records)
			}
		})
	}
	first := read(expense.PageRequest{First: 1})
	if len(first.Records) != 1 || !first.HasNext || first.HasPrevious || first.Records[0].ExpenseID != records[3].ExpenseID {
		t.Fatalf("first page: %+v", first)
	}
	anchor := int64(3)
	anchored := read(expense.PageRequest{First: 10, Anchor: &anchor})
	if len(anchored.Records) != 3 {
		t.Fatalf("anchor records: %+v", anchored.Records)
	}
	last := first.Records[0]
	var rawLast string
	if err := f.admin.QueryRow(f.ctx, `SELECT id::text FROM app.expenses WHERE group_id=$1 AND revision=4`, f.id(201)).Scan(&rawLast); err != nil {
		t.Fatal(err)
	}
	next := read(expense.PageRequest{First: 10, LastDate: last.EffectiveDate, LastCreated: last.CommittedAt, LastID: rawLast})
	if len(next.Records) != 3 || !next.HasPrevious || next.HasNext || next.Records[0].ExpenseID != records[2].ExpenseID {
		t.Fatalf("continuation: %+v", next)
	}
	verifiedEditCall(t, f, 1, func(ctx context.Context) {
		single, err := service.ReadExpense(ctx, f.input.GroupID, records[1].ExpenseID)
		if err != nil || len(single.Records) != 1 || single.Records[0].ExpenseID != records[1].ExpenseID || single.Total != 1000 {
			t.Fatalf("single expense binding: %+v, %v", single, err)
		}
		dashboard, err := service.ReadDashboard(ctx)
		if err != nil || dashboard.Totals == nil {
			t.Fatalf("dashboard: %+v, %v", dashboard, err)
		}
		totals := dashboard.Totals
		if totals.TotalSharedExpenseMinor != 1000 || totals.TotalSharedExpenseCount != 4 || totals.ViewerPaidMinor != 1000 || totals.ViewerShareMinor != 700 || totals.ViewerNetMinor != 300 {
			t.Fatalf("dashboard complete totals: %+v", totals)
		}
		for _, space := range dashboard.Spaces {
			if len(space.Snapshot.Records) != 0 {
				t.Fatalf("dashboard returned record page: %+v", space)
			}
		}
	})
	verifiedEditCall(t, f, 4, func(ctx context.Context) {
		if _, err := service.Read(ctx, f.input.GroupID, expense.PageRequest{First: 1}); err == nil {
			t.Fatal("unrelated actor read group")
		}
		if got, err := service.ReadExpense(ctx, f.public("Group", 202), records[1].ExpenseID); err == nil && len(got.Records) != 0 {
			t.Fatal("cross-group expense disclosed")
		}
	})
}
