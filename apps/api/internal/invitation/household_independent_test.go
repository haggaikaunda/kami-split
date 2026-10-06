//go:build integration

package invitation

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestIndependentHouseholdInvitationReadmissionNeedsOnlyMembership(t *testing.T) {
	f := newFixture(t)
	f.exec(`INSERT INTO app.installation(household_group_id,group_creator_user_id) VALUES($1,$2)`, f.group, f.owner)
	t.Cleanup(func() { f.exec(`DELETE FROM app.installation`) })
	_, token := f.create("member@example.invalid")
	joined, err := f.service.Accept(f.actor(f.member), token, uuid.New())
	requireOutcome(t, joined, err, "ADMITTED")
	read := func(want bool) {
		t.Helper()
		err := f.db.WithIdentity(context.Background(), f.member.String(), func(tx pgx.Tx) error {
			var access bool
			var state string
			if err := tx.QueryRow(context.Background(), `SELECT app.can_read_group($1),app.household_dashboard_lock()->>'state'`, f.group).Scan(&access, &state); err != nil {
				return err
			}
			if access != want || (want && state != "COMPLETE") || (!want && state != "NOT_FOUND") {
				t.Fatalf("membership access=%t state=%s wanted %t", access, state, want)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	read(true)
	var memberID string
	if err := f.admin.QueryRow(context.Background(), `SELECT user_id FROM app.memberships WHERE id=$1`, joined.MembershipID).Scan(&memberID); err != nil {
		t.Fatal(err)
	}
	f.exec(`BEGIN`)
	f.exec(`SELECT app.household_lifecycle_lock(ARRAY[$1::uuid])`, memberID)
	f.exec(`UPDATE app.memberships SET active=false WHERE id=$1`, joined.MembershipID)
	f.exec(`COMMIT`)
	read(false)
	_, fresh := f.create("member@example.invalid")
	readmitted, err := f.service.Accept(f.actor(f.member), fresh, uuid.New())
	requireOutcome(t, readmitted, err, "ADMITTED")
	if readmitted.MembershipID != joined.MembershipID {
		t.Fatal("readmission replaced membership")
	}
	read(true)
}
