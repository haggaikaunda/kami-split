package expense

import (
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"testing"
)

func TestSavedMemberEligibility(t *testing.T) {
	base := Record{PayerMembershipID: "payer", CreatorMembershipID: "creator", Allocations: []ledger.Allocation{{ParticipantID: "payer", Amount: 100}, {ParticipantID: "zero", Amount: 0}}}
	members := []Member{{ID: "payer", Status: "ACTIVE", CanParticipate: true}, {ID: "zero", Status: "ACTIVE", CanParticipate: true}, {ID: "creator", Status: "INACTIVE"}, {ID: "unrelated", Status: "INACTIVE"}}
	setEditEligibility(&base, members)
	if !base.CanEdit {
		t.Fatal("uninvolved former creator locked expense")
	}
	members[1].Status = "INACTIVE"
	setEditEligibility(&base, members)
	if base.CanEdit || base.EditLockReason != "FORMER_MEMBER" {
		t.Fatal("zero-share former participant did not lock whole expense")
	}
	members[1].Status = "ACTIVE"
	members[1].CanParticipate = false
	setEditEligibility(&base, members)
	if base.CanEdit || base.EditLockReason != "INELIGIBLE_MEMBER" {
		t.Fatal("ineligible account did not lock expense")
	}
	members[1].CanParticipate = true
	setEditEligibility(&base, members)
	if !base.CanEdit || base.EditLockReason != "" {
		t.Fatal("readmitted eligible member failed to unlock")
	}
}

func TestReplacementKeepsRepaymentsAndChecksCompleteBounds(t *testing.T) {
	a := ledger.PublicID("Membership", "00000000-0000-4000-8000-000000000001")
	b := ledger.PublicID("Membership", "00000000-0000-4000-8000-000000000002")
	old := Record{TotalMinor: 10000, PayerMembershipID: a, Allocations: []ledger.Allocation{{ParticipantID: a, Amount: 5000}, {ParticipantID: b, Amount: 5000}}}
	next := Record{TotalMinor: 8000, PayerMembershipID: a, Allocations: []ledger.Allocation{{ParticipantID: a, Amount: 4000}, {ParticipantID: b, Amount: 4000}}}
	snapshot := Snapshot{Total: 10000, Positions: []ledger.Position{{MemberID: a, Paid: 10000, Owed: 5000, Received: 5000}, {MemberID: b, Owed: 5000, Sent: 5000}}}
	if err := validateReplacement(snapshot, old, next); err != nil {
		t.Fatal(err)
	}
	if snapshot.Positions[0].Paid != 10000 || snapshot.Positions[0].Received != 5000 || snapshot.Total != 10000 {
		t.Fatal("validation mutated caller state")
	}
}
