//go:build integration

package expense_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"net/http"
	"reflect"
	"testing"
)

const repaymentSelection = `__typename ... on RepaymentCommitted{key record{repaymentId groupId creatorMembershipId senderMembershipId recipientMembershipId amountMinor currency effectiveDate note committedAt revision}} ... on ValidationProblem{fields{path code}} ... on OperationProgress{state} ... on Problem{code}`
const repaymentMutation = `mutation($input:RecordRepaymentInput!){recordRepayment(input:$input){` + repaymentSelection + ` ... on OperationMismatch{key}}}`
const repaymentRecovery = `query($group:ID!,$key:OperationKey!){repaymentOperation(groupId:$group,key:$key){` + repaymentSelection + `}}`
const repaymentHistory = `query($group:ID!,$first:Int!,$after:String){group(id:$group){__typename ... on Group{id repayments(first:$first,after:$after){revision edges{cursor node{id effectiveDate note revision creator{id} sender{id canParticipate} recipient{id canParticipate}}} pageInfo{hasNextPage hasPreviousPage startCursor endCursor}} balances{... on GroupBalances{revision totalExpenseMinor positions{member{id} paidMinor owedMinor sentMinor receivedMinor netMinor}}}}}}`

func repaymentGraphQL(t *testing.T, f *expenseFixture, actor int, q string, v map[string]any) map[string]any {
	t.Helper()
	body, err := json.Marshal(map[string]any{"query": q, "variables": v})
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequestWithContext(f.ctx, http.MethodPost, f.endpoint.URL+"/graphql", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if actor > 0 {
		req.Header.Set("Authorization", "Bearer "+f.token(actor))
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	if err = json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("HTTP %d: %v", res.StatusCode, err)
	}
	return out
}
func repaymentGQLInput(f *expenseFixture) map[string]any {
	return map[string]any{"groupId": f.input.GroupID, "key": uuid.NewString(), "senderId": f.public("Membership", 301), "recipientId": f.public("Membership", 302), "amountMinor": "999999999", "currency": "USD", "effectiveDate": "2026-09-30", "note": " actual transfer "}
}
func repaymentData(t *testing.T, out map[string]any, field string) map[string]any {
	t.Helper()
	if out["errors"] != nil {
		t.Fatalf("GraphQL: %v", out)
	}
	data, ok := out["data"].(map[string]any)
	if !ok {
		t.Fatal(out)
	}
	value, ok := data[field].(map[string]any)
	if !ok {
		t.Fatal(out)
	}
	return value
}
func repaymentGQLRecord(t *testing.T, f *expenseFixture, actor int, in map[string]any) map[string]any {
	t.Helper()
	return repaymentData(t, repaymentGraphQL(t, f, actor, repaymentMutation, map[string]any{"input": in}), "recordRepayment")
}

func TestRepaymentGraphQLReceiptBalancesAndRecovery(t *testing.T) {
	f := newExpenseFixture(t)
	in := repaymentGQLInput(f)
	saved := repaymentGQLRecord(t, f, 3, in)
	if saved["__typename"] != "RepaymentCommitted" {
		t.Fatal(saved)
	}
	record := saved["record"].(map[string]any)
	for field, want := range map[string]any{"groupId": in["groupId"], "creatorMembershipId": f.public("Membership", 303), "senderMembershipId": in["senderId"], "recipientMembershipId": in["recipientId"], "amountMinor": "999999999", "currency": "USD", "effectiveDate": in["effectiveDate"], "note": in["note"], "revision": "2"} {
		if record[field] != want {
			t.Errorf("%s=%v want %v", field, record[field], want)
		}
	}
	if retry := repaymentGQLRecord(t, f, 3, in); !reflect.DeepEqual(retry, saved) {
		t.Fatal(retry)
	}
	in["amountMinor"] = "1"
	if mismatch := repaymentGQLRecord(t, f, 3, in); mismatch["__typename"] != "OperationMismatch" {
		t.Fatal(mismatch)
	}
	vars := map[string]any{"group": in["groupId"], "key": in["key"]}
	other := repaymentData(t, repaymentGraphQL(t, f, 1, repaymentRecovery, vars), "repaymentOperation")
	if other["__typename"] != "OperationProgress" || other["state"] != "NOT_OBSERVED" {
		t.Fatal(other)
	}
	next := f.input
	next.Key = uuid.NewString()
	if out := f.create(1, next); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	recovered := repaymentData(t, repaymentGraphQL(t, f, 3, repaymentRecovery, vars), "repaymentOperation")
	if !reflect.DeepEqual(recovered, saved) {
		t.Fatal(recovered)
	}
	group := repaymentData(t, repaymentGraphQL(t, f, 1, repaymentHistory, map[string]any{"group": in["groupId"], "first": 10}), "group")
	balances := group["balances"].(map[string]any)
	if balances["revision"] != "3" || balances["totalExpenseMinor"] != "2000" {
		t.Fatal(balances)
	}
	wants := map[string][]string{f.public("Membership", 301): {"999999999", "0", "999999331"}, f.public("Membership", 302): {"0", "999999999", "-1000000665"}, f.public("Membership", 303): {"0", "0", "1334"}}
	for _, raw := range balances["positions"].([]any) {
		p := raw.(map[string]any)
		want := wants[p["member"].(map[string]any)["id"].(string)]
		for i, key := range []string{"sentMinor", "receivedMinor", "netMinor"} {
			if p[key] != want[i] {
				t.Errorf("position %v %s want %s", p, key, want[i])
			}
		}
	}
	if counts := repaymentCounts(t, f); counts != [4]int{1, 1, 1, 3} {
		t.Fatal(counts)
	}
}

func TestRepaymentGraphQLHistoryAnchorAliasesAndCursorScopes(t *testing.T) {
	f := newExpenseFixture(t)
	vars := map[string]any{"group": f.input.GroupID, "first": 1}
	empty := repaymentData(t, repaymentGraphQL(t, f, 1, repaymentHistory, vars), "group")["repayments"].(map[string]any)
	info := empty["pageInfo"].(map[string]any)
	if len(empty["edges"].([]any)) != 0 || info["startCursor"] != nil || info["endCursor"] != nil || info["hasNextPage"] != false {
		t.Fatal(empty)
	}
	ids := []any{}
	for _, date := range []string{"2026-09-29", "2026-09-30", "2026-09-30"} {
		in := repaymentGQLInput(f)
		in["effectiveDate"] = date
		out := repaymentGQLRecord(t, f, 3, in)
		ids = append(ids, out["record"].(map[string]any)["repaymentId"])
	}
	first := repaymentData(t, repaymentGraphQL(t, f, 1, repaymentHistory, vars), "group")["repayments"].(map[string]any)
	if first["edges"].([]any)[0].(map[string]any)["node"].(map[string]any)["id"] != ids[2] {
		t.Fatal(first)
	}
	cursor := first["pageInfo"].(map[string]any)["endCursor"]
	in := repaymentGQLInput(f)
	in["effectiveDate"] = "2026-09-28"
	repaymentGQLRecord(t, f, 3, in)
	vars["after"] = cursor
	vars["first"] = 10
	group := repaymentData(t, repaymentGraphQL(t, f, 1, repaymentHistory, vars), "group")
	page := group["repayments"].(map[string]any)
	edges := page["edges"].([]any)
	if page["revision"] != "4" || group["balances"].(map[string]any)["revision"] != "5" || len(edges) != 2 {
		t.Fatal(group)
	}
	for i, want := range []any{ids[1], ids[0]} {
		if edges[i].(map[string]any)["node"].(map[string]any)["id"] != want {
			t.Fatal(edges)
		}
	}
	aliases := `query($group:ID!){group(id:$group){... on Group{a:repayments(first:1){edges{node{id}}} b:repayments(first:100){edges{node{id}}} expenses(first:1){pageInfo{endCursor}}}}}`
	aliased := repaymentData(t, repaymentGraphQL(t, f, 1, aliases, vars), "group")
	if len(aliased["a"].(map[string]any)["edges"].([]any)) != 1 || len(aliased["b"].(map[string]any)["edges"].([]any)) != 4 {
		t.Fatal(aliased)
	}
	expenseCursor := aliased["expenses"].(map[string]any)["pageInfo"].(map[string]any)["endCursor"]
	for _, bad := range []map[string]any{{"group": f.input.GroupID, "first": 0}, {"group": f.input.GroupID, "first": 101}, {"group": f.input.GroupID, "first": 1, "after": "invalid"}, {"group": f.input.GroupID, "first": 1, "after": expenseCursor}, {"group": f.public("Group", 202), "first": 1, "after": cursor}} {
		actor := 1
		if bad["group"] == f.public("Group", 202) {
			actor = 4
		}
		out := repaymentGraphQL(t, f, actor, repaymentHistory, bad)
		if out["errors"] == nil {
			t.Fatal(out)
		}
		g := out["data"].(map[string]any)["group"].(map[string]any)
		if g["repayments"] != nil || g["balances"] == nil {
			t.Fatal(out)
		}
	}
}

func TestRepaymentGraphQLCurrentAuthorizationAndValidation(t *testing.T) {
	f := newExpenseFixture(t)
	in := repaymentGQLInput(f)
	saved := repaymentGQLRecord(t, f, 3, in)
	id := saved["record"].(map[string]any)["repaymentId"]
	nodeQuery := `query($id:ID!){node(id:$id){id ... on Repayment{amountMinor sender{id canParticipate} recipient{id canParticipate} creator{id}}}}`
	if got := repaymentData(t, repaymentGraphQL(t, f, 2, nodeQuery, map[string]any{"id": id}), "node"); got["amountMinor"] != "999999999" {
		t.Fatal(got)
	}
	foreign := repaymentGraphQL(t, f, 4, nodeQuery, map[string]any{"id": id})
	if foreign["data"].(map[string]any)["node"] != nil {
		t.Fatal(foreign)
	}
	for _, change := range []map[string]any{{"amountMinor": "0"}, {"amountMinor": "1000000000"}, {"currency": "EUR"}, {"senderId": f.public("Membership", 304)}, {"recipientId": f.public("Membership", 301)}} {
		attempt := repaymentGQLInput(f)
		for k, v := range change {
			attempt[k] = v
		}
		out := repaymentGQLRecord(t, f, 1, attempt)
		if out["__typename"] != "ValidationProblem" {
			t.Fatal(out)
		}
		recovered := repaymentData(t, repaymentGraphQL(t, f, 1, repaymentRecovery, map[string]any{"group": attempt["groupId"], "key": attempt["key"]}), "repaymentOperation")
		if !reflect.DeepEqual(out, recovered) {
			t.Fatal(out, recovered)
		}
	}
	for _, bad := range []any{1.5, "1.5", "01"} {
		attempt := repaymentGQLInput(f)
		attempt["amountMinor"] = bad
		out := repaymentGraphQL(t, f, 1, repaymentMutation, map[string]any{"input": attempt})
		if out["errors"] == nil {
			t.Fatal(out)
		}
	}
	unauth := repaymentGraphQL(t, f, 0, repaymentMutation, map[string]any{"input": in})
	if unauth["errors"] == nil {
		t.Fatal(unauth)
	}
	f.exec(fmt.Sprintf("SET ROLE kami_migrator;UPDATE app.memberships SET active=false WHERE id='%s';RESET ROLE", f.id(302)))
	retained := repaymentData(t, repaymentGraphQL(t, f, 1, nodeQuery, map[string]any{"id": id}), "node")
	if retained["recipient"].(map[string]any)["canParticipate"] != false {
		t.Fatal(retained)
	}
	f.exec(fmt.Sprintf("SET ROLE kami_migrator;UPDATE app.memberships SET active=false WHERE id='%s';RESET ROLE", f.id(303)))
	denied := repaymentData(t, repaymentGraphQL(t, f, 3, repaymentRecovery, map[string]any{"group": in["groupId"], "key": in["key"]}), "repaymentOperation")
	if denied["__typename"] != "Problem" {
		t.Fatal(denied)
	}
	history := repaymentData(t, repaymentGraphQL(t, f, 3, repaymentHistory, map[string]any{"group": in["groupId"], "first": 10}), "group")
	if history["__typename"] != "Problem" {
		t.Fatal(history)
	}
}
