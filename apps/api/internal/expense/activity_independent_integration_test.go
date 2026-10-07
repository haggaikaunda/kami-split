//go:build integration

package expense_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
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
	injectHistoricalDeparture(t, f, f.id(302))
	vars["after"] = cursor
	if got := independentActivity(t, f, 2, vars); got["__typename"] != "Problem" || got["code"] != "NOT_FOUND" {
		t.Fatal(got)
	}
}

func TestActivityIndependentEqualTimestampTiePagination(t *testing.T) {
	f := newExpenseFixture(t)
	second := f.input
	second.Key = uuid.NewString()
	saved := f.create(1, second)
	if saved.Kind != "COMMITTED" {
		t.Fatal(saved)
	}
	repayment := repaymentGQLRecord(t, f, 3, repaymentGQLInput(f))
	if repayment["__typename"] != "RepaymentCommitted" {
		t.Fatal(repayment)
	}
	// Inject a historical equal-time fixture as the schema owner. Restore FORCE
	// RLS under the same exclusive table locks before publishing the fixture.
	tx, err := f.admin.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(f.ctx)
	if _, err = tx.Exec(f.ctx, "SET LOCAL session_replication_role=replica; SET LOCAL ROLE kami_migrator"); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"expenses", "repayments", "expense_audit", "repayment_audit", "expense_revisions"} {
		if _, err = tx.Exec(f.ctx, "ALTER TABLE app."+table+" NO FORCE ROW LEVEL SECURITY"); err != nil {
			t.Fatal(err)
		}
		column := "created_at"
		if table == "expense_revisions" {
			column = "recorded_at"
		}
		if table == "expense_audit" || table == "repayment_audit" {
			column = "committed_at"
		}
		if _, err = tx.Exec(f.ctx, "UPDATE app."+table+" SET "+column+"='2026-10-01T12:00:00.123456Z' WHERE group_id=$1", f.id(201)); err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec(f.ctx, "ALTER TABLE app."+table+" FORCE ROW LEVEL SECURITY"); err != nil {
			t.Fatal(err)
		}
	}
	if err = tx.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	vars := map[string]any{"group": f.input.GroupID, "first": 1}
	seen := []string{}
	kinds := []string{}
	for i := 0; i < 3; i++ {
		page := independentActivity(t, f, 1, vars)
		edges := page["edges"].([]any)
		if len(edges) != 1 {
			t.Fatal(page)
		}
		node := edges[0].(map[string]any)["node"].(map[string]any)
		seen = append(seen, node["id"].(string))
		kinds = append(kinds, node["kind"].(string))
		if node["timestamp"] != "2026-10-01T12:00:00.123456Z" {
			t.Fatal(node)
		}
		info := page["pageInfo"].(map[string]any)
		if info["hasNextPage"] != (i < 2) {
			t.Fatal(page)
		}
		vars["after"] = info["endCursor"]
	}
	if kinds[0] != "REPAYMENT_RECORDED" || kinds[1] != "EXPENSE_CREATED" || kinds[2] != "EXPENSE_CREATED" {
		t.Fatal(kinds)
	}
	if seen[0] == seen[1] || seen[1] == seen[2] || seen[1] < seen[2] {
		t.Fatal(seen)
	}
	delete(vars, "after")
	vars["first"] = 100
	all := independentActivity(t, f, 1, vars)["edges"].([]any)
	for i, raw := range all {
		if raw.(map[string]any)["node"].(map[string]any)["id"] != seen[i] {
			t.Fatal(all, seen)
		}
	}
}

func independentHouseholdActivity(t *testing.T, f *expenseFixture, actor int, vars map[string]any) map[string]any {
	t.Helper()
	query := strings.ReplaceAll(independentActivityQuery, "$group:ID!,", "")
	query = strings.ReplaceAll(query, "groupActivity(groupId:$group,", "householdActivity(")
	return repaymentData(t, repaymentGraphQL(t, f, actor, query, vars), "householdActivity")
}

func TestActivityIndependentHouseholdScopeTraversalAndSourcePrivacy(t *testing.T) {
	f := independentDashboardFixture(t)
	empty := independentHouseholdActivity(t, f, 1, map[string]any{"first": 10})
	if empty["__typename"] != "ActivityConnection" || len(empty["edges"].([]any)) != 0 {
		t.Fatal(empty)
	}
	independentDashboardExpense(t, f, 201, 302, 301, 2000)
	independentDashboardExpense(t, f, 202, 305, 306, 3000)
	independentDashboardExpense(t, f, 203, 308, 307, 9000)
	vars := map[string]any{"first": 1}
	first := independentHouseholdActivity(t, f, 1, vars)
	node := first["edges"].([]any)[0].(map[string]any)["node"].(map[string]any)
	if node["groupId"] != f.public("Group", 202) || node["amountMinor"] != "3000" {
		t.Fatal(first)
	}
	cursor := first["pageInfo"].(map[string]any)["endCursor"]
	vars["after"] = cursor
	second := independentHouseholdActivity(t, f, 1, vars)
	node = second["edges"].([]any)[0].(map[string]any)["node"].(map[string]any)
	if node["groupId"] != f.public("Group", 201) || second["pageInfo"].(map[string]any)["hasNextPage"] != false {
		t.Fatal(second)
	}
	for _, page := range []map[string]any{first, second} {
		raw, _ := json.Marshal(page)
		for _, secret := range []string{`"9000"`, "Viewer-only SECRET", f.id(203), f.public("Group", 203)} {
			if bytes.Contains(raw, []byte(secret)) {
				t.Fatalf("excluded source leaked: %s", raw)
			}
		}
	}
	for _, source := range []string{f.public("Group", 203), f.id(203)} {
		got := independentHouseholdActivity(t, f, 1, map[string]any{"first": 10, "filter": map[string]any{"sourceGroupId": source}})
		want := "NOT_FOUND"
		if source == f.id(203) {
			want = "INVALID_INPUT"
		}
		if got["__typename"] != "Problem" || got["code"] != want {
			t.Fatal(got)
		}
	}
	filtered := independentHouseholdActivity(t, f, 1, map[string]any{"first": 10, "filter": map[string]any{"sourceGroupId": f.public("Group", 201)}})
	if len(filtered["edges"].([]any)) != 1 {
		t.Fatal(filtered)
	}
	changed := independentHouseholdActivity(t, f, 1, map[string]any{"first": 1, "after": cursor, "filter": map[string]any{"sourceGroupId": f.public("Group", 201)}})
	if changed["code"] != "INVALID_CURSOR" {
		t.Fatal(changed)
	}
	injectHistoricalDeparture(t, f, f.id(306))
	if got := independentHouseholdActivity(t, f, 1, vars); got["code"] != "INVALID_CURSOR" {
		t.Fatal(got)
	}
	fresh := independentHouseholdActivity(t, f, 1, map[string]any{"first": 10})
	if len(fresh["edges"].([]any)) != 1 {
		t.Fatal(fresh)
	}
}

func TestActivityIndependentHouseholdAccountLossRechecksScope(t *testing.T) {
	f := independentDashboardFixture(t)
	independentDashboardExpense(t, f, 201, 302, 301, 2000)
	independentDashboardExpense(t, f, 202, 305, 306, 3000)
	first := independentHouseholdActivity(t, f, 1, map[string]any{"first": 1})
	cursor := first["pageInfo"].(map[string]any)["endCursor"]
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL ROLE kami_migrator;UPDATE app.users SET enabled=false WHERE id='%s';COMMIT`, f.id(102)))
	if got := independentHouseholdActivity(t, f, 1, map[string]any{"first": 1, "after": cursor}); got["__typename"] != "Problem" || got["code"] != "INVALID_CURSOR" {
		t.Fatal(got)
	}
	fresh := independentHouseholdActivity(t, f, 1, map[string]any{"first": 10})
	if fresh["__typename"] != "ActivityConnection" || len(fresh["edges"].([]any)) != 1 {
		t.Fatal(fresh)
	}
	if got := independentHouseholdActivity(t, f, 2, map[string]any{"first": 10}); got["code"] != "NOT_FOUND" {
		t.Fatal(got)
	}
}
