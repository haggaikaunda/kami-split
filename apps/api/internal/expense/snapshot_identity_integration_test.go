//go:build integration

package expense_test

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
)

const snapshotFields = `id expenseId version groupId description totalMinor effectiveDate category note split payer { id displayName } allocations { participant { id displayName } amountMinor percentageHundredths }`
const snapshotViewFields = `__typename ... on Problem { code } ... on ExpenseView { id contextVersion totalExpenseMinor expenseCount categories { category totalExpenseMinor } months { month totalExpenseMinor } edges { cursor snapshot { ` + snapshotFields + ` } } pageInfo { hasNextPage endCursor } }`
const snapshotIdentityQuery = `query($group:ID!,$expense:ID!,$after:String,$legacyAfter:String,$householdAfter:String,$filter:StructuredExpenseFilter){
 node(id:$expense) { __typename ... on Expense { id version totalMinor effectiveDate category note split payer { id displayName } allocations { participant { id } amountMinor percentageHundredths } } }
 group(id:$group) { __typename ... on Problem { code } ... on Group { id expenses(first:1,after:$legacyAfter) { id revision edges { cursor node { id version totalMinor } snapshot { ` + snapshotFields + ` } } pageInfo { endCursor } } } }
 groupExpenses(groupId:$group,first:1,after:$after,filter:$filter) { ` + snapshotViewFields + ` }
 householdExpenses(first:1,after:$householdAfter,filter:$filter) { ` + snapshotViewFields + ` }
}`

func snapshotEdge(t *testing.T, page map[string]any) map[string]any {
	t.Helper()
	edges, ok := page["edges"].([]any)
	if !ok || len(edges) != 1 {
		t.Fatalf("expected one snapshot edge: %+v", page)
	}
	return edges[0].(map[string]any)
}

func TestSnapshotIdentityAnchorsCurrentRefetchAndAuthorization(t *testing.T) {
	f := newGroupTransportFixture(t)
	newer := f.input
	newer.Key, newer.EffectiveDate, newer.Total = uuid.NewString(), "2026-10-01", 2000
	if out := f.create(1, newer); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	vars := map[string]any{"group": f.input.GroupID, "expense": f.original.Record.ExpenseID}
	read := func(actor int) map[string]map[string]any {
		return workspaceWireResponse(t, f, actor, snapshotIdentityQuery, vars)
	}
	first := read(1)
	firstGroup := first["group"]["expenses"].(map[string]any)
	firstView, firstHousehold := first["groupExpenses"], first["householdExpenses"]
	if firstView["id"] == firstHousehold["id"] || firstView["totalExpenseMinor"] != "3000" {
		t.Fatal("scope identity or complete totals lost")
	}
	// Canonical aliases share cache identity; a distinct filter remains separate
	// even when it happens to match exactly the same rows and totals.
	vars["filter"] = map[string]any{"category": "DINING"}
	filtered := read(1)
	vars["filter"] = map[string]any{"categories": []string{"DINING", "DINING"}}
	canonical := read(1)
	if filtered["groupExpenses"]["id"] != canonical["groupExpenses"]["id"] || filtered["groupExpenses"]["id"] == firstView["id"] {
		t.Fatal("filter identity lost canonical equivalence or distinct projection ownership")
	}
	delete(vars, "filter")
	originalViewID, originalContext := firstView["id"], firstView["contextVersion"]
	repeated := read(1)
	if repeated["groupExpenses"]["id"] != originalViewID {
		t.Fatal("identical projection changed identity")
	}

	edit := editInput(f)
	edit.Total, edit.EffectiveDate, edit.Category, edit.Note = 800, "2026-10-02", "GROCERIES", " corrected note "
	edit.PayerID = f.public("Membership", 302)
	edit.ParticipantIDs = []string{f.public("Membership", 301), f.public("Membership", 302)}
	edit.Split = "PERCENTAGE"
	edit.Percentages = []ledger.Percentage{{ParticipantID: f.public("Membership", 301), Hundredths: 2500}, {ParticipantID: f.public("Membership", 302), Hundredths: 7500}}
	if out := performEdit(t, f, 2, edit); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	fresh := read(1)
	if fresh["node"]["id"] != f.original.Record.ExpenseID || fresh["node"]["version"] != "2" || fresh["node"]["totalMinor"] != "800" {
		t.Fatal("current Node identity/refetch changed", fresh["node"])
	}
	if fresh["groupExpenses"]["id"] == originalViewID || fresh["groupExpenses"]["contextVersion"] != originalContext || fresh["groupExpenses"]["totalExpenseMinor"] != "2800" {
		t.Fatal("financial identity conflated with current context")
	}
	newSnapshot := snapshotEdge(t, fresh["groupExpenses"])["snapshot"].(map[string]any)
	if newSnapshot["id"] == newSnapshot["expenseId"] || newSnapshot["version"] != "2" || newSnapshot["split"] != "PERCENTAGE" {
		t.Fatal("snapshot identity or saved split lost")
	}
	allocations := newSnapshot["allocations"].([]any)
	if len(allocations) != 2 || allocations[0].(map[string]any)["amountMinor"] != "200" || allocations[0].(map[string]any)["percentageHundredths"] != float64(2500) {
		t.Fatal("snapshot allocations do not match version")
	}

	vars["after"] = firstView["pageInfo"].(map[string]any)["endCursor"]
	vars["legacyAfter"] = firstGroup["pageInfo"].(map[string]any)["endCursor"]
	vars["householdAfter"] = firstHousehold["pageInfo"].(map[string]any)["endCursor"]
	anchored := read(1)
	var oldSnapshotID any
	for _, field := range []string{"groupExpenses", "householdExpenses"} {
		page := anchored[field]
		old := snapshotEdge(t, page)["snapshot"].(map[string]any)
		if page["totalExpenseMinor"] != "3000" || page["expenseCount"] != "2" || old["expenseId"] != f.original.Record.ExpenseID || old["version"] != "1" || old["totalMinor"] != "1000" || old["category"] != "DINING" || old["effectiveDate"] != "2026-09-29" || len(old["allocations"].([]any)) != 3 {
			t.Fatalf("%s mixed anchors: %+v", field, page)
		}
		if old["id"] == newSnapshot["id"] || page["id"] == first[field]["id"] {
			t.Fatal("different version/page shared cache identity")
		}
		if oldSnapshotID != nil && old["id"] != oldSnapshotID {
			t.Fatal("same expense version changed identity across scopes")
		}
		oldSnapshotID = old["id"]
		months := page["months"].([]any)
		if len(months) != 2 || page["categories"].([]any)[0].(map[string]any)["totalExpenseMinor"] != "3000" {
			t.Fatal("old complete aggregates changed after edit")
		}
	}
	legacy := anchored["group"]["expenses"].(map[string]any)
	legacyEdge := snapshotEdge(t, legacy)
	if legacy["revision"] != "2" || legacyEdge["snapshot"].(map[string]any)["id"] != oldSnapshotID || legacyEdge["node"].(map[string]any)["id"] != f.original.Record.ExpenseID || legacyEdge["node"].(map[string]any)["totalMinor"] != "1000" {
		t.Fatal("legacy compatibility or snapshot parity changed")
	}
	if anchored["node"]["totalMinor"] != "800" {
		t.Fatal("same-response historical projection overwrote current node")
	}

	// Labels are current authorized metadata, not recorded financial facts.
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.users SET display_name='Renamed payer' WHERE id='%s'; RESET ROLE`, f.id(103)))
	renamed := read(1)
	labelSnapshot := snapshotEdge(t, renamed["groupExpenses"])["snapshot"].(map[string]any)
	if labelSnapshot["id"] != oldSnapshotID || labelSnapshot["payer"].(map[string]any)["displayName"] != "Renamed payer" || renamed["groupExpenses"]["contextVersion"] == originalContext || renamed["groupExpenses"]["id"] == anchored["groupExpenses"]["id"] {
		t.Fatal("current labels/context conflated with financial version")
	}

	// Non-Node snapshot IDs cannot be used to bypass the authorized traversal.
	status, body, err := groupHTTP(f, 1, `query($id:ID!){node(id:$id){id}}`, map[string]any{"id": oldSnapshotID})
	var invalid struct {
		Data   map[string]any
		Errors []struct{ Extensions map[string]any }
	}
	if err != nil || status != 200 || json.Unmarshal(body, &invalid) != nil || invalid.Data["node"] != nil || len(invalid.Errors) != 1 || invalid.Errors[0].Extensions["code"] != "BAD_USER_INPUT" {
		t.Fatalf("snapshot ID accepted as Node: status=%d %s", status, body)
	}

	for _, actor := range []int{4, 1} {
		if actor == 1 {
			f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.users SET enabled=false WHERE id='%s'; RESET ROLE`, f.id(101)))
		}
		denied := read(actor)
		if denied["node"] != nil {
			t.Fatal("current Node disclosed after access loss")
		}
		for _, field := range []string{"group", "groupExpenses", "householdExpenses"} {
			if denied[field]["__typename"] != "Problem" || denied[field]["code"] != "NOT_FOUND" || denied[field]["id"] != nil {
				t.Fatalf("%s cursor or cache ID bypassed current access", field)
			}
		}
	}
}
