//go:build integration

package expense_test

import (
	"context"
	"fmt"
	"strconv"
	"testing"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/invitation"
)

const directoryFinancialFields = `__typename ... on Problem { code } ... on GroupFinancialSummary { totalSpendMinor viewerNetMinor }`
const directoryQuery = `{ groupDirectory { __typename ... on Problem { code } ... on GroupDirectory { entries { group { id name kind currency isHousehold trip { destination startDate endDate } } activeMemberCount financialSummary { ` + directoryFinancialFields + ` } } } } }`
const directoryGroupQuery = `query($id:ID!){group(id:$id){__typename ... on Problem{code} ... on Group{financialSummary{` + directoryFinancialFields + `} expenses(first:1,filter:{from:"2020-01-01",to:"2020-01-01"}){edges{node{id}}} balances{... on GroupBalances{settled totalExpenseMinor}}}}}`

func readDirectory(t *testing.T, f *expenseFixture, actor int) []any {
	t.Helper()
	return groupRequest(t, f, actor, directoryQuery, nil, "groupDirectory", "GroupDirectory")["entries"].([]any)
}

func assertDirectoryFinancials(t *testing.T, value any, spend, net string) {
	t.Helper()
	got := value.(map[string]any)
	if got["__typename"] != "GroupFinancialSummary" || got["totalSpendMinor"] != spend || got["viewerNetMinor"] != net {
		t.Fatalf("financial summary=%v, want spend=%s net=%s", got, spend, net)
	}
}

func TestDirectoryCompleteSpendCurrentEditsRepaymentsAndFilteredOverview(t *testing.T) {
	f := newExpenseFixture(t)
	f.exec(fmt.Sprintf(`BEGIN;SET LOCAL ROLE kami_migrator;INSERT INTO app.group_trip(group_id,destination,start_date,end_date) VALUES('%s','Outside expense dates','2020-01-01','2020-01-02');COMMIT`, f.id(201)))
	t.Cleanup(func() {
		f.exec(fmt.Sprintf(`SET ROLE kami_migrator;DELETE FROM app.group_trip WHERE group_id='%s';RESET ROLE`, f.id(201)))
	})
	// More than the maximum ledger page size, all outside the trip dates.
	for range 101 {
		in := f.input
		in.Key, in.Total = uuid.NewString(), 1
		in.PayerID, in.ParticipantIDs = f.public("Membership", 302), []string{f.public("Membership", 302)}
		if out := f.create(1, in); out.Kind != "COMMITTED" {
			t.Fatal(out)
		}
	}
	assertBoth := func(spend, net string) {
		t.Helper()
		entries := readDirectory(t, f, 1)
		if len(entries) != 1 {
			t.Fatal(entries)
		}
		entry := entries[0].(map[string]any)
		if entry["activeMemberCount"] != float64(3) || entry["group"].(map[string]any)["kind"] != "TRIP" {
			t.Fatal(entry)
		}
		assertDirectoryFinancials(t, entry["financialSummary"], spend, net)
		group := groupRequest(t, f, 1, directoryGroupQuery, map[string]any{"id": f.input.GroupID}, "group", "Group")
		assertDirectoryFinancials(t, group["financialSummary"], spend, net)
		if got := group["balances"].(map[string]any)["totalExpenseMinor"]; got != spend {
			t.Fatalf("complete Overview spend=%v, want directory spend=%s", got, spend)
		}
		if len(group["expenses"].(map[string]any)["edges"].([]any)) != 0 {
			t.Fatal("expense filter should exclude every row", group)
		}
	}
	assertBoth("1101", "-334")
	edit := editInput(f)
	edit.Total, edit.PayerID = 800, f.public("Membership", 301)
	edit.ParticipantIDs = []string{f.public("Membership", 302)}
	if out := performEdit(t, f, 2, edit); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	assertBoth("901", "800")
	repayment := repaymentGQLInput(f)
	repayment["amountMinor"] = "800"
	if got := repaymentGQLRecord(t, f, 2, repayment); got["__typename"] != "RepaymentCommitted" {
		t.Fatal(got)
	}
	assertBoth("901", "1600")
}

func TestDirectoryActiveCountsPendingInvitationAndCurrentAuthorization(t *testing.T) {
	f := newExpenseFixture(t)
	protector, err := invitation.NewProtector("directory", map[string][]byte{"directory": make([]byte, 32)})
	if err != nil {
		t.Fatal(err)
	}
	service, err := invitation.New(f.db, protector, membershipEmailProvider{emails: map[string]string{f.id(1): f.id(1) + "@example.invalid"}})
	if err != nil {
		t.Fatal(err)
	}
	invite, err := service.Create(membershipAuthenticatedContext(t, f, 1), uuid.MustParse(f.id(201)), f.id(4)+"@example.invalid", uuid.New())
	if err != nil || invite.Outcome != "SAVED" {
		t.Fatalf("pending invitation: %v %v", invite, err)
	}
	t.Cleanup(func() {
		f.exec(fmt.Sprintf(`BEGIN;SET LOCAL ROLE kami_migrator;DELETE FROM app.invitation_delivery WHERE action_id IN(SELECT id FROM app.invitation_actions WHERE group_id='%s');DELETE FROM app.invitation_actions WHERE group_id='%s';DELETE FROM app.invitations WHERE group_id='%s';COMMIT`, f.id(201), f.id(201), f.id(201)))
	})
	injectHistoricalDeparture(t, f, f.id(303))
	entries := readDirectory(t, f, 1)
	entry := entries[0].(map[string]any)
	if len(entries) != 1 || entry["activeMemberCount"] != float64(2) {
		t.Fatal(entries)
	}
	assertDirectoryFinancials(t, entry["financialSummary"], "1000", "-334")
	// Another account sees only its own empty ordinary group. Pending invitation
	// possession does not admit the invitee or reveal the first group's finances.
	other := readDirectory(t, f, 4)
	if len(other) != 1 || other[0].(map[string]any)["group"].(map[string]any)["id"] != f.public("Group", 202) {
		t.Fatal(other)
	}
	assertDirectoryFinancials(t, other[0].(map[string]any)["financialSummary"], "0", "0")
	injectHistoricalDeparture(t, f, f.id(302))
	if got := readDirectory(t, f, 2); len(got) != 0 {
		t.Fatal("lost access retained directory", got)
	}
	denied := groupRequest(t, f, 2, directoryGroupQuery, map[string]any{"id": f.input.GroupID}, "group", "Problem")
	if denied["code"] != "NOT_FOUND" {
		t.Fatal(denied)
	}
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator;UPDATE app.users SET enabled=false WHERE id='%s';RESET ROLE`, f.id(101)))
	if got := groupRequest(t, f, 1, directoryQuery, nil, "groupDirectory", "Problem"); got["code"] != "NOT_FOUND" {
		t.Fatal(got)
	}
}

func TestDirectoryPersonalZeroDoesNotSettlePeersAndHouseholdExcluded(t *testing.T) {
	f := newExpenseFixture(t)
	edit := editInput(f)
	edit.PayerID, edit.ParticipantIDs = f.public("Membership", 302), []string{f.public("Membership", 303)}
	if out := performEdit(t, f, 1, edit); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	entry := readDirectory(t, f, 1)[0].(map[string]any)
	assertDirectoryFinancials(t, entry["financialSummary"], "1000", "0")
	group := groupRequest(t, f, 1, directoryGroupQuery, map[string]any{"id": f.input.GroupID}, "group", "Group")
	if group["balances"].(map[string]any)["settled"] != false {
		t.Fatal("personal zero settled peers", group)
	}
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator;INSERT INTO app.installation(household_group_id,group_creator_user_id)VALUES('%s','%s');RESET ROLE`, f.id(201), f.id(101)))
	t.Cleanup(func() {
		f.exec(fmt.Sprintf(`SET ROLE kami_migrator;DELETE FROM app.installation WHERE household_group_id='%s';RESET ROLE`, f.id(201)))
	})
	if got := readDirectory(t, f, 1); len(got) != 0 {
		t.Fatal("household card exposed", got)
	}
	// Household exclusion is directory presentation only; direct authorized reads survive.
	group = groupRequest(t, f, 1, directoryGroupQuery, map[string]any{"id": f.input.GroupID}, "group", "Group")
	assertDirectoryFinancials(t, group["financialSummary"], "1000", "0")
}

func TestDirectoryOneAggregateStatementForManyGroups(t *testing.T) {
	f := newExpenseFixture(t)
	f.exec(`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`)
	calls := func() int64 {
		t.Helper()
		var n int64
		if err := f.admin.QueryRow(f.ctx, `SELECT coalesce(sum(calls),0)::bigint FROM pg_stat_statements WHERE query LIKE 'WITH selected AS MATERIALIZED%' AND query LIKE '%repayment_totals AS%'`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	before := calls()
	if got := readDirectory(t, f, 1); len(got) != 1 {
		t.Fatal(got)
	}
	if delta := calls() - before; delta != 1 {
		t.Fatalf("one group aggregate calls=%d", delta)
	}
	groups := []int{}
	for n := 500; n < 540; n++ {
		groups = append(groups, n)
	}
	registerExpenseCleanup(t, f.admin, f.id, groups, nil)
	tx, err := f.admin.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(f.ctx, `SET LOCAL ROLE kami_migrator`); err != nil {
		t.Fatal(err)
	}
	for _, n := range groups {
		if _, err = tx.Exec(f.ctx, `INSERT INTO app.groups(id,name,owner_membership_id)VALUES($1,$2,$3);`, f.id(n), "Directory "+strconv.Itoa(n), f.id(n+100)); err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec(f.ctx, `INSERT INTO app.memberships(id,group_id,user_id)VALUES($1,$2,$3)`, f.id(n+100), f.id(n), f.id(101)); err != nil {
			t.Fatal(err)
		}
	}
	if err = tx.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	before = calls()
	if got := readDirectory(t, f, 1); len(got) != 41 {
		t.Fatalf("directory size=%d", len(got))
	}
	if delta := calls() - before; delta != 1 {
		t.Fatalf("41 group aggregate calls=%d", delta)
	}
}

func TestDirectoryQueryFailureReturnsProblemWithoutEntries(t *testing.T) {
	f := newExpenseFixture(t)
	f.exec(`SET ROLE kami_migrator; REVOKE SELECT ON app.repayments FROM kami_api; RESET ROLE`)
	t.Cleanup(func() { f.exec(`SET ROLE kami_migrator; GRANT SELECT ON app.repayments TO kami_api; RESET ROLE`) })
	var canRead bool
	if err := f.admin.QueryRow(f.ctx, `SELECT has_table_privilege('kami_api', 'app.repayments', 'SELECT')`).Scan(&canRead); err != nil || canRead {
		t.Fatalf("permission failure was not injected: canRead=%t err=%v", canRead, err)
	}
	got := groupRequest(t, f, 1, directoryQuery, nil, "groupDirectory", "Problem")
	if got["code"] != "NOT_FOUND" {
		t.Fatal(got)
	}
}

func TestDirectoryConcurrentEditKeepsSpendAndNetCoherent(t *testing.T) {
	f := newExpenseFixture(t)
	edit := editInput(f)
	edit.Total = 800
	edit.PayerID = f.public("Membership", 301)
	edit.ParticipantIDs = []string{f.public("Membership", 302)}
	type edited struct {
		out expense.Outcome
		err error
	}
	done := make(chan edited, 1)
	ctx := membershipAuthenticatedContext(t, f, 2)
	go func() {
		out, err := expense.New(f.db).Edit(ctx, edit)
		done <- edited{out, err}
	}()
	for range 12 {
		entry := readDirectory(t, f, 1)[0].(map[string]any)["financialSummary"].(map[string]any)
		if !(entry["totalSpendMinor"] == "1000" && entry["viewerNetMinor"] == "-334") && !(entry["totalSpendMinor"] == "800" && entry["viewerNetMinor"] == "800") {
			t.Fatal("mixed statement snapshot", entry)
		}
	}
	if result := <-done; result.err != nil || result.out.Kind != "COMMITTED" {
		t.Fatal(result)
	}
	assertDirectoryFinancials(t, readDirectory(t, f, 1)[0].(map[string]any)["financialSummary"], "800", "800")
}

func TestDirectoryExactWireAndSourceOverflowAreExplicit(t *testing.T) {
	f := newExpenseFixture(t)
	edit := editInput(f)
	edit.Total, edit.PayerID = 1, f.public("Membership", 301)
	edit.ParticipantIDs = []string{f.public("Membership", 302)}
	if out := performEdit(t, f, 1, edit); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	// Reaching aggregate int64 limits with production-bounded records would need
	// billions of rows. Administrator-only synthetic boundary injection exercises
	// decoding/transport; ordinary writes and the separate authorization tests
	// retain real constraints. Restore and validate those constraints on cleanup.
	t.Cleanup(func() { setExpenseViewBoundary(t, f, "1", true) })
	setExpenseViewBoundary(t, f, "9007199254740993", false)
	assertDirectoryFinancials(t, readDirectory(t, f, 1)[0].(map[string]any)["financialSummary"], "9007199254740993", "9007199254740993")
	setExpenseViewBoundary(t, f, "9223372036854775807", false)
	assertDirectoryFinancials(t, readDirectory(t, f, 1)[0].(map[string]any)["financialSummary"], "9223372036854775807", "9223372036854775807")
	f.exec(fmt.Sprintf(`BEGIN;SET LOCAL session_replication_role=replica;SET LOCAL ROLE kami_migrator;
ALTER TABLE app.expenses NO FORCE ROW LEVEL SECURITY;ALTER TABLE app.allocations NO FORCE ROW LEVEL SECURITY;
INSERT INTO app.expenses(id,group_id,creator_id,payer_id,total_minor,currency,description,effective_date,category,note,split,revision)
VALUES('%s','%s','%s','%s',1,'USD','Aggregate boundary','2026-09-29','OTHER','','EQUAL',999);
INSERT INTO app.allocations(expense_id,group_id,participant_id,amount_minor)VALUES('%s','%s','%s',1);
ALTER TABLE app.expenses FORCE ROW LEVEL SECURITY;ALTER TABLE app.allocations FORCE ROW LEVEL SECURITY;COMMIT`, f.id(950), f.id(201), f.id(301), f.id(301), f.id(950), f.id(201), f.id(302)))
	entry := readDirectory(t, f, 1)[0].(map[string]any)
	got := entry["financialSummary"].(map[string]any)
	if got["__typename"] != "Problem" || got["code"] != "AMOUNT_OVERFLOW" || len(got) != 2 {
		t.Fatal("overflow became a financial value", got)
	}
	group := groupRequest(t, f, 1, directoryGroupQuery, map[string]any{"id": f.input.GroupID}, "group", "Group")
	if got = group["financialSummary"].(map[string]any); got["__typename"] != "Problem" || got["code"] != "AMOUNT_OVERFLOW" {
		t.Fatal("overview overflow became a financial value", got)
	}
	assertDirectoryFinancials(t, readDirectory(t, f, 4)[0].(map[string]any)["financialSummary"], "0", "0")
}
