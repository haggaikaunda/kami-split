//go:build integration

package database_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/jackc/pgx/v5"
)

func independentCreationFixture(t *testing.T) *identityFixture {
	t.Helper()
	f := newIdentityFixture(t)
	t.Cleanup(func() {
		_, err := f.admin.Exec(context.Background(), `BEGIN; SET LOCAL ROLE kami_migrator;
   DELETE FROM app.group_trip WHERE group_id IN (SELECT group_id FROM app.group_creation_attempts WHERE creator_user_id IN ('75000000-0000-4000-8000-000000000002','75000000-0000-4000-8000-000000000003'));
   CREATE TEMP TABLE creation_cleanup_ids ON COMMIT DROP AS SELECT group_id FROM app.group_creation_attempts WHERE group_id IS NOT NULL AND creator_user_id IN ('75000000-0000-4000-8000-000000000002','75000000-0000-4000-8000-000000000003');
   DELETE FROM app.group_creation_attempts WHERE creator_user_id IN ('75000000-0000-4000-8000-000000000002','75000000-0000-4000-8000-000000000003');
   DELETE FROM app.memberships WHERE group_id IN (SELECT group_id FROM creation_cleanup_ids);
   DELETE FROM app.groups WHERE id IN (SELECT group_id FROM creation_cleanup_ids); COMMIT;`)
		if err != nil {
			t.Errorf("creation cleanup: %v", err)
		}
	})
	return f
}

func TestIndependentCreationValidationAndCanonicalReplay(t *testing.T) {
	f := independentCreationFixture(t)
	for i, tc := range []struct {
		name        string
		trip        *database.GroupTripInput
		kind, state string
	}{
		{strings.Repeat("😀", 120), nil, "ORDINARY", "COMPLETED"},
		{strings.Repeat("😀", 121), nil, "ORDINARY", "REJECTED"},
		{"\u00a0", nil, "ORDINARY", "COMPLETED"},
		{" \t\r\n", nil, "ORDINARY", "REJECTED"},
		{"Trip", &database.GroupTripInput{Destination: strings.Repeat("😀", 200), StartDate: "0001-01-01", EndDate: "9999-12-31"}, "TRIP", "COMPLETED"},
		{"Trip", &database.GroupTripInput{Destination: strings.Repeat("😀", 201), StartDate: "2024-02-29", EndDate: "2024-02-29"}, "TRIP", "REJECTED"},
		{"Trip", &database.GroupTripInput{StartDate: "2024-03-01", EndDate: "2024-02-29"}, "TRIP", "REJECTED"},
		{"Trip", nil, "TRIP", "REJECTED"},
		{"Ordinary", &database.GroupTripInput{StartDate: "2024-01-01", EndDate: "2024-01-01"}, "ORDINARY", "REJECTED"},
	} {
		input := database.GroupCreationInput{OperationKey: f.id(100 + i), Name: tc.name, Kind: tc.kind, Trip: tc.trip}
		got, err := f.db.CreateGroup(f.ctx, f.id(2), input)
		if err != nil || got.State != tc.state {
			t.Fatalf("case %d: %+v %v", i, got, err)
		}
		replay, err := f.db.CreateGroup(f.ctx, f.id(2), input)
		if err != nil || replay.State != got.State || replay.GroupID != got.GroupID {
			t.Fatalf("case %d replay: %+v %v", i, replay, err)
		}
		input.Name = "different"
		conflict, err := f.db.CreateGroup(f.ctx, f.id(2), input)
		if err != nil || conflict.State != "OPERATION_CONFLICT" {
			t.Fatalf("case %d changed rejection/success: %+v %v", i, conflict, err)
		}
	}
	for i, date := range []string{"0000-01-01", "2023-02-29", "2024-2-01", "2024-01-01T00:00:00Z", "10000-01-01"} {
		input := database.GroupCreationInput{OperationKey: f.id(200 + i), Name: "Trip", Kind: "TRIP", Trip: &database.GroupTripInput{StartDate: date, EndDate: "9999-12-31"}}
		if _, err := f.db.CreateGroup(f.ctx, f.id(2), input); !errors.Is(err, database.ErrGroupCreationInput) {
			t.Fatalf("malformed date %q: %v", date, err)
		}
		got, err := f.db.GroupCreationOperation(f.ctx, f.id(2), input.OperationKey)
		if err != nil || got.State != "NOT_STARTED" {
			t.Fatalf("malformed input consumed key: %+v %v", got, err)
		}
	}
	var original string
	for i, trip := range []string{`{"startDate":"2024-01-01","endDate":"2024-01-01"}`, `{"destination":null,"startDate":"2024-01-01","endDate":"2024-01-01"}`, `{"destination":"","startDate":"2024-01-01","endDate":"2024-01-01"}`} {
		err := f.db.WithIdentity(f.ctx, f.id(2), func(tx pgx.Tx) error {
			var raw []byte
			if err := tx.QueryRow(f.ctx, `SELECT app.create_group($1,$2,'TRIP',$3::jsonb)`, f.id(300), " \tTrip\r\n", trip).Scan(&raw); err != nil {
				return err
			}
			var got database.GroupCreationResult
			if err := json.Unmarshal(raw, &got); err != nil {
				return err
			}
			if got.State != "COMPLETED" {
				return fmt.Errorf("canonical null/omission state: %s", got.State)
			}
			if i == 0 {
				original = got.GroupID
			} else if got.GroupID != original {
				return errors.New("destination normalization created duplicate")
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestIndependentCreationActorScopeAndRemovedAccess(t *testing.T) {
	f := independentCreationFixture(t)
	input := database.GroupCreationInput{OperationKey: f.id(400), Name: "Original", Kind: "ORDINARY"}
	original, err := f.db.CreateGroup(f.ctx, f.id(2), input)
	if err != nil || original.State != "COMPLETED" {
		t.Fatalf("create: %+v %v", original, err)
	}
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.installation SET group_creator_user_id='%s'; RESET ROLE`, f.id(3)))
	got, err := f.db.GroupCreationOperation(f.ctx, f.id(3), input.OperationKey)
	if err != nil || got.State != "NOT_STARTED" || got.GroupID != "" {
		t.Fatalf("other designated actor probe: %+v %v", got, err)
	}
	another, err := f.db.CreateGroup(f.ctx, f.id(3), input)
	if err != nil || another.State != "COMPLETED" || another.GroupID == original.GroupID {
		t.Fatalf("actor key namespace: %+v %v", another, err)
	}
	if _, err := f.db.GroupCreationOperation(f.ctx, f.id(2), input.OperationKey); !errors.Is(err, database.ErrGroupCreationForbidden) {
		t.Fatalf("former designation: %v", err)
	}
	f.exec(fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; UPDATE app.installation SET group_creator_user_id='%s'; INSERT INTO app.memberships(id,group_id,user_id) VALUES('%s','%s','%s'); UPDATE app.groups SET owner_membership_id='%s' WHERE id='%s'; UPDATE app.memberships SET active=false WHERE id='%s'; COMMIT`, f.id(2), f.id(401), original.GroupID, f.id(1), f.id(401), original.GroupID, original.OwnerMembershipID))
	for _, replay := range []bool{false, true} {
		if replay {
			got, err = f.db.CreateGroup(f.ctx, f.id(2), input)
		} else {
			got, err = f.db.GroupCreationOperation(f.ctx, f.id(2), input.OperationKey)
		}
		if err != nil || got.State != "NOT_FOUND" || got.GroupID != "" || got.OwnerMembershipID != "" {
			t.Fatalf("removed access replay=%v: %+v %v", replay, got, err)
		}
	}
}
