//go:build integration

package expense_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
)

const groupCreationFields = `__typename ... on GroupCreationCompleted { operationKey groupId creatorMembershipId createdAt } ... on GroupCreationRejected { operationKey fields { path code message } } ... on GroupCreationConflict { operationKey } ... on Problem { code message }`
const groupRecoveryFields = `__typename ... on GroupCreationCompleted { operationKey groupId creatorMembershipId createdAt } ... on GroupCreationRejected { operationKey fields { path code message } } ... on GroupCreationNotStarted { operationKey } ... on Problem { code message }`
const createGroupQuery = `mutation($input:CreateGroupInput!){createGroup(input:$input){` + groupCreationFields + `}}`
const recoverGroupQuery = `query($key:OperationKey!){groupCreationOperation(operationKey:$key){` + groupRecoveryFields + `}}`

func newGroupTransportFixture(t *testing.T) *expenseFixture {
	t.Helper()
	f := newExpenseFixture(t)
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator; INSERT INTO app.installation(household_group_id,group_creator_user_id) VALUES('%s','%s'); RESET ROLE`, f.id(201), f.id(101)))
	t.Cleanup(func() {
		_, err := f.admin.Exec(context.Background(), fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator;
  DELETE FROM app.installation WHERE household_group_id='%s';
  CREATE TEMP TABLE group_transport_cleanup AS SELECT group_id FROM app.group_creation_attempts WHERE creator_user_id IN ('%s','%s') AND group_id IS NOT NULL;
  DELETE FROM app.group_creation_attempts WHERE creator_user_id IN ('%s','%s');
  DELETE FROM app.group_trip WHERE group_id IN (SELECT group_id FROM group_transport_cleanup);
  DELETE FROM app.memberships WHERE group_id IN (SELECT group_id FROM group_transport_cleanup);
  DELETE FROM app.groups WHERE id IN (SELECT group_id FROM group_transport_cleanup);
  DROP TABLE group_transport_cleanup; COMMIT;`, f.id(201), f.id(101), f.id(102), f.id(101), f.id(102)))
		if err != nil {
			t.Errorf("group fixture cleanup: %v", err)
		}
	})
	return f
}
func groupHTTP(f *expenseFixture, actor int, query string, variables map[string]any) (int, []byte, error) {
	body, err := json.Marshal(map[string]any{"query": query, "variables": variables})
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequestWithContext(f.ctx, "POST", f.endpoint.URL+"/graphql", bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if actor != 0 {
		req.Header.Set("Authorization", "Bearer "+f.token(actor))
	}
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	return response.StatusCode, data, err
}
func groupRequest(t *testing.T, f *expenseFixture, actor int, query string, variables map[string]any, field, kind string) map[string]any {
	t.Helper()
	status, body, err := groupHTTP(f, actor, query, variables)
	var result struct {
		Data   map[string]map[string]any
		Errors []any
	}
	if err != nil || json.Unmarshal(body, &result) != nil || status != 200 || len(result.Errors) != 0 || result.Data[field]["__typename"] != kind {
		t.Fatalf("group HTTP expected %s: status=%d body=%s err=%v", kind, status, body, err)
	}
	return result.Data[field]
}
func ordinaryGroupInput() map[string]any {
	return map[string]any{"operationKey": uuid.NewString(), "name": "  Friends\t\r\n", "kind": "ORDINARY"}
}
func tripGroupInput() map[string]any {
	input := ordinaryGroupInput()
	input["kind"] = "TRIP"
	input["trip"] = map[string]any{"startDate": "2024-02-29", "endDate": "2024-02-29"}
	return input
}
func createGroup(t *testing.T, f *expenseFixture, input map[string]any, kind string) map[string]any {
	t.Helper()
	return groupRequest(t, f, 1, createGroupQuery, map[string]any{"input": input}, "createGroup", kind)
}
func recoverGroup(t *testing.T, f *expenseFixture, actor int, key any, kind string) map[string]any {
	t.Helper()
	return groupRequest(t, f, actor, recoverGroupQuery, map[string]any{"key": key}, "groupCreationOperation", kind)
}

func TestGroupHTTPDiscoveryCanonicalRecoveryAndCurrentAccess(t *testing.T) {
	f := newGroupTransportFixture(t)
	input := tripGroupInput()
	first := createGroup(t, f, input, "GroupCreationCompleted")
	input["name"] = "Friends"
	trip := input["trip"].(map[string]any)
	for _, destination := range []any{nil, ""} {
		trip["destination"] = destination
		if replay := createGroup(t, f, input, "GroupCreationCompleted"); !reflect.DeepEqual(first, replay) {
			t.Fatal("canonical replay changed original result")
		}
	}
	if got := recoverGroup(t, f, 1, input["operationKey"], "GroupCreationCompleted"); !reflect.DeepEqual(first, got) {
		t.Fatal("recovery changed original result")
	}
	input["name"] = "changed"
	createGroup(t, f, input, "GroupCreationConflict")
	input["name"] = "Friends"
	ordinary := ordinaryGroupInput()
	second := createGroup(t, f, ordinary, "GroupCreationCompleted")
	ordinary["name"] = "Friends"
	ordinary["trip"] = nil
	if replay := createGroup(t, f, ordinary, "GroupCreationCompleted"); !reflect.DeepEqual(second, replay) {
		t.Fatal("null ordinary trip changed canonical input")
	}
	recoverGroup(t, f, 1, uuid.NewString(), "GroupCreationNotStarted")
	query := `{viewer{__typename ... on Viewer{id today canCreateGroups groups{id name currency kind isHousehold trip{destination startDate endDate}}}}}`
	v := groupRequest(t, f, 1, query, nil, "viewer", "Viewer")
	if v["today"] != time.Now().UTC().Format("2006-01-02") || v["canCreateGroups"] != true {
		t.Fatalf("viewer=%v", v)
	}
	groups := v["groups"].([]any)
	ids := []string{}
	if len(groups) != 3 {
		t.Fatalf("groups=%v", groups)
	}
	for _, item := range groups {
		g := item.(map[string]any)
		ids = append(ids, g["id"].(string))
		if g["id"] == first["groupId"] {
			if g["kind"] != "TRIP" || g["isHousehold"] != false || g["trip"].(map[string]any)["startDate"] != "2024-02-29" {
				t.Fatalf("trip=%v", g)
			}
		} else if g["kind"] != "ORDINARY" || g["trip"] != nil || g["isHousehold"] != (g["id"] == f.public("Group", 201)) {
			t.Fatalf("ordinary=%v", g)
		}
	}
	if !sort.StringsAreSorted(ids) {
		t.Fatalf("noncanonical order %v", ids)
	}
	peer := groupRequest(t, f, 4, query, nil, "viewer", "Viewer")
	if peer["canCreateGroups"] != false || len(peer["groups"].([]any)) != 1 || peer["groups"].([]any)[0].(map[string]any)["isHousehold"] != false {
		t.Fatalf("household leaked: %v", peer)
	}
	raw, _ := ledger.ParseID(first["groupId"].(string), "Group")
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.groups SET name='Current name' WHERE id='%s'; RESET ROLE`, raw))
	current := groupRequest(t, f, 1, `query($id:ID!){group(id:$id){__typename ... on Group{id name kind isHousehold trip{destination startDate endDate} members{id} balances{__typename}} ... on Problem{code}}}`, map[string]any{"id": first["groupId"]}, "group", "Group")
	if current["name"] != "Current name" || current["kind"] != "TRIP" || len(current["members"].([]any)) != 1 {
		t.Fatalf("fresh group=%v", current)
	}
	if receipt := recoverGroup(t, f, 1, input["operationKey"], "GroupCreationCompleted"); !reflect.DeepEqual(receipt, first) {
		t.Fatal("mutable metadata changed receipt")
	}
	for _, id := range []any{first["creatorMembershipId"], f.public("Group", 202)} {
		denied := groupRequest(t, f, 1, `query($id:ID!){group(id:$id){__typename ... on Problem{code}}}`, map[string]any{"id": id}, "group", "Problem")
		if denied["code"] != "NOT_FOUND" && denied["code"] != "INVALID_INPUT" {
			t.Fatalf("wrong/cross-group ID=%v", denied)
		}
	}
	// Current access is required for original receipt and replay, even after transfer.
	owner, _ := ledger.ParseID(first["creatorMembershipId"].(string), "Membership")
	replacement := uuid.NewString()
	f.exec(fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; INSERT INTO app.memberships(id,group_id,user_id) VALUES('%s','%s','%s'); UPDATE app.groups SET owner_membership_id='%s' WHERE id='%s'; UPDATE app.memberships SET active=false WHERE id='%s'; COMMIT; RESET ROLE`, replacement, raw, f.id(102), replacement, raw, owner))
	if denied := recoverGroup(t, f, 1, input["operationKey"], "Problem"); denied["code"] != "NOT_FOUND" {
		t.Fatalf("removed receipt=%v", denied)
	}
	if denied := createGroup(t, f, input, "Problem"); denied["code"] != "NOT_FOUND" {
		t.Fatalf("removed replay=%v", denied)
	}
	v = groupRequest(t, f, 1, query, nil, "viewer", "Viewer")
	for _, g := range v["groups"].([]any) {
		if g.(map[string]any)["id"] == first["groupId"] {
			t.Fatal("removed group in discovery")
		}
	}
	// Nondesignated peers cannot probe attempts. Even a newly designated peer only sees its own namespace.
	if denied := recoverGroup(t, f, 2, input["operationKey"], "Problem"); denied["code"] != "FORBIDDEN" {
		t.Fatalf("peer=%v", denied)
	}
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.installation SET group_creator_user_id='%s'; RESET ROLE`, f.id(102)))
	recoverGroup(t, f, 2, input["operationKey"], "GroupCreationNotStarted")
	if denied := recoverGroup(t, f, 1, ordinary["operationKey"], "Problem"); denied["code"] != "FORBIDDEN" {
		t.Fatalf("revoked grant=%v", denied)
	}
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.installation SET group_creator_user_id='%s'; UPDATE app.users SET enabled=false WHERE id='%s'; RESET ROLE`, f.id(101), f.id(101)))
	if denied := recoverGroup(t, f, 1, ordinary["operationKey"], "Problem"); denied["code"] != "NOT_FOUND" {
		t.Fatalf("disabled=%v", denied)
	}
	if denied := createGroup(t, f, ordinary, "Problem"); denied["code"] != "NOT_FOUND" {
		t.Fatalf("disabled write=%v", denied)
	}
	if denied := recoverGroup(t, f, 9, input["operationKey"], "Problem"); denied["code"] != "NOT_FOUND" {
		t.Fatalf("unprovisioned=%v", denied)
	}
	status, body, err := groupHTTP(f, 0, recoverGroupQuery, map[string]any{"key": input["operationKey"]})
	if err != nil || status != 401 || !bytes.Contains(body, []byte("UNAUTHENTICATED")) {
		t.Fatalf("missing auth: %d %s %v", status, body, err)
	}
}

func TestGroupHTTPValidationAndUnicode(t *testing.T) {
	f := newGroupTransportFixture(t)
	cases := []struct {
		name   string
		change func(map[string]any)
		kind   string
	}{
		{"120 scalars", func(i map[string]any) { i["name"] = strings.Repeat("🌏", 120) }, "GroupCreationCompleted"},
		{"121 scalars", func(i map[string]any) { i["name"] = strings.Repeat("🌏", 121) }, "GroupCreationRejected"},
		{"empty", func(i map[string]any) { i["name"] = " \r\n\t" }, "GroupCreationRejected"},
		{"missing trip", func(i map[string]any) { delete(i, "trip") }, "GroupCreationRejected"},
		{"ordinary trip", func(i map[string]any) { i["kind"] = "ORDINARY" }, "GroupCreationRejected"},
		{"200 destination scalars", func(i map[string]any) { i["trip"].(map[string]any)["destination"] = strings.Repeat("🌏", 200) }, "GroupCreationCompleted"},
		{"201 destination scalars", func(i map[string]any) { i["trip"].(map[string]any)["destination"] = strings.Repeat("🌏", 201) }, "GroupCreationRejected"},
		{"reversed dates", func(i map[string]any) { i["trip"].(map[string]any)["endDate"] = "2024-02-28" }, "GroupCreationRejected"},
		{"date bounds", func(i map[string]any) {
			trip := i["trip"].(map[string]any)
			trip["startDate"] = "0001-01-01"
			trip["endDate"] = "9999-12-31"
		}, "GroupCreationCompleted"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := tripGroupInput()
			tc.change(input)
			first := createGroup(t, f, input, tc.kind)
			if replay := recoverGroup(t, f, 1, input["operationKey"], tc.kind); !reflect.DeepEqual(first, replay) {
				t.Fatal("durable result differs")
			}
			if tc.kind == "GroupCreationRejected" {
				input["name"] = "Correction"
				createGroup(t, f, input, "GroupCreationConflict")
			}
		})
	}
	for _, change := range []func(map[string]any){
		func(i map[string]any) { i["name"] = "nul\x00text" },
		func(i map[string]any) { i["trip"].(map[string]any)["startDate"] = "2023-02-29" },
		func(i map[string]any) { i["trip"].(map[string]any)["endDate"] = "0000-01-01" },
		func(i map[string]any) { i["trip"].(map[string]any)["startDate"] = nil },
		func(i map[string]any) { i["kind"] = nil },
		func(i map[string]any) { i["kind"] = "HOUSEHOLD" },
		func(i map[string]any) { i["ownerId"] = f.id(102) },
		func(i map[string]any) { i["name"] = 17 },
	} {
		input := tripGroupInput()
		change(input)
		status, body, err := groupHTTP(f, 1, createGroupQuery, map[string]any{"input": input})
		if err != nil || status != 400 || !bytes.Contains(body, []byte("BAD_USER_INPUT")) {
			t.Fatalf("scalar accepted: %d %s %v", status, body, err)
		}
		recoverGroup(t, f, 1, input["operationKey"], "GroupCreationNotStarted")
	}
	// A malformed later field must prevent the valid earlier creation too.
	key := uuid.NewString()
	query := fmt.Sprintf(`mutation{first:createGroup(input:{operationKey:"%s",name:"first",kind:ORDINARY}){__typename} second:createGroup(input:{operationKey:"%s",name:"second",kind:TRIP,trip:{startDate:"2023-02-29",endDate:"2024-02-29"}}){__typename}}`, key, uuid.NewString())
	status, body, err := groupHTTP(f, 1, query, nil)
	if err != nil || status != 400 {
		t.Fatalf("partial mutation: %d %s %v", status, body, err)
	}
	recoverGroup(t, f, 1, key, "GroupCreationNotStarted")
	// Composed and decomposed Unicode are distinct intents; destination whitespace is exact.
	input := tripGroupInput()
	input["name"] = "é"
	input["trip"].(map[string]any)["destination"] = "  京都 🌏  "
	first := createGroup(t, f, input, "GroupCreationCompleted")
	input["name"] = "e\u0301"
	createGroup(t, f, input, "GroupCreationConflict")
	g := groupRequest(t, f, 1, `query($id:ID!){group(id:$id){__typename ... on Group{trip{destination}}}}`, map[string]any{"id": first["groupId"]}, "group", "Group")
	if g["trip"].(map[string]any)["destination"] != "  京都 🌏  " {
		t.Fatal("destination normalized")
	}
}

func TestGroupHTTPConcurrentAndLostResponse(t *testing.T) {
	f := newGroupTransportFixture(t)
	input := ordinaryGroupInput()
	type reply struct {
		status int
		body   []byte
		err    error
	}
	replies := make(chan reply, 8)
	var wg sync.WaitGroup
	for n := 0; n < 8; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			status, body, err := groupHTTP(f, 1, createGroupQuery, map[string]any{"input": input})
			replies <- reply{status, body, err}
		}()
	}
	wg.Wait()
	close(replies)
	var first map[string]any
	for r := range replies {
		var envelope struct{ Data map[string]map[string]any }
		if r.err != nil || r.status != 200 || json.Unmarshal(r.body, &envelope) != nil || envelope.Data["createGroup"]["__typename"] != "GroupCreationCompleted" {
			t.Fatalf("concurrent=%d %s %v", r.status, r.body, r.err)
		}
		if first == nil {
			first = envelope.Data["createGroup"]
		} else if !reflect.DeepEqual(first, envelope.Data["createGroup"]) {
			t.Fatal("same key created multiple groups")
		}
	}
	var count int
	if err := f.admin.QueryRow(f.ctx, `SELECT count(*) FROM app.group_creation_attempts WHERE creator_user_id=$1`, f.id(101)).Scan(&count); err != nil || count != 1 {
		t.Fatalf("attempt count=%d %v", count, err)
	}
	// Lose the client connection only after the genuine authenticated HTTP mutation completes.
	input = ordinaryGroupInput()
	finished := make(chan error, 1)
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		status, body, err := groupHTTP(f, 1, createGroupQuery, map[string]any{"input": input})
		if err == nil && (status != 200 || !bytes.Contains(body, []byte("GroupCreationCompleted"))) {
			err = fmt.Errorf("unexpected upstream result")
		}
		finished <- err
		conn, _, e := w.(http.Hijacker).Hijack()
		if e == nil {
			_ = conn.Close()
		}
	}))
	defer proxy.Close()
	req, _ := http.NewRequestWithContext(f.ctx, "POST", proxy.URL, strings.NewReader("lost response"))
	response, err := http.DefaultClient.Do(req)
	if response != nil {
		response.Body.Close()
	}
	if err == nil {
		t.Fatal("response was not lost")
	}
	if err = <-finished; err != nil {
		t.Fatal(err)
	}
	original := recoverGroup(t, f, 1, input["operationKey"], "GroupCreationCompleted")
	if replay := createGroup(t, f, input, "GroupCreationCompleted"); !reflect.DeepEqual(replay, original) {
		t.Fatal("lost response duplicated creation")
	}
}
