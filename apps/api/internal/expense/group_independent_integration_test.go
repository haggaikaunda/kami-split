//go:build integration

package expense_test

import (
	"bytes"
	"fmt"
	"reflect"
	"testing"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
)

func TestIndependentGroupCreatorNeedsNoHouseholdMembershipAndReceiptsSurviveTransfer(t *testing.T) {
	f := newGroupTransportFixture(t)
	// Removing the designated creator from the household must neither disclose H
	// nor remove its separate creation grant. Use an existing active peer as owner.
	f.exec(fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; SELECT app.household_lifecycle_lock(ARRAY['%s','%s']::uuid[]); UPDATE app.groups SET owner_membership_id='%s' WHERE id='%s'; UPDATE app.memberships SET active=false WHERE id='%s'; COMMIT; RESET ROLE`, f.id(101), f.id(102), f.id(302), f.id(201), f.id(301)))
	input := ordinaryGroupInput()
	first := createGroup(t, f, input, "GroupCreationCompleted")
	v := groupRequest(t, f, 1, `{viewer{__typename ... on Viewer{canCreateGroups groups{id isHousehold}}}}`, nil, "viewer", "Viewer")
	if v["canCreateGroups"] != true || len(v["groups"].([]any)) != 1 {
		t.Fatalf("household membership incorrectly required: %v", v)
	}
	g := v["groups"].([]any)[0].(map[string]any)
	if g["id"] != first["groupId"] || g["isHousehold"] != false {
		t.Fatalf("household designation leaked: %v", g)
	}
	raw, _ := ledger.ParseID(first["groupId"].(string), "Group")
	replacement := uuid.NewString()
	f.exec(fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; INSERT INTO app.memberships(id,group_id,user_id) VALUES('%s','%s','%s'); UPDATE app.groups SET owner_membership_id='%s' WHERE id='%s'; COMMIT; RESET ROLE`, replacement, raw, f.id(102), replacement, raw))
	if got := recoverGroup(t, f, 1, input["operationKey"], "GroupCreationCompleted"); !reflect.DeepEqual(got, first) {
		t.Fatalf("receipt changed after ownership transfer: %v", got)
	}
	// Ownership never conveys the separate installation capability.
	if got := groupRequest(t, f, 2, createGroupQuery, map[string]any{"input": ordinaryGroupInput()}, "createGroup", "Problem"); got["code"] != "FORBIDDEN" {
		t.Fatalf("new owner can create: %v", got)
	}
	// A newly designated actor has its own key namespace; it cannot recover A's
	// receipt even while currently owning A's group and knowing its exact key.
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.installation SET group_creator_user_id='%s'; RESET ROLE`, f.id(102)))
	recoverGroup(t, f, 2, input["operationKey"], "GroupCreationNotStarted")
	second := groupRequest(t, f, 2, createGroupQuery, map[string]any{"input": input}, "createGroup", "GroupCreationCompleted")
	if second["groupId"] == first["groupId"] || second["creatorMembershipId"] == first["creatorMembershipId"] {
		t.Fatalf("actors shared a creation attempt: %v", second)
	}
	if got := recoverGroup(t, f, 1, input["operationKey"], "Problem"); got["code"] != "FORBIDDEN" {
		t.Fatalf("former creator grant persisted: %v", got)
	}
}

func TestIndependentGroupTransportRejectsAdditionalAuthorityAndScalarInputsWithoutAttempts(t *testing.T) {
	f := newGroupTransportFixture(t)
	for _, field := range []string{"actorId", "currency", "ownerId", "membershipIds", "household", "cover", "status"} {
		input := ordinaryGroupInput()
		input[field] = "unauthorized"
		status, body, err := groupHTTP(f, 1, createGroupQuery, map[string]any{"input": input})
		if err != nil || status != 400 || !bytes.Contains(body, []byte("BAD_USER_INPUT")) {
			t.Fatalf("%s accepted: %d %s %v", field, status, body, err)
		}
		recoverGroup(t, f, 1, input["operationKey"], "GroupCreationNotStarted")
	}
	for _, key := range []any{42, "84000000-0000-1000-8000-000000000001", "84000000-0000-4000-C000-000000000001"} {
		input := ordinaryGroupInput()
		input["operationKey"] = key
		status, body, err := groupHTTP(f, 1, createGroupQuery, map[string]any{"input": input})
		if err != nil || status != 400 || !bytes.Contains(body, []byte("BAD_USER_INPUT")) {
			t.Fatalf("key accepted: %d %s %v", status, body, err)
		}
	}
	input := tripGroupInput()
	input["trip"].(map[string]any)["destination"] = "\x00"
	status, body, err := groupHTTP(f, 1, createGroupQuery, map[string]any{"input": input})
	if err != nil || status != 400 || !bytes.Contains(body, []byte("BAD_USER_INPUT")) {
		t.Fatalf("NUL destination accepted: %d %s %v", status, body, err)
	}
	recoverGroup(t, f, 1, input["operationKey"], "GroupCreationNotStarted")
	if got := groupRequest(t, f, 9, createGroupQuery, map[string]any{"input": ordinaryGroupInput()}, "createGroup", "Problem"); got["code"] != "NOT_FOUND" {
		t.Fatalf("unprovisioned creation: %v", got)
	}
	var count int
	if err := f.admin.QueryRow(f.ctx, `SELECT count(*) FROM app.group_creation_attempts WHERE creator_user_id=$1`, f.id(101)).Scan(&count); err != nil || count != 0 {
		t.Fatalf("invalid transport reserved attempts: %d %v", count, err)
	}
}
