package graph

import (
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph/model"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"testing"
)

func TestEditOutcomeKeepsOriginalReceiptAndExplicitNoop(t *testing.T) {
	record := &expense.Record{ExpenseID: "expense", GroupID: "source", CreatorMembershipID: "original-creator", PayerMembershipID: "new-payer", TotalMinor: 8000, Currency: "USD", Description: "Corrected", EffectiveDate: "2026-10-01", Category: "DINING", Split: "PERCENTAGE", CommittedAt: "2026-10-01T00:00:00.000000Z", Version: 3, Revision: 7, Allocations: []ledger.Allocation{{ParticipantID: "zero-member", Amount: 0}, {ParticipantID: "payer", Amount: 8000}}, Percentages: []ledger.Percentage{{ParticipantID: "zero-member", Hundredths: 0}, {ParticipantID: "payer", Hundredths: 10000}}}
	for _, changed := range []bool{true, false} {
		got, ok := mapEditOutcome(expense.Outcome{Kind: "COMMITTED", Key: "key", Record: record, Changed: changed}).(*model.ExpenseEditCommitted)
		if !ok || got.Changed != changed || got.Version != 3 || got.Record.CreatorMembershipID != "original-creator" || got.Record.Revision != 7 || got.Record.CommittedAt != ledger.DateTime(record.CommittedAt) {
			t.Fatalf("incorrect edit receipt: %#v", got)
		}
		if len(got.Record.Allocations) != 2 || got.Record.Allocations[0].PercentageHundredths == nil || *got.Record.Allocations[0].PercentageHundredths != 0 {
			t.Fatal("explicit zero percentage lost")
		}
	}
	conflict := mapEditOutcome(expense.Outcome{Kind: "CONFLICT", Key: "key", CurrentVersion: 4}).(*model.ExpenseEditConflict)
	if conflict.CurrentVersion != 4 || conflict.Key != "key" {
		t.Fatal("conflict must retain observed expense version and attempt")
	}
	locked := mapEditOutcome(expense.Outcome{Kind: "LOCKED", Key: "key", LockReason: "FORMER_MEMBER"}).(*model.ExpenseEditLocked)
	if locked.Reason != model.ExpenseEditLockReasonFormerMember {
		t.Fatal("former member reason missing")
	}
}

func TestActivitySnapshotUsesRecordedValuesAndCurrentMinimalLabels(t *testing.T) {
	before := expense.Record{TotalMinor: 12000, Description: "Original dinner", PayerMembershipID: "payer", EffectiveDate: "2026-10-01", Category: "DINING", Note: "  original note\n", Split: "EXACT", Allocations: []ledger.Allocation{{ParticipantID: "former", Amount: 0}, {ParticipantID: "payer", Amount: 12000}}}
	after := before
	after.TotalMinor = 10000
	after.Description = "Corrected dinner"
	after.Allocations = []ledger.Allocation{{ParticipantID: "former", Amount: 0}, {ParticipantID: "payer", Amount: 10000}}
	event := expense.ActivityEvent{ID: "event", Kind: "EXPENSE_UPDATED", Description: after.Description, Creator: &expense.ActivityIdentity{ID: "editor", DisplayName: "Editor"}, Before: &before, After: &after, SnapshotMembers: []expense.Member{{ID: "payer", DisplayName: "Current payer label"}, {ID: "former", DisplayName: "Former member", Status: "INACTIVE"}}}
	got := mapActivityEvent(event)
	if got.Creator.ID != "editor" || got.Before.TotalMinor != 12000 || got.After.TotalMinor != 10000 || got.Before.Note != "  original note\n" || got.Before.Payer.DisplayName != "Current payer label" {
		t.Fatal("historical facts or authorized labels lost")
	}
	if len(got.Before.Allocations) != 2 || got.Before.Allocations[0].Participant.ID != "former" || got.Before.Allocations[0].AmountMinor != 0 {
		t.Fatal("historical explicit zero participation missing")
	}
	if got.Before == got.After {
		t.Fatal("before/after must remain distinct snapshots")
	}
}
