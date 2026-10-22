//go:build integration

package banking

import (
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/reportingtimezone"
)

// These cases use committed provider facts without private activity overrides.
// Transport and provider coverage evidence are synthetic, not live-bank claims.
func TestProviderReportingApprovedSpendingExamples(t *testing.T) {
	fact := func(id, date string, amount int64, code, primary, detail string) SyncTransaction {
		r := syncFact(id, date, amount)
		if code != "" {
			r.TransactionCode = textPointer(code)
		}
		if primary != "" {
			r.ProviderPrimaryCategory = textPointer(primary)
			r.ProviderCategory = textPointer(detail)
			r.ProviderConfidence = textPointer("HIGH")
		}
		return r
	}
	purchase := func(id, date string, amount int64) SyncTransaction {
		return fact(id, date, amount, "", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES")
	}
	for _, tc := range []struct {
		name, start, end, net string
		facts                 []SyncTransaction
		unresolved            int
	}{
		{"E01 same-period refund", "2026-10-01", "2026-10-17", "6000", []SyncTransaction{purchase("purchase", "2026-10-01", 10000), fact("refund", "2026-10-02", -4000, "refund", "", "")}, 0},
		{"E02 prior month unchanged", "2026-09-01", "2026-09-30", "10000", []SyncTransaction{purchase("purchase", "2026-09-20", 10000), fact("refund", "2026-10-02", -4000, "refund", "", "")}, 0},
		{"E02 negative refund posting month", "2026-10-01", "2026-10-17", "-4000", []SyncTransaction{purchase("purchase", "2026-09-20", 10000), fact("refund", "2026-10-02", -4000, "refund", "", "")}, 0},
		{"E03 both repayment legs", "2026-10-01", "2026-10-17", "10000", []SyncTransaction{purchase("purchase", "2026-10-01", 10000), fact("repay-debit", "2026-10-02", 10000, "", "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"), fact("repay-credit", "2026-10-02", -10000, "", "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")}, 0},
		{"E04 both transfer legs", "2026-10-01", "2026-10-17", "0", []SyncTransaction{fact("out", "2026-10-01", 50000, "transfer", "", ""), fact("in", "2026-10-01", -50000, "transfer", "", "")}, 0},
		{"E04 one transfer leg", "2026-10-01", "2026-10-17", "0", []SyncTransaction{fact("out", "2026-10-01", 50000, "transfer", "", "")}, 0},
		{"E05 salary and ambiguous credit", "2026-10-01", "2026-10-17", "0", []SyncTransaction{fact("salary", "2026-10-01", -200000, "", "INCOME", "INCOME_SALARY"), purchase("unknown-credit", "2026-10-02", -2500)}, 1},
		{"E07 cash withdrawal", "2026-10-01", "2026-10-17", "0", []SyncTransaction{fact("cash", "2026-10-01", 20000, "", "TRANSFER_OUT", "TRANSFER_OUT_WITHDRAWAL")}, 0},
		{"E08 fee and signed interest", "2026-10-01", "2026-10-17", "1500", []SyncTransaction{fact("fee", "2026-10-01", 500, "bank charge", "", ""), fact("debit-interest", "2026-10-01", 1000, "interest", "", ""), fact("credit-interest", "2026-10-01", -200, "interest", "", "")}, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newSyncFixture(t)
			ctx := f.actor(f.owner)
			requireCode(t, Result{Code: reportingtimezone.New(f.db).Initialize(ctx, uuid.NewString(), nil).Code}, "READY")
			b := f.begin()
			f.stage(b, 0, b.Cursor(), "examples", false, tc.facts, nil)
			f.commit(b, "READY")
			f.exec(`UPDATE app.banking_bindings SET coverage_after='2026-08-31',coverage_through='2026-10-17' WHERE id=$1`, f.binding)
			request := reportRange(f.account)
			request.Filter.Start, request.Filter.End = tc.start, tc.end
			request.First = 1
			r := f.service.ReadReport(ctx, request)
			if r.Code != "READY" || r.Summary == nil || r.Summary.NetMinor != tc.net || r.Counts.UnresolvedCount != tc.unresolved || r.Accounts[0].Coverage != "COMPLETE" {
				t.Fatalf("provider result: %s %+v %+v", r.Code, r.Summary, r.Counts)
			}
			for _, v := range tc.facts {
				d := f.service.ReadTransaction(ctx, f.sourceID(v.TransactionID).String(), "")
				if d.Code != "READY" || d.Transaction.AnnotationRevision != "0" || d.Transaction.AmountMinor != fmt.Sprint(v.AmountMinor) || d.Transaction.BankDate != v.Date {
					t.Fatal("provider facts changed or required private classification")
				}
			}
		})
	}
}

func TestProviderReportingPendingCorrectionRemovalAndCoverage(t *testing.T) {
	f := newSyncFixture(t)
	ctx := f.actor(f.owner)
	requireCode(t, Result{Code: reportingtimezone.New(f.db).Initialize(ctx, uuid.NewString(), nil).Code}, "READY")
	pending := syncFact("pending", "2026-10-01", 2500)
	pending.Pending = true
	pending.TransactionCode = textPointer("purchase")
	b := f.begin()
	f.stage(b, 0, b.Cursor(), "pending", false, []SyncTransaction{pending}, nil)
	f.commit(b, "READY")
	request := reportRange(f.account)
	r := f.service.ReadReport(ctx, request)
	if r.Code != "READY" || r.Summary.NetMinor != "0" || r.Counts.PendingCount != 1 {
		t.Fatal("pending contributed")
	}
	source := f.sourceID("pending")
	request.After = *r.EndCursor
	posted := syncFact("posted", "2026-10-02", 2700)
	posted.PendingTransactionID = textPointer("pending")
	posted.TransactionCode = textPointer("purchase")
	b = f.begin()
	f.stage(b, 0, b.Cursor(), "posted", false, []SyncTransaction{posted}, nil, "pending")
	f.commit(b, "READY")
	if f.sourceID("posted") != source {
		t.Fatal("explicit pending identity lost")
	}
	if stale := f.service.ReadReport(ctx, request); stale.Code != "RESTART_REQUIRED" || stale.Summary != nil {
		t.Fatal("source replacement reused old snapshot")
	}
	request.After = ""
	r = f.service.ReadReport(ctx, request)
	if r.Code != "READY" || r.TotalCount != 1 || r.Summary.NetMinor != "2700" || r.Counts.PendingCount != 0 {
		t.Fatal("posted replacement omitted or doubled")
	}
	posted.AmountMinor = 3000
	b = f.begin()
	f.stage(b, 0, b.Cursor(), "corrected", false, nil, []SyncTransaction{posted})
	f.commit(b, "READY")
	if r = f.service.ReadReport(ctx, request); r.Summary.NetMinor != "3000" {
		t.Fatal("correction did not revise original period")
	}
	b = f.begin()
	f.stage(b, 0, b.Cursor(), "removed", false, nil, nil, "posted")
	f.commit(b, "READY")
	r = f.service.ReadReport(ctx, request)
	if r.Code != "READY" || r.TotalCount != 1 || r.Summary.NetMinor != "0" || r.Counts.RemovedCount != 1 || r.Rows[0].ID != source.String() {
		t.Fatal("removal made a refund or lost history")
	}
	f.exec(`UPDATE app.banking_bindings SET coverage_after='2026-09-30',coverage_through='2026-10-17' WHERE id=$1`, f.binding)
	r = f.service.ReadReport(ctx, request)
	if r.Start != "2026-01-01" || r.End != "2026-10-17" || r.Accounts[0].Coverage != "PARTIAL" {
		t.Fatal("selected bounds clamped")
	}
	request.Filter.Start, request.Filter.End = "2026-10-01", "2026-10-17"
	r = f.service.ReadReport(ctx, request)
	if r.Accounts[0].Coverage != "COMPLETE" {
		t.Fatal("fully covered zero indistinguishable from missing history")
	}
	f.exec(`UPDATE app.banking_connections SET permission_state='revoked' WHERE id=$1`, f.connection)
	r = f.service.ReadReport(ctx, request)
	if r.Code != "READY" || r.Accounts[0].Coverage != "PARTIAL" || r.Accounts[0].Intervals[0].CollectionState != "current/active/revoked" {
		t.Fatal("revocation hid retained history or stale coverage")
	}
}

func TestProviderReportingWalksAllRowsAndBindsFilters(t *testing.T) {
	f := newSyncFixture(t)
	ctx := f.actor(f.owner)
	requireCode(t, Result{Code: reportingtimezone.New(f.db).Initialize(ctx, uuid.NewString(), nil).Code}, "READY")
	facts := make([]SyncTransaction, 105)
	for i := range facts {
		facts[i] = syncFact(fmt.Sprintf("walk-%03d", i), fmt.Sprintf("2026-10-%02d", i%17+1), int64(i+1))
		facts[i].ProviderPrimaryCategory = textPointer("FOOD_AND_DRINK")
		facts[i].ProviderCategory = textPointer("FOOD_AND_DRINK_GROCERIES")
		facts[i].ProviderConfidence = textPointer("HIGH")
	}
	b := f.begin()
	f.stage(b, 0, b.Cursor(), "all", false, facts, nil)
	f.commit(b, "READY")
	request := reportRange(f.account)
	request.First = 7
	seen := map[string]bool{}
	previousDate, previousID := "", ""
	pages := 0
	for {
		r := f.service.ReadReport(ctx, request)
		if r.Code != "READY" || r.TotalCount != 105 || r.Summary.NetMinor != "5565" || len(r.Rows) > 7 {
			t.Fatalf("complete dataset changed: %s %+v", r.Code, r.Summary)
		}
		for _, v := range r.Rows {
			if seen[v.ID] {
				t.Fatal("duplicate across traversal")
			}
			if previousID != "" && (v.BankDate > previousDate || v.BankDate == previousDate && v.ID >= previousID) {
				t.Fatal("unstable ordering")
			}
			seen[v.ID] = true
			previousDate, previousID = v.BankDate, v.ID
		}
		pages++
		if !r.HasNextPage {
			break
		}
		if r.EndCursor == nil || len(r.Rows) == 0 || pages > 16 {
			t.Fatal("pagination did not advance")
		}
		request.After = *r.EndCursor
	}
	if len(seen) != 105 || pages != 15 {
		t.Fatal("rows omitted", len(seen), pages)
	}
	request.After = ""
	r := f.service.ReadReport(ctx, request)
	request.After = *r.EndCursor
	request.Filter.Categories = []string{"FOOD_AND_DRINK"}
	if changed := f.service.ReadReport(ctx, request); changed.Code != "RESTART_REQUIRED" || changed.Summary != nil {
		t.Fatal("cursor accepted changed filters")
	}
	request.After = ""
	request.Filter.Activities = []string{"transfer"}
	filtered := f.service.ReadReport(ctx, request)
	if filtered.Code != "READY" || filtered.TotalCount != 0 || filtered.Summary.NetMinor != "0" {
		t.Fatal("AND filters used loaded-page totals")
	}
	for _, first := range []int{-1, 101} {
		request.First = first
		invalid := f.service.ReadReport(ctx, request)
		if invalid.Code != "INVALID_INPUT" || invalid.Summary != nil {
			t.Fatal("page bound unenforced")
		}
	}
}
