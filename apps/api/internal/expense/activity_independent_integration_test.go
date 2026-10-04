//go:build integration

package expense_test

import (
	"fmt"
	"testing"

	"github.com/google/uuid"
)

const independentActivityQuery = `query($group:ID!,$first:Int!,$after:String,$filter:ActivityFilter){groupActivity(groupId:$group,first:$first,after:$after,filter:$filter){__typename ... on Problem{code} ... on ActivityConnection{edges{cursor node{id recordId kind groupId groupName amountMinor currency effectiveDate timestamp creator{id displayName} payer{id} sender{id} recipient{id}}} pageInfo{hasNextPage startCursor endCursor}}}}`

func independentActivity(t *testing.T, f *expenseFixture, actor int, variables map[string]any) map[string]any {
	t.Helper()
	return repaymentData(t, repaymentGraphQL(t, f, actor, independentActivityQuery, variables), "groupActivity")
}

func TestActivityIndependentPaginationProvenanceAndDuplicates(t *testing.T) {
	f := newExpenseFixture(t)
	in := repaymentGQLInput(f)
	in["effectiveDate"] = "2000-01-01"
	saved := repaymentGQLRecord(t, f, 3, in)
	if saved["__typename"] != "RepaymentCommitted" {
		t.Fatal(saved)
	}
	if retry := repaymentGQLRecord(t, f, 3, in); retry["record"].(map[string]any)["repaymentId"] != saved["record"].(map[string]any)["repaymentId"] {
		t.Fatal(retry)
	}
	vars := map[string]any{"group": f.input.GroupID, "first": 1}
	first := independentActivity(t, f, 1, vars)
	edges := first["edges"].([]any)
	if len(edges) != 1 {
		t.Fatal(first)
	}
	node := edges[0].(map[string]any)["node"].(map[string]any)
	if node["kind"] != "REPAYMENT_RECORDED" || node["effectiveDate"] != "2000-01-01" || node["recordId"] != saved["record"].(map[string]any)["repaymentId"] || node["amountMinor"] != "999999999" || node["creator"].(map[string]any)["id"] != f.public("Membership", 303) || node["payer"] != nil {
		t.Fatal(node)
	}
	if first["pageInfo"].(map[string]any)["hasNextPage"] != true {
		t.Fatal(first)
	}
	cursor := first["pageInfo"].(map[string]any)["endCursor"]
	next := f.input
	next.Key = uuid.NewString()
	if out := f.create(1, next); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	vars["after"] = cursor
	vars["first"] = 100
	continuation := independentActivity(t, f, 1, vars)
	rest := continuation["edges"].([]any)
	if len(rest) != 1 || continuation["pageInfo"].(map[string]any)["hasNextPage"] != false {
		t.Fatal(continuation)
	}
	expense := rest[0].(map[string]any)["node"].(map[string]any)
	if expense["kind"] != "EXPENSE_CREATED" || expense["amountMinor"] != "1000" || expense["sender"] != nil || expense["recipient"] != nil {
		t.Fatal(expense)
	}
	delete(vars, "after")
	refreshed := independentActivity(t, f, 1, vars)
	if len(refreshed["edges"].([]any)) != 3 {
		t.Fatal(refreshed)
	}
	vars["filter"] = map[string]any{"kind": "REPAYMENT_RECORDED"}
	filtered := independentActivity(t, f, 1, vars)
	if len(filtered["edges"].([]any)) != 1 {
		t.Fatal(filtered)
	}
}

func TestActivityIndependentCursorBindingsAndCurrentAuthorization(t *testing.T) {
	f := newExpenseFixture(t)
	vars := map[string]any{"group": f.input.GroupID, "first": 1}
	first := independentActivity(t, f, 1, vars)
	cursor := first["pageInfo"].(map[string]any)["endCursor"]
	for _, scenario := range []struct {
		actor     int
		variables map[string]any
		code      string
	}{
		{2, map[string]any{"group": f.input.GroupID, "first": 1, "after": cursor}, "INVALID_CURSOR"},
		{1, map[string]any{"group": f.input.GroupID, "first": 1, "after": cursor, "filter": map[string]any{"kind": "EXPENSE_CREATED"}}, "INVALID_CURSOR"},
		{1, map[string]any{"group": f.input.GroupID, "first": 1, "after": "invalid"}, "INVALID_CURSOR"},
		{1, map[string]any{"group": f.input.GroupID, "first": 0}, "INVALID_INPUT"},
		{1, map[string]any{"group": f.input.GroupID, "first": 101}, "INVALID_INPUT"},
		{1, map[string]any{"group": f.input.GroupID, "first": 1, "filter": map[string]any{"sourceGroupId": f.public("Group", 202)}}, "NOT_FOUND"},
		{4, map[string]any{"group": f.input.GroupID, "first": 1, "after": cursor}, "NOT_FOUND"},
	} {
		got := independentActivity(t, f, scenario.actor, scenario.variables)
		if got["__typename"] != "Problem" || got["code"] != scenario.code {
			t.Errorf("actor %d vars %v: %v", scenario.actor, scenario.variables, got)
		}
	}
	f.exec(fmt.Sprintf("SET ROLE kami_migrator;UPDATE app.memberships SET active=false WHERE id='%s';RESET ROLE", f.id(301)))
	vars["after"] = cursor
	if got := independentActivity(t, f, 1, vars); got["__typename"] != "Problem" || got["code"] != "NOT_FOUND" {
		t.Fatal(got)
	}
}
