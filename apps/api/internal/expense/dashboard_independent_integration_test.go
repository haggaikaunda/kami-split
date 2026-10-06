//go:build integration

package expense_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/jackc/pgx/v5"
)

const independentDashboardQuery = `{householdDashboard{__typename ... on Problem{code message} ... on HouseholdDashboard{contextVersion state totals{__typename ... on Problem{code} ... on HouseholdDashboardTotals{viewerNetMinor activeSpaceCount openBalanceCount totalSharedExpenseMinor totalSharedExpenseCount}} spaces{viewerNetMinor sharedExpenseCount groupId name kind isHousehold trip{destination startDate endDate} members{id displayName status} balances{__typename ... on Problem{code} ... on GroupBalances{revision totalExpenseMinor settled positions{member{id status} netMinor paidMinor owedMinor sentMinor receivedMinor} obligations{from{id} to{id} amountMinor}}}}}}}`

func independentDashboardExec(t *testing.T, f *expenseFixture, sql string) {
	t.Helper()
	if _, err := f.admin.Exec(f.ctx, sql); err != nil {
		_, _ = f.admin.Exec(context.Background(), "ROLLBACK")
		t.Fatal(err)
	}
}

func independentDashboardFixture(t *testing.T, first, second int) *expenseFixture {
	t.Helper()
	f := newGroupTransportFixture(t)
	// Start from no history; newExpenseFixture ordinarily supplies one expense.
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN; SET LOCAL session_replication_role=replica; SET LOCAL ROLE kami_migrator;
 ALTER TABLE app.expense_operations NO FORCE ROW LEVEL SECURITY; ALTER TABLE app.financial_records NO FORCE ROW LEVEL SECURITY; ALTER TABLE app.allocations NO FORCE ROW LEVEL SECURITY; ALTER TABLE app.expense_audit NO FORCE ROW LEVEL SECURITY; ALTER TABLE app.expenses NO FORCE ROW LEVEL SECURITY;
 DELETE FROM app.expense_operations WHERE group_id='%s'; DELETE FROM app.financial_records WHERE group_id='%s'; DELETE FROM app.allocations WHERE group_id='%s'; DELETE FROM app.expense_audit WHERE group_id='%s'; DELETE FROM app.expenses WHERE group_id='%s'; ALTER TABLE app.expense_operations FORCE ROW LEVEL SECURITY; ALTER TABLE app.financial_records FORCE ROW LEVEL SECURITY; ALTER TABLE app.allocations FORCE ROW LEVEL SECURITY; ALTER TABLE app.expense_audit FORCE ROW LEVEL SECURITY; ALTER TABLE app.expenses FORCE ROW LEVEL SECURITY; COMMIT`, f.id(201), f.id(201), f.id(201), f.id(201), f.id(201)))
	t.Cleanup(func() {
		independentDashboardExec(t, f, `BEGIN; SET LOCAL ROLE kami_migrator; DELETE FROM app.household_designation_audit; UPDATE app.household_designation_guard SET version=0,state='EMPTY',first_user_id=NULL,second_user_id=NULL,proposer_user_id=NULL,first_consented=false,second_consented=false; COMMIT`)
	})
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; INSERT INTO app.memberships(id,group_id,user_id) VALUES('%s','%s','%s'),('%s','%s','%s'); INSERT INTO app.groups(id,name,owner_membership_id) VALUES('%s','Viewer-only SECRET','%s'); INSERT INTO app.memberships(id,group_id,user_id) VALUES('%s','%s','%s'),('%s','%s','%s'); COMMIT`, f.id(305), f.id(202), f.id(101), f.id(306), f.id(202), f.id(102), f.id(203), f.id(307), f.id(307), f.id(203), f.id(101), f.id(308), f.id(203), f.id(103)))
	if first != 0 {
		independentDashboardDesignate(t, f, first, second)
	}
	return f
}

func TestIndependentDashboardRepaymentDoesNotIncreaseSpending(t *testing.T) {
	f := independentDashboardFixture(t, 1, 2)
	independentDashboardExpense(t, f, 201, 302, 301, 2000)
	in := repaymentInput(f)
	in.Amount = 2000
	if out := repaymentRecord(t, repaymentEndpoint(t, f, f.db), 1, in); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	independentDashboardTotals(t, independentDashboardRead(t, f, 1), "0", "2", "0", "2000", "1")
}

func TestIndependentDashboardExactWireAndOverflowSuppressAllTotals(t *testing.T) {
	for _, scenario := range []string{"exact", "cross-space-net", "cross-space-spending", "row-local"} {
		t.Run(scenario, func(t *testing.T) {
			f := independentDashboardFixture(t, 1, 2)
			participant := 302
			if scenario == "cross-space-spending" {
				participant = 301
			}
			independentDashboardExpense(t, f, 201, 301, participant, 1)
			independentDashboardExpense(t, f, 202, 305, 306, 1)
			target := f.id(201)
			amount := "9223372036854775807"
			if scenario == "exact" {
				amount = "9007199254740993"
			}
			// Bounded production records would require millions/billions of rows to
			// reach these aggregate boundaries. Change only admin-owned synthetic data,
			// with original constraints restored and validated before fixture cleanup.
			t.Cleanup(func() {
				independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL session_replication_role=replica;SET LOCAL ROLE kami_migrator;ALTER TABLE app.expenses NO FORCE ROW LEVEL SECURITY;ALTER TABLE app.allocations NO FORCE ROW LEVEL SECURITY;UPDATE app.expenses SET total_minor=1 WHERE group_id IN('%s','%s');UPDATE app.allocations SET amount_minor=1 WHERE group_id IN('%s','%s');ALTER TABLE app.expenses VALIDATE CONSTRAINT expenses_total_minor_check;ALTER TABLE app.allocations VALIDATE CONSTRAINT allocations_amount_minor_check;ALTER TABLE app.expenses FORCE ROW LEVEL SECURITY;ALTER TABLE app.allocations FORCE ROW LEVEL SECURITY;COMMIT`, f.id(201), f.id(202), f.id(201), f.id(202)))
			})
			independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL session_replication_role=replica;SET LOCAL ROLE kami_migrator;ALTER TABLE app.expenses NO FORCE ROW LEVEL SECURITY;ALTER TABLE app.allocations NO FORCE ROW LEVEL SECURITY;ALTER TABLE app.expenses DROP CONSTRAINT expenses_total_minor_check;ALTER TABLE app.allocations DROP CONSTRAINT allocations_amount_minor_check;UPDATE app.expenses SET total_minor=%s WHERE group_id='%s';UPDATE app.allocations SET amount_minor=%s WHERE group_id='%s';ALTER TABLE app.expenses ADD CONSTRAINT expenses_total_minor_check CHECK(total_minor BETWEEN 1 AND 999999999) NOT VALID;ALTER TABLE app.allocations ADD CONSTRAINT allocations_amount_minor_check CHECK(amount_minor BETWEEN 0 AND 999999999) NOT VALID;ALTER TABLE app.expenses FORCE ROW LEVEL SECURITY;ALTER TABLE app.allocations FORCE ROW LEVEL SECURITY;COMMIT`, amount, target, amount, target))
			if scenario == "row-local" {
				// Inject a second bounded amount into H without invoking a write that
				// correctly rejects the already-boundary financial state.
				independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL session_replication_role=replica;SET LOCAL ROLE kami_migrator;ALTER TABLE app.expenses NO FORCE ROW LEVEL SECURITY;ALTER TABLE app.allocations NO FORCE ROW LEVEL SECURITY;INSERT INTO app.expenses(id,group_id,creator_id,payer_id,total_minor,currency,description,effective_date,category,note,split,revision) VALUES('%s','%s','%s','%s',1,'USD','Boundary','2026-09-29','OTHER','','EQUAL',999);INSERT INTO app.allocations(expense_id,group_id,participant_id,amount_minor) VALUES('%s','%s','%s',1);ALTER TABLE app.expenses FORCE ROW LEVEL SECURITY;ALTER TABLE app.allocations FORCE ROW LEVEL SECURITY;COMMIT`, f.id(901), target, f.id(301), f.id(301), f.id(901), target, f.id(302)))
			}
			got := independentDashboardRead(t, f, 1)
			if scenario == "exact" {
				independentDashboardTotals(t, got, "9007199254740994", "2", "2", "9007199254740994", "2")
				return
			}
			if got["state"] != "INCOMPLETE" {
				t.Fatal(got)
			}
			totals := got["totals"].(map[string]any)
			if got["contextVersion"] != nil {
				t.Fatal("incomplete dashboard exposed usable context version")
			}
			if len(totals) != 2 || totals["__typename"] != "Problem" || totals["code"] != "AMOUNT_OVERFLOW" {
				t.Fatal("partial totals on overflow", got)
			}
			if scenario == "row-local" {
				var unavailable bool
				for _, item := range got["spaces"].([]any) {
					row := item.(map[string]any)
					if row["groupId"] == ledger.PublicID("Group", target) {
						unavailable = row["viewerNetMinor"] == nil && row["balances"].(map[string]any)["code"] == "AMOUNT_OVERFLOW"
					}
				}
				if !unavailable {
					t.Fatal("row-local overflow not explicit", got)
				}
			}
		})
	}
}

func independentDashboardDesignate(t *testing.T, f *expenseFixture, first, second int) {
	t.Helper()
	var version int64
	for _, step := range []struct {
		actor  int
		action string
	}{{1, "PROPOSE"}, {first, "CONSENT"}, {second, "CONSENT"}} {
		err := f.db.WithIdentity(f.ctx, f.id(step.actor), func(tx pgx.Tx) error {
			var raw []byte
			if err := tx.QueryRow(f.ctx, `SELECT app.household_designation($1,$2,$3,$4)`, step.action, version, f.id(first+100), f.id(second+100)).Scan(&raw); err != nil {
				return err
			}
			var result struct {
				State   string
				Version int64
			}
			if err := json.Unmarshal(raw, &result); err != nil {
				return err
			}
			version = result.Version
			if result.State != "PENDING" && result.State != "ACTIVE" {
				return fmt.Errorf("designation rejected: %s", raw)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}

func independentDashboardRead(t *testing.T, f *expenseFixture, actor int) map[string]any {
	t.Helper()
	return groupRequest(t, f, actor, independentDashboardQuery, nil, "householdDashboard", "HouseholdDashboard")
}
func independentDashboardExpense(t *testing.T, f *expenseFixture, group, payer, participant int, amount int64) {
	t.Helper()
	in := f.input
	in.GroupID = f.public("Group", group)
	in.Key = uuid.NewString()
	in.Total = amount
	in.PayerID = f.public("Membership", payer)
	in.ParticipantIDs = []string{f.public("Membership", participant)}
	if out := f.create(1, in); out.Kind != "COMMITTED" {
		t.Fatalf("expense: %+v", out)
	}
}
func independentDashboardTotals(t *testing.T, result map[string]any, net, active, open, total, count string) {
	t.Helper()
	want := map[string]string{"viewerNetMinor": net, "activeSpaceCount": active, "openBalanceCount": open, "totalSharedExpenseMinor": total, "totalSharedExpenseCount": count}
	got := result["totals"].(map[string]any)
	for key, value := range want {
		if got[key] != value {
			t.Fatalf("%s = %v, want %s; result=%v", key, got[key], value, result)
		}
	}
	if result["state"] != "COMPLETE" {
		t.Fatal(result)
	}
}

func TestIndependentDashboardCancellationOriginalSpacesAndPrivateExclusion(t *testing.T) {
	f := independentDashboardFixture(t, 1, 2)
	independentDashboardExpense(t, f, 201, 302, 301, 2000)
	independentDashboardExpense(t, f, 202, 305, 306, 2000)
	independentDashboardExpense(t, f, 203, 308, 307, 9000)
	got := independentDashboardRead(t, f, 1)
	independentDashboardTotals(t, got, "0", "2", "2", "4000", "2")
	raw, _ := json.Marshal(got)
	for _, secret := range []string{"Viewer-only SECRET", f.public("Group", 203), f.public("Membership", 307), "9000"} {
		if bytes.Contains(raw, []byte(secret)) {
			t.Fatalf("excluded content leaked: %s", raw)
		}
	}
	for _, row := range got["spaces"].([]any) {
		g := row.(map[string]any)
		b := g["balances"].(map[string]any)
		if b["settled"] != false || len(b["obligations"].([]any)) != 1 {
			t.Fatalf("cancellation erased source obligation: %v", g)
		}
	}
	// The other partner gets the opposite informational net with the same scope.
	independentDashboardTotals(t, independentDashboardRead(t, f, 2), "0", "2", "2", "4000", "2")
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL ROLE kami_migrator;SELECT id FROM app.groups WHERE id='%s' FOR UPDATE;UPDATE app.memberships SET active=false WHERE id='%s';COMMIT`, f.id(202), f.id(306)))
	independentDashboardTotals(t, independentDashboardRead(t, f, 1), "-2000", "1", "1", "2000", "1")
	// Readmission restores the ordinary group's lifetime history, not a new ledger.
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL ROLE kami_migrator;SELECT id FROM app.groups WHERE id='%s' FOR UPDATE;UPDATE app.memberships SET active=true WHERE id='%s';COMMIT`, f.id(202), f.id(306)))
	independentDashboardTotals(t, independentDashboardRead(t, f, 1), "0", "2", "2", "4000", "2")
}

func TestIndependentDashboardThreeSpaceSourceBreakdownAndTransitiveDebt(t *testing.T) {
	f := independentDashboardFixture(t, 1, 2)
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL ROLE kami_migrator;INSERT INTO app.memberships(id,group_id,user_id) VALUES('%s','%s','%s');UPDATE app.groups SET name='Fresh authorized label' WHERE id='%s';COMMIT`, f.id(309), f.id(203), f.id(102), f.id(202)))
	independentDashboardExpense(t, f, 201, 302, 301, 2000)
	independentDashboardExpense(t, f, 202, 305, 306, 2000)
	independentDashboardExpense(t, f, 203, 308, 307, 500)
	got := independentDashboardRead(t, f, 1)
	independentDashboardTotals(t, got, "-500", "3", "3", "4500", "3")
	var currentLabel bool
	for _, item := range got["spaces"].([]any) {
		row := item.(map[string]any)
		if row["groupId"] == f.public("Group", 202) {
			currentLabel = row["name"] == "Fresh authorized label"
		}
		if len(row["members"].([]any)) != len(row["balances"].(map[string]any)["positions"].([]any)) {
			t.Fatal("nested member projection incomplete", row)
		}
	}
	if !currentLabel {
		t.Fatal("stale label", got)
	}
	// Extend A→B into A→C through B. B's net is zero; the single
	// current obligation must name original H and its A/C memberships.
	independentDashboardExpense(t, f, 201, 303, 302, 2000)
	got = independentDashboardRead(t, f, 1)
	for _, item := range got["spaces"].([]any) {
		row := item.(map[string]any)
		if row["groupId"] != f.public("Group", 201) {
			continue
		}
		b := row["balances"].(map[string]any)
		obligations := b["obligations"].([]any)
		if b["settled"] != false || len(obligations) != 1 {
			t.Fatal(b)
		}
		o := obligations[0].(map[string]any)
		if o["from"].(map[string]any)["id"] != f.public("Membership", 301) || o["to"].(map[string]any)["id"] != f.public("Membership", 303) || o["amountMinor"] != "2000" {
			t.Fatal("unsimplified transitive debt", o)
		}
	}
}

func TestIndependentDashboardEmptyCycleAndZeroViewerDoesNotSettlePeers(t *testing.T) {
	f := independentDashboardFixture(t, 1, 2)
	independentDashboardTotals(t, independentDashboardRead(t, f, 1), "0", "2", "0", "0", "0")
	independentDashboardExpense(t, f, 201, 302, 303, 2000)
	got := independentDashboardRead(t, f, 1)
	independentDashboardTotals(t, got, "0", "2", "0", "2000", "1")
	for _, row := range got["spaces"].([]any) {
		g := row.(map[string]any)
		if g["groupId"] == f.public("Group", 201) {
			if b := g["balances"].(map[string]any); b["settled"] != false || len(b["obligations"].([]any)) != 1 {
				t.Fatalf("zero viewer misrepresented peers: %v", g)
			}
		}
	}
	independentDashboardExpense(t, f, 201, 303, 301, 2000)
	independentDashboardExpense(t, f, 201, 301, 302, 2000)
	got = independentDashboardRead(t, f, 1)
	independentDashboardTotals(t, got, "0", "2", "0", "6000", "3")
	for _, row := range got["spaces"].([]any) {
		b := row.(map[string]any)["balances"].(map[string]any)
		if b["settled"] != true || len(b["obligations"].([]any)) != 0 {
			t.Fatal(b)
		}
	}
}

func TestIndependentDashboardExcludedOwnerFallbackAndSuspension(t *testing.T) {
	f := independentDashboardFixture(t, 0, 0)
	got := independentDashboardRead(t, f, 1)
	if got["state"] != "UNAVAILABLE" || got["totals"] != nil || len(got["spaces"].([]any)) != 1 {
		t.Fatal(got)
	}
	independentDashboardDesignate(t, f, 2, 3)
	denied := groupRequest(t, f, 1, independentDashboardQuery, nil, "householdDashboard", "Problem")
	if denied["code"] != "NOT_FOUND" {
		t.Fatal(denied)
	}
	independentDashboardTotals(t, independentDashboardRead(t, f, 2), "0", "1", "0", "0", "0")
	// Ordinary Household ledger access remains independent for the excluded owner.
	groupRequest(t, f, 1, `query($id:ID!){group(id:$id){__typename ... on Group{id}}}`, map[string]any{"id": f.public("Group", 201)}, "group", "Group")
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL ROLE kami_migrator;SELECT app.household_lifecycle_lock(ARRAY['%s','%s','%s']::uuid[]);UPDATE app.memberships SET active=false WHERE id='%s';COMMIT`, f.id(101), f.id(102), f.id(103), f.id(303)))
	got = independentDashboardRead(t, f, 2)
	if got["state"] != "UNAVAILABLE" || got["totals"] != nil || len(got["spaces"].([]any)) != 1 {
		t.Fatal(got)
	}
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL ROLE kami_migrator;SELECT app.household_lifecycle_lock(ARRAY['%s','%s','%s']::uuid[]);UPDATE app.memberships SET active=true WHERE id='%s';COMMIT`, f.id(101), f.id(102), f.id(103), f.id(303)))
	got = independentDashboardRead(t, f, 2)
	if got["state"] != "UNAVAILABLE" || got["totals"] != nil {
		t.Fatal("readmission silently restored consent", got)
	}
}

func TestIndependentDashboardLockDeadlineReturnsNoRows(t *testing.T) {
	f := independentDashboardFixture(t, 1, 2)
	tx, err := f.admin.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(f.ctx, "SET LOCAL ROLE kami_migrator"); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(f.ctx, `SELECT singleton FROM app.household_designation_guard FOR UPDATE`); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	got := groupRequest(t, f, 1, independentDashboardQuery, nil, "householdDashboard", "Problem")
	if got["code"] != "UNAVAILABLE" || time.Since(start) > 7*time.Second {
		t.Fatalf("blocked read failed safe deadline: %v %s", got, time.Since(start))
	}
}

func TestIndependentDashboardAccountLossAndUnauthenticatedAccess(t *testing.T) {
	f := independentDashboardFixture(t, 1, 2)
	status, body, err := groupHTTP(f, 0, independentDashboardQuery, nil)
	if err != nil || status != 401 || !bytes.Contains(body, []byte("UNAUTHENTICATED")) {
		t.Fatalf("missing authentication accepted: %d %s %v", status, body, err)
	}
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL ROLE kami_migrator;UPDATE app.users SET enabled=false WHERE id='%s';COMMIT`, f.id(102)))
	got := independentDashboardRead(t, f, 1)
	if got["state"] != "UNAVAILABLE" || got["totals"] != nil || len(got["spaces"].([]any)) != 1 {
		t.Fatal("partner account loss left shared overview", got)
	}
	denied := groupRequest(t, f, 2, independentDashboardQuery, nil, "householdDashboard", "Problem")
	if denied["code"] != "NOT_FOUND" {
		t.Fatal(denied)
	}
	denied = groupRequest(t, f, 4, independentDashboardQuery, nil, "householdDashboard", "Problem")
	if denied["code"] != "NOT_FOUND" {
		t.Fatal("outsider dashboard access", denied)
	}
}

func TestIndependentDashboardDesignationEndingWhileReadWaits(t *testing.T) {
	f := independentDashboardFixture(t, 1, 2)
	var version int64
	independentDashboardExec(t, f, "SET ROLE kami_migrator")
	if err := f.admin.QueryRow(f.ctx, `SELECT version FROM app.household_designation_guard`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	independentDashboardExec(t, f, "RESET ROLE")
	ready, release, finished := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		finished <- f.db.WithIdentity(f.ctx, f.id(1), func(tx pgx.Tx) error {
			var raw []byte
			if err := tx.QueryRow(f.ctx, `SELECT app.household_designation('END',$1,NULL,NULL)`, version).Scan(&raw); err != nil {
				return err
			}
			close(ready)
			<-release
			return nil
		})
	}()
	released := false
	defer func() {
		if !released {
			close(release)
		}
	}()
	select {
	case <-ready:
	case err := <-finished:
		t.Fatalf("designation writer: %v", err)
	case <-time.After(3 * time.Second):
		t.Fatal("designation writer never acquired guard")
	}
	type response struct {
		status int
		body   []byte
		err    error
	}
	read := make(chan response, 1)
	go func() {
		status, body, err := groupHTTP(f, 1, independentDashboardQuery, nil)
		read <- response{status, body, err}
	}()
	deadline := time.Now().Add(3 * time.Second)
	for {
		var n int
		if err := f.admin.QueryRow(f.ctx, `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%household_dashboard_lock%'`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("read did not wait for designation guard")
		}
		time.Sleep(10 * time.Millisecond)
	}
	close(release)
	released = true
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	var result struct {
		Data   map[string]map[string]any
		Errors []any
	}
	select {
	case got := <-read:
		if got.err != nil || got.status != 200 || json.Unmarshal(got.body, &result) != nil || len(result.Errors) > 0 {
			t.Fatalf("race response: %s %v", got.body, got.err)
		}
	case <-time.After(7 * time.Second):
		t.Fatal("read never resumed")
	}
	got := result.Data["householdDashboard"]
	if got["state"] != "UNAVAILABLE" || got["totals"] != nil || len(got["spaces"].([]any)) != 1 {
		t.Fatal("terminated sharing returned stale overview", got)
	}
}

func TestIndependentDashboardNewEligibleGroupRestartsAndRemovalRechecks(t *testing.T) {
	for _, addition := range []bool{true, false} {
		t.Run(fmt.Sprint(addition), func(t *testing.T) {
			f := independentDashboardFixture(t, 1, 2)
			independentDashboardExpense(t, f, 203, 308, 307, 9000)
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
				status, body, err := groupHTTP(f, 1, independentDashboardQuery, nil)
				done <- response{status, body, err}
			}()
			// Observe the actual lock wait rather than assuming a scheduling delay.
			deadline := time.Now().Add(3 * time.Second)
			for {
				// PostgreSQL caches activity statistics inside this writer
				// transaction; each observation must refresh that snapshot.
				if _, err := tx.Exec(f.ctx, `SELECT pg_stat_clear_snapshot()`); err != nil {
					t.Fatal(err)
				}
				var n int
				if err := tx.QueryRow(f.ctx, `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%household_dashboard_lock%'`).Scan(&n); err != nil {
					t.Fatal(err)
				}
				if n > 0 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("dashboard did not reach group lock")
				}
				time.Sleep(10 * time.Millisecond)
			}
			if _, err = tx.Exec(f.ctx, "SET LOCAL ROLE kami_migrator"); err != nil {
				t.Fatal(err)
			}
			if addition {
				_, err = tx.Exec(f.ctx, `INSERT INTO app.memberships(id,group_id,user_id) VALUES($1,$2,$3)`, f.id(309), f.id(203), f.id(102))
			} else {
				_, err = tx.Exec(f.ctx, `UPDATE app.memberships SET active=false WHERE id=$1`, f.id(306))
			}
			if err != nil {
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
					t.Fatalf("race HTTP: %s %v", got.body, got.err)
				}
			case <-time.After(7 * time.Second):
				t.Fatal("race never completed")
			}
			got := result.Data["householdDashboard"]
			if addition {
				independentDashboardTotals(t, got, "-9000", "3", "1", "9000", "1")
			} else {
				independentDashboardTotals(t, got, "0", "1", "0", "0", "0")
			}
		})
	}
}
