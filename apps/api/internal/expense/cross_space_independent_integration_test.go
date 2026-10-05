//go:build integration

package expense_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
)

const independentViewFields = `__typename ... on Problem{code message} ... on ExpenseView{totalExpenseMinor expenseCount months{month totalExpenseMinor expenseCount} edges{cursor source{id name kind currency isHousehold trip{destination startDate endDate}} node{id groupId totalMinor effectiveDate createdAt category payer{id displayName} creator{id} allocations{participant{id} amountMinor}}} pageInfo{hasNextPage hasPreviousPage startCursor endCursor}}`
const independentHouseholdViewQuery = `query($first:Int!,$after:String,$filter:StructuredExpenseFilter){householdExpenses(first:$first,after:$after,filter:$filter){` + independentViewFields + `}}`
const independentGroupViewQuery = `query($group:ID!,$first:Int!,$after:String,$filter:StructuredExpenseFilter){groupExpenses(groupId:$group,first:$first,after:$after,filter:$filter){` + independentViewFields + `}}`

func independentViewRead(t *testing.T, f *expenseFixture, actor, first int, after string, filter map[string]any, group, kind string) map[string]any {
	t.Helper()
	query, field := independentHouseholdViewQuery, "householdExpenses"
	vars := map[string]any{"first": first, "filter": filter}
	if after != "" {
		vars["after"] = after
	}
	if group != "" {
		query, field = independentGroupViewQuery, "groupExpenses"
		vars["group"] = group
	}
	return groupRequest(t, f, actor, query, vars, field, kind)
}
func independentViewSummary(t *testing.T, got map[string]any, total, count string, months map[string][2]string) {
	t.Helper()
	if got["totalExpenseMinor"] != total || got["expenseCount"] != count {
		t.Fatalf("complete filtered summary: %v want %s/%s", got, total, count)
	}
	actual := map[string][2]string{}
	previous := "9999-99"
	for _, item := range got["months"].([]any) {
		m := item.(map[string]any)
		key := m["month"].(string)
		if key >= previous {
			t.Fatal("months not strictly descending", got)
		}
		previous = key
		actual[key] = [2]string{m["totalExpenseMinor"].(string), m["expenseCount"].(string)}
	}
	if !reflect.DeepEqual(actual, months) {
		t.Fatalf("month totals %v want %v", actual, months)
	}
}
func independentViewExpense(t *testing.T, f *expenseFixture, group, payer, participant int, amount int64, date, category string) string {
	t.Helper()
	in := f.input
	in.GroupID = f.public("Group", group)
	in.Key = uuid.NewString()
	in.Total = amount
	in.EffectiveDate = date
	in.Category = category
	in.PayerID = f.public("Membership", payer)
	in.ParticipantIDs = []string{f.public("Membership", participant)}
	out := f.create(1, in)
	if out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	return out.Record.ExpenseID
}
func independentViewDataset(t *testing.T) *expenseFixture {
	t.Helper()
	f := independentDashboardFixture(t, 1, 2)
	independentViewExpense(t, f, 201, 301, 302, 100, "2026-10-01", "HOME")
	independentViewExpense(t, f, 201, 302, 301, 200, "2026-09-30", "DINING")
	in := f.input
	in.Key = uuid.NewString()
	in.Total = 300
	in.EffectiveDate = "2026-09-30"
	in.Category = "GROCERIES"
	in.PayerID = f.public("Membership", 302)
	in.ParticipantIDs = []string{f.public("Membership", 301), f.public("Membership", 302)}
	in.Split = "EXACT"
	in.ExactAllocations = []ledger.Allocation{{ParticipantID: f.public("Membership", 301), Amount: 0}, {ParticipantID: f.public("Membership", 302), Amount: 300}}
	if out := f.create(1, in); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	independentViewExpense(t, f, 202, 305, 306, 400, "2026-09-30", "DINING")
	independentViewExpense(t, f, 203, 308, 307, 9000, "2026-10-01", "DINING")
	return f
}

func TestIndependentExpenseViewStructuredTotalsMemberParityAndNoDisclosure(t *testing.T) {
	f := independentViewDataset(t)
	months := map[string][2]string{"2026-10": {"100", "1"}, "2026-09": {"900", "3"}}
	first := independentViewRead(t, f, 1, 1, "", nil, "", "ExpenseView")
	independentViewSummary(t, first, "1000", "4", months)
	full := independentViewRead(t, f, 1, 100, "", nil, "", "ExpenseView")
	independentViewSummary(t, full, "1000", "4", months)
	raw, _ := json.Marshal(full)
	for _, hidden := range []string{"Viewer-only SECRET", f.public("Group", 203), f.public("Membership", 307)} {
		if bytes.Contains(raw, []byte(hidden)) {
			t.Fatalf("excluded ledger disclosed: %s", raw)
		}
	}
	for _, edge := range full["edges"].([]any) {
		e := edge.(map[string]any)
		if e["node"].(map[string]any)["totalMinor"] == "9000" {
			t.Fatal("excluded amount appeared in expense row", e)
		}
		if e["node"].(map[string]any)["groupId"] != e["source"].(map[string]any)["id"] {
			t.Fatal("copied source attribution", e)
		}
	}
	member := map[string]any{"memberId": f.public("Membership", 301)}
	for _, group := range []string{"", f.public("Group", 201)} {
		got := independentViewRead(t, f, 1, 1, "", member, group, "ExpenseView")
		independentViewSummary(t, got, "600", "3", map[string][2]string{"2026-10": {"100", "1"}, "2026-09": {"500", "2"}})
	}
	// The old filter continues to mean explicit participant only: A's payer-only
	// expense does not match, but the zero allocation still does.
	old := groupRequest(t, f, 1, `query($id:ID!,$filter:ExpenseFilter){group(id:$id){__typename ... on Group{expenses(first:100,filter:$filter){edges{node{totalMinor}}} balances{__typename ... on GroupBalances{totalExpenseMinor}}}}}`, map[string]any{"id": f.public("Group", 201), "filter": map[string]any{"participantId": f.public("Membership", 301)}}, "group", "Group")
	oldEdges := old["expenses"].(map[string]any)["edges"].([]any)
	if len(oldEdges) != 2 || old["balances"].(map[string]any)["totalExpenseMinor"] != "600" {
		t.Fatal("legacy filter or unfiltered balance regressed", old)
	}
	legacyAmounts := []string{}
	for _, item := range oldEdges {
		legacyAmounts = append(legacyAmounts, item.(map[string]any)["node"].(map[string]any)["totalMinor"].(string))
	}
	sort.Strings(legacyAmounts)
	if !reflect.DeepEqual(legacyAmounts, []string{"200", "300"}) {
		t.Fatal("legacy participant filter changed semantics", old)
	}
	exact := map[string]any{"groupId": f.public("Group", 201), "category": "DINING", "from": "2026-09-30", "to": "2026-09-30"}
	independentViewSummary(t, independentViewRead(t, f, 1, 1, "", exact, "", "ExpenseView"), "200", "1", map[string][2]string{"2026-09": {"200", "1"}})
	independentViewSummary(t, independentViewRead(t, f, 1, 1, "", map[string]any{"category": "DINING"}, "", "ExpenseView"), "600", "2", map[string][2]string{"2026-09": {"600", "2"}})
	empty := independentViewRead(t, f, 1, 1, "", map[string]any{"category": "OTHER"}, "", "ExpenseView")
	independentViewSummary(t, empty, "0", "0", map[string][2]string{})
	if len(empty["edges"].([]any)) != 0 || empty["pageInfo"].(map[string]any)["endCursor"] != nil {
		t.Fatal("fake empty month/cursor", empty)
	}
	for _, filter := range []map[string]any{{"groupId": f.public("Group", 203)}, {"memberId": f.public("Membership", 307)}, {"groupId": f.public("Group", 202), "memberId": f.public("Membership", 301)}} {
		if got := independentViewRead(t, f, 1, 1, "bad.cursor", filter, "", "Problem"); got["code"] != "NOT_FOUND" {
			t.Fatal("hidden/wrong-group reference disclosed", got)
		}
	}
	in := repaymentInput(f)
	in.Amount = 100
	if out := repaymentRecord(t, repaymentEndpoint(t, f, f.db), 1, in); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	independentViewSummary(t, independentViewRead(t, f, 1, 1, "", nil, "", "ExpenseView"), "1000", "4", months)
}

func TestIndependentExpenseViewCursorAnchorsFiltersAndCurrentMetadata(t *testing.T) {
	f := independentViewDataset(t)
	first := independentViewRead(t, f, 1, 1, "", nil, "", "ExpenseView")
	cursor := first["pageInfo"].(map[string]any)["endCursor"].(string)
	independentViewExpense(t, f, 201, 302, 301, 500, "2026-08-01", "HOME")
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL ROLE kami_migrator;UPDATE app.groups SET name='Current shared name' WHERE id='%s';COMMIT`, f.id(201)))
	next := independentViewRead(t, f, 1, 100, cursor, nil, "", "ExpenseView")
	independentViewSummary(t, next, "1000", "4", map[string][2]string{"2026-10": {"100", "1"}, "2026-09": {"900", "3"}})
	if len(next["edges"].([]any)) != 3 {
		t.Fatal("anchored page included later backdate", next)
	}
	for _, item := range next["edges"].([]any) {
		e := item.(map[string]any)
		source := e["source"].(map[string]any)
		if source["id"] == f.public("Group", 201) && source["name"] != "Current shared name" {
			t.Fatal("cursor froze private metadata", e)
		}
	}
	independentViewSummary(t, independentViewRead(t, f, 1, 100, "", nil, "", "ExpenseView"), "1500", "5", map[string][2]string{"2026-10": {"100", "1"}, "2026-09": {"900", "3"}, "2026-08": {"500", "1"}})
	for _, filter := range []map[string]any{{"category": "DINING"}, {"groupId": f.public("Group", 201)}, {"memberId": f.public("Membership", 301)}, {"from": "2026-09-01"}, {"to": "2026-09-30"}} {
		if got := independentViewRead(t, f, 1, 1, cursor, filter, "", "Problem"); got["code"] != "INVALID_CURSOR" {
			t.Fatal("filter-bound cursor replayed", got)
		}
	}
	for _, actor := range []int{2, 3, 4} {
		got := independentViewRead(t, f, actor, 1, cursor, nil, "", "Problem")
		want := "NOT_FOUND"
		if actor == 2 {
			want = "INVALID_CURSOR"
		}
		if got["code"] != want {
			t.Fatalf("actor %d cursor: %v", actor, got)
		}
	}
	if got := independentViewRead(t, f, 1, 1, cursor, nil, f.public("Group", 201), "Problem"); got["code"] != "INVALID_CURSOR" {
		t.Fatal("Household cursor reused for group", got)
	}
	if got := independentViewRead(t, f, 1, 1, cursor[:len(cursor)-1]+"!", nil, "", "Problem"); got["code"] != "INVALID_CURSOR" {
		t.Fatal("tampered signature accepted", got)
	}
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL ROLE kami_migrator;SELECT id FROM app.groups WHERE id='%s' FOR UPDATE;UPDATE app.memberships SET active=false WHERE id='%s';COMMIT`, f.id(202), f.id(306)))
	if got := independentViewRead(t, f, 1, 1, cursor, nil, "", "Problem"); got["code"] != "INVALID_CURSOR" {
		t.Fatal("eligibility change reused stale anchors", got)
	}
	fresh := independentViewRead(t, f, 1, 100, "", nil, "", "ExpenseView")
	independentViewSummary(t, fresh, "1100", "4", map[string][2]string{"2026-10": {"100", "1"}, "2026-09": {"500", "2"}, "2026-08": {"500", "1"}})
}

func TestIndependentExpenseViewGlobalTiesAndCanonicalAnchors(t *testing.T) {
	f := independentDashboardFixture(t, 1, 2)
	// Exercise a third eligible ledger with an independent UUID prefix.
	raw := uuid.NewString()
	ids := map[int]string{204: raw, 324: uuid.NewString(), 325: uuid.NewString()}
	extraID := func(n int) string {
		if s := ids[n]; s != "" {
			return s
		}
		return f.id(n)
	}
	registerExpenseCleanup(t, f.admin, extraID, []int{204}, nil)
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL ROLE kami_migrator;INSERT INTO app.groups(id,name,owner_membership_id) VALUES('%s','Third shared','%s');INSERT INTO app.memberships(id,group_id,user_id) VALUES('%s','%s','%s'),('%s','%s','%s');COMMIT`, raw, ids[324], ids[324], raw, f.id(101), ids[325], raw, f.id(102)))
	expected := []struct{ id, group string }{}
	for _, group := range []int{201, 202, 204} {
		for range 3 {
			in := f.input
			in.Key = uuid.NewString()
			in.GroupID = ledger.PublicID("Group", extraID(group))
			in.Total = 100
			in.EffectiveDate = "2026-09-30"
			if group == 201 {
				in.PayerID = f.public("Membership", 301)
				in.ParticipantIDs = []string{f.public("Membership", 302)}
			} else if group == 202 {
				in.PayerID = f.public("Membership", 305)
				in.ParticipantIDs = []string{f.public("Membership", 306)}
			} else {
				in.PayerID = ledger.PublicID("Membership", ids[324])
				in.ParticipantIDs = []string{ledger.PublicID("Membership", ids[325])}
			}
			out := f.create(1, in)
			if out.Kind != "COMMITTED" {
				t.Fatal(out)
			}
			expenseID, _ := ledger.ParseID(out.Record.ExpenseID, "Expense")
			expected = append(expected, struct{ id, group string }{expenseID, extraID(group)})
		}
	}
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL session_replication_role=replica;SET LOCAL ROLE kami_migrator;ALTER TABLE app.expenses NO FORCE ROW LEVEL SECURITY;UPDATE app.expenses SET created_at='2026-09-30T12:00:00.123456Z' WHERE group_id IN('%s','%s','%s');ALTER TABLE app.expenses FORCE ROW LEVEL SECURITY;COMMIT`, f.id(201), f.id(202), raw))
	sort.Slice(expected, func(i, j int) bool {
		if expected[i].group != expected[j].group {
			return expected[i].group > expected[j].group
		}
		return expected[i].id > expected[j].id
	})
	after := ""
	actual := []string{}
	for {
		got := independentViewRead(t, f, 1, 1, after, nil, "", "ExpenseView")
		independentViewSummary(t, got, "900", "9", map[string][2]string{"2026-09": {"900", "9"}})
		edges := got["edges"].([]any)
		if len(edges) != 1 {
			t.Fatal("missing tied edge", got)
		}
		e := edges[0].(map[string]any)
		actual = append(actual, e["node"].(map[string]any)["id"].(string))
		after = e["cursor"].(string)
		payload, _ := base64.RawURLEncoding.DecodeString(strings.Split(after, ".")[1])
		if bytes.Contains(payload, []byte(f.id(101))) || bytes.Contains(payload, []byte(f.id(102))) || bytes.Contains(payload, []byte(f.id(203))) {
			t.Fatalf("private/excluded cursor identity: %s", payload)
		}
		if got["pageInfo"].(map[string]any)["hasNextPage"] == false {
			break
		}
		if len(actual) > 9 {
			t.Fatal("pagination repeated boundary")
		}
	}
	want := []string{}
	for _, item := range expected {
		want = append(want, ledger.PublicID("Expense", item.id))
	}
	if !reflect.DeepEqual(actual, want) {
		t.Fatalf("global UUID tie ordering %v want %v", actual, want)
	}
}

func TestIndependentExpenseViewDiscoveryRaceAndDeadline(t *testing.T) {
	f := independentViewDataset(t)
	tx, err := f.admin.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(f.ctx, "SET LOCAL ROLE kami_migrator"); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(f.ctx, `SELECT id FROM app.groups WHERE id=$1 FOR UPDATE`, f.id(202)); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(f.ctx, "RESET ROLE"); err != nil {
		t.Fatal(err)
	}
	type response struct {
		status int
		body   []byte
		err    error
	}
	done := make(chan response, 1)
	go func() {
		status, body, err := groupHTTP(f, 1, independentHouseholdViewQuery, map[string]any{"first": 100})
		done <- response{status, body, err}
	}()
	deadline := time.Now().Add(3 * time.Second)
	for {
		if _, err = tx.Exec(f.ctx, `SELECT pg_stat_clear_snapshot()`); err != nil {
			t.Fatal(err)
		}
		var n int
		if err = tx.QueryRow(f.ctx, `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%household_dashboard_lock%'`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("expense view did not wait on group lock")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, err = tx.Exec(f.ctx, "SET LOCAL ROLE kami_migrator"); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(f.ctx, `SELECT id FROM app.groups WHERE id=$1 FOR UPDATE`, f.id(203)); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(f.ctx, `INSERT INTO app.memberships(id,group_id,user_id) VALUES($1,$2,$3)`, f.id(309), f.id(203), f.id(102)); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	var result struct {
		Data   map[string]map[string]any
		Errors []any
	}
	select {
	case got := <-done:
		if got.err != nil || got.status != 200 || json.Unmarshal(got.body, &result) != nil || len(result.Errors) > 0 {
			t.Fatalf("race response %s %v", got.body, got.err)
		}
	case <-time.After(7 * time.Second):
		t.Fatal("discovery restart did not complete")
	}
	independentViewSummary(t, result.Data["householdExpenses"], "10000", "5", map[string][2]string{"2026-10": {"9100", "2"}, "2026-09": {"900", "3"}})
	held, err := f.admin.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer held.Rollback(context.Background())
	if _, err = held.Exec(f.ctx, `SET LOCAL ROLE kami_migrator;SELECT singleton FROM app.household_designation_guard FOR UPDATE`); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	got := independentViewRead(t, f, 1, 1, "", nil, "", "Problem")
	if got["code"] != "UNAVAILABLE" || time.Since(start) > 7*time.Second {
		t.Fatal("deadline returned partial view", got)
	}
}

func TestIndependentExpenseViewMalformedAuthorizationAndNoSearchContract(t *testing.T) {
	f := independentViewDataset(t)
	for _, target := range []struct {
		query, field string
		vars         map[string]any
	}{{independentHouseholdViewQuery, "householdExpenses", map[string]any{"first": 1, "after": ""}}, {independentGroupViewQuery, "groupExpenses", map[string]any{"first": 1, "after": "", "group": f.public("Group", 201)}}} {
		got := groupRequest(t, f, 1, target.query, target.vars, target.field, "Problem")
		if got["code"] != "INVALID_CURSOR" || len(got) != 3 {
			t.Fatal("explicit empty cursor became fresh traversal", got)
		}
	}
	for _, first := range []int{-1, 0, 101} {
		if got := independentViewRead(t, f, 1, first, "", nil, "", "Problem"); got["code"] != "INVALID_INPUT" {
			t.Fatal("unbounded page accepted", got)
		}
	}
	for _, filter := range []map[string]any{{"from": "2026-10-01", "to": "2026-09-30"}, {"memberId": f.public("Group", 201)}} {
		if got := independentViewRead(t, f, 1, 1, "", filter, "", "Problem"); got["code"] != "INVALID_INPUT" {
			t.Fatal("malformed filter accepted", got)
		}
	}
	for _, filter := range []map[string]any{{"search": "Dinner"}, {"category": "SHOPPING"}, {"from": "2026-02-30"}} {
		status, body, err := groupHTTP(f, 1, independentHouseholdViewQuery, map[string]any{"first": 1, "filter": filter})
		if err != nil || status != 400 || !bytes.Contains(body, []byte("BAD_USER_INPUT")) {
			t.Fatalf("unexpected search/category/date contract: %d %s %v", status, body, err)
		}
	}
	status, body, err := groupHTTP(f, 0, independentHouseholdViewQuery, map[string]any{"first": 1})
	if err != nil || status != 401 || !bytes.Contains(body, []byte("UNAUTHENTICATED")) {
		t.Fatalf("unauthenticated financial view: %d %s %v", status, body, err)
	}
	if got := independentViewRead(t, f, 4, 1, "", nil, f.public("Group", 201), "Problem"); got["code"] != "NOT_FOUND" {
		t.Fatal("cross-group read accepted", got)
	}
	if got := independentViewRead(t, f, 1, 1, "", map[string]any{"groupId": f.public("Group", 202)}, f.public("Group", 201), "Problem"); got["code"] != "NOT_FOUND" {
		t.Fatal("group source scope overridden", got)
	}
	// A viewer's ordinary ledger access survives exclusion from the pair feed.
	independentViewSummary(t, independentViewRead(t, f, 1, 1, "", nil, f.public("Group", 203), "ExpenseView"), "9000", "1", map[string][2]string{"2026-10": {"9000", "1"}})
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL ROLE kami_migrator;UPDATE app.users SET enabled=false WHERE id='%s';COMMIT`, f.id(102)))
	if got := independentViewRead(t, f, 1, 1, "", nil, "", "Problem"); got["code"] != "UNAVAILABLE" {
		t.Fatal("suspended pair manufactured empty success", got)
	}
	if got := independentViewRead(t, f, 2, 1, "", nil, "", "Problem"); got["code"] != "NOT_FOUND" {
		t.Fatal("disabled actor accepted", got)
	}
}

func TestIndependentExpenseViewExactBoundariesAndWholeFailure(t *testing.T) {
	f := independentDashboardFixture(t, 1, 2)
	independentViewExpense(t, f, 201, 301, 302, 1, "2026-09-30", "DINING")
	independentViewExpense(t, f, 202, 305, 306, 1, "2026-09-30", "DINING")
	// A real bounded-record aggregate would need millions/billions of records.
	// This test-only admin fixture restores and validates both original bounds.
	t.Cleanup(func() {
		independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL session_replication_role=replica;SET LOCAL ROLE kami_migrator;ALTER TABLE app.expenses NO FORCE ROW LEVEL SECURITY;ALTER TABLE app.allocations NO FORCE ROW LEVEL SECURITY;UPDATE app.expenses SET total_minor=1 WHERE group_id='%s';UPDATE app.allocations SET amount_minor=1 WHERE group_id='%s';ALTER TABLE app.expenses VALIDATE CONSTRAINT expenses_total_minor_check;ALTER TABLE app.allocations VALIDATE CONSTRAINT allocations_amount_minor_check;ALTER TABLE app.expenses FORCE ROW LEVEL SECURITY;ALTER TABLE app.allocations FORCE ROW LEVEL SECURITY;COMMIT`, f.id(201), f.id(201)))
	})
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL session_replication_role=replica;SET LOCAL ROLE kami_migrator;ALTER TABLE app.expenses NO FORCE ROW LEVEL SECURITY;ALTER TABLE app.allocations NO FORCE ROW LEVEL SECURITY;ALTER TABLE app.expenses DROP CONSTRAINT expenses_total_minor_check;ALTER TABLE app.allocations DROP CONSTRAINT allocations_amount_minor_check;UPDATE app.expenses SET total_minor=9007199254740993 WHERE group_id='%s';UPDATE app.allocations SET amount_minor=9007199254740993 WHERE group_id='%s';ALTER TABLE app.expenses ADD CONSTRAINT expenses_total_minor_check CHECK(total_minor BETWEEN 1 AND 999999999) NOT VALID;ALTER TABLE app.allocations ADD CONSTRAINT allocations_amount_minor_check CHECK(amount_minor BETWEEN 0 AND 999999999) NOT VALID;ALTER TABLE app.expenses FORCE ROW LEVEL SECURITY;ALTER TABLE app.allocations FORCE ROW LEVEL SECURITY;COMMIT`, f.id(201), f.id(201)))
	independentViewSummary(t, independentViewRead(t, f, 1, 1, "", nil, "", "ExpenseView"), "9007199254740994", "2", map[string][2]string{"2026-09": {"9007199254740994", "2"}})
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL session_replication_role=replica;SET LOCAL ROLE kami_migrator;ALTER TABLE app.expenses NO FORCE ROW LEVEL SECURITY;ALTER TABLE app.allocations NO FORCE ROW LEVEL SECURITY;ALTER TABLE app.expenses DROP CONSTRAINT expenses_total_minor_check;ALTER TABLE app.allocations DROP CONSTRAINT allocations_amount_minor_check;UPDATE app.expenses SET total_minor=9223372036854775807 WHERE group_id='%s';UPDATE app.allocations SET amount_minor=9223372036854775807 WHERE group_id='%s';ALTER TABLE app.expenses ADD CONSTRAINT expenses_total_minor_check CHECK(total_minor BETWEEN 1 AND 999999999) NOT VALID;ALTER TABLE app.allocations ADD CONSTRAINT allocations_amount_minor_check CHECK(amount_minor BETWEEN 0 AND 999999999) NOT VALID;ALTER TABLE app.expenses FORCE ROW LEVEL SECURITY;ALTER TABLE app.allocations FORCE ROW LEVEL SECURITY;COMMIT`, f.id(201), f.id(201)))
	got := independentViewRead(t, f, 1, 1, "", nil, "", "Problem")
	if got["code"] != "AMOUNT_OVERFLOW" || len(got) != 3 {
		t.Fatal("overflow clipped or returned partial view", got)
	}
	independentViewSummary(t, independentViewRead(t, f, 1, 1, "", map[string]any{"groupId": f.public("Group", 202)}, "", "ExpenseView"), "1", "1", map[string][2]string{"2026-09": {"1", "1"}})
}
