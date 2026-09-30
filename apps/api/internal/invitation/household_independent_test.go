//go:build integration

package invitation

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
)

func TestIndependentHouseholdInvitationReadmissionRequiresFreshPairConsent(t *testing.T) {
	f := newFixture(t)
	f.exec(`INSERT INTO app.installation(household_group_id,group_creator_user_id) VALUES($1,$2)`, f.group, f.owner)
	t.Cleanup(func() {
		f.exec(`DELETE FROM app.household_designation_audit; UPDATE app.household_designation_guard SET version=0,state='EMPTY',first_user_id=NULL,second_user_id=NULL,proposer_user_id=NULL,first_consented=false,second_consented=false; DELETE FROM app.installation`)
	})
	_, token := f.create("member@example.invalid")
	joined, err := f.service.Accept(f.actor(f.member), token, uuid.New())
	requireOutcome(t, joined, err, "ADMITTED")
	var memberID string
	if err := f.admin.QueryRow(context.Background(), `SELECT user_id FROM app.memberships WHERE id=$1`, joined.MembershipID).Scan(&memberID); err != nil {
		t.Fatal(err)
	}
	first, second := f.owner.String(), memberID
	if first > second {
		first, second = second, first
	}
	call := func(subject uuid.UUID, action string, version int64, want string) database.HouseholdDesignationResult {
		t.Helper()
		input := database.HouseholdDesignationInput{Action: action, Version: version}
		if action == "PROPOSE" || action == "CONSENT" {
			input.FirstUserID = first
			input.SecondUserID = second
		}
		got, err := f.db.HouseholdDesignation(context.Background(), subject.String(), input)
		if err != nil || got.State != want {
			t.Fatalf("%s: %+v %v want %s", action, got, err, want)
		}
		return got
	}
	p := call(f.owner, "PROPOSE", 0, "PENDING")
	call(f.owner, "CONSENT", p.Version, "PENDING")
	call(f.member, "CONSENT", p.Version, "ACTIVE")
	f.exec(`BEGIN`)
	f.exec(`SELECT app.household_lifecycle_lock(ARRAY[$1::uuid])`, memberID)
	f.exec(`UPDATE app.memberships SET active=false WHERE id=$1`, joined.MembershipID)
	f.exec(`COMMIT`)
	suspended := call(f.owner, "READ", 0, "SUSPENDED")
	_, fresh := f.create("member@example.invalid")
	readmitted, err := f.service.Accept(f.actor(f.member), fresh, uuid.New())
	requireOutcome(t, readmitted, err, "ADMITTED")
	if readmitted.MembershipID != joined.MembershipID {
		t.Fatal("readmission replaced membership")
	}
	call(f.member, "READ", 0, "SUSPENDED")
	call(f.owner, "CONSENT", p.Version, "CONFLICT")
	call(f.member, "CONSENT", suspended.Version, "SUSPENDED")
	call(f.owner, "CONSENT", suspended.Version, "ACTIVE")
}
