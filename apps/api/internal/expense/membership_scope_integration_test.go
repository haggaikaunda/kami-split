//go:build integration

package expense_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/invitation"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
)

// Exercise the Group and Viewer composition used by the direct ledger route,
// including the distinct data selections for all five workspace tabs.
const membershipWorkspaceQuery = `query($id:ID!,$overview:Boolean!,$ledger:Boolean!,$balances:Boolean!,$activity:Boolean!){viewer{__typename ... on Viewer{today canCreateGroups groups{id isHousehold}}} group(id:$id){__typename ... on Group{id isHousehold viewerMembership{id role} members{id status role} expenses(first:5) @include(if:$overview){edges{node{id totalMinor}}} balances @include(if:$balances){__typename ... on GroupBalances{totalExpenseMinor settled positions{member{id} netMinor}}} repayments(first:5) @include(if:$balances){edges{node{id amountMinor}}}}} groupExpenses(groupId:$id,first:20) @include(if:$ledger){__typename ... on ExpenseView{totalExpenseMinor expenseCount edges{node{id groupId}}}} groupActivity(groupId:$id,first:20) @include(if:$activity){__typename ... on ActivityConnection{edges{node{groupId amountMinor}}}}}`

func membershipWorkspaceTabs(t *testing.T, f *expenseFixture, actor int, membership, role string) {
	t.Helper()
	for _, tab := range []string{"overview", "expenses", "balances", "activity", "members"} {
		t.Run(fmt.Sprintf("actor%d/%s", actor, tab), func(t *testing.T) {
			vars := map[string]any{"id": f.public("Group", 201), "overview": tab == "overview", "ledger": tab == "expenses", "balances": tab == "overview" || tab == "balances", "activity": tab == "activity"}
			status, raw, err := groupHTTP(f, actor, membershipWorkspaceQuery, vars)
			var response struct {
				Data   map[string]map[string]any
				Errors []any
			}
			if err != nil || status != 200 || json.Unmarshal(raw, &response) != nil || len(response.Errors) != 0 {
				t.Fatalf("workspace response: %d %s %v", status, raw, err)
			}
			viewer, group := response.Data["viewer"], response.Data["group"]
			if viewer["__typename"] != "Viewer" || viewer["today"] == nil || viewer["canCreateGroups"] != (actor == 1) {
				t.Fatal("viewer composition/capability", viewer)
			}
			var discovered bool
			for _, item := range viewer["groups"].([]any) {
				row := item.(map[string]any)
				if row["id"] == f.public("Group", 201) && row["isHousehold"] == true {
					discovered = true
				}
			}
			if !discovered || group["__typename"] != "Group" || group["id"] != f.public("Group", 201) || group["isHousehold"] != true {
				t.Fatal("Household discovery or direct route", response.Data)
			}
			member := group["viewerMembership"].(map[string]any)
			if member["id"] != membership || member["role"] != role || len(group["members"].([]any)) != 3 {
				t.Fatal("stable member identity/role/history", group)
			}
			if tab == "overview" && len(group["expenses"].(map[string]any)["edges"].([]any)) != 1 {
				t.Fatal(group)
			}
			if tab == "overview" || tab == "balances" {
				balance := group["balances"].(map[string]any)
				if balance["__typename"] != "GroupBalances" || balance["totalExpenseMinor"] != "2000" || balance["settled"] != false {
					t.Fatal(balance)
				}
			}
			if tab == "expenses" {
				view := response.Data["groupExpenses"]
				if view["__typename"] != "ExpenseView" || view["totalExpenseMinor"] != "2000" || view["expenseCount"] != "1" {
					t.Fatal(view)
				}
			}
			if tab == "activity" {
				activity := response.Data["groupActivity"]
				if activity["__typename"] != "ActivityConnection" || len(activity["edges"].([]any)) != 1 {
					t.Fatal(activity)
				}
			}
		})
	}
}

func TestMembershipScopeExistingMembersNeedNoDesignationAndDirectWorkspace(t *testing.T) {
	f := independentDashboardFixture(t)
	independentDashboardExpense(t, f, 201, 302, 301, 2000)
	independentDashboardExpense(t, f, 202, 305, 306, 3000)
	independentDashboardExpense(t, f, 203, 308, 307, 9000)
	for _, actor := range []int{1, 2} {
		net := "1000"
		if actor == 2 {
			net = "-1000"
		}
		independentDashboardTotals(t, independentDashboardRead(t, f, actor), net, "2", "2", "5000", "2")
		independentViewSummary(t, independentViewRead(t, f, actor, 100, "", nil, "", "ExpenseView"), "5000", "2", map[string][2]string{"2026-09": {"5000", "2"}})
		activity := independentHouseholdActivity(t, f, actor, map[string]any{"first": 100})
		if activity["__typename"] != "ActivityConnection" || len(activity["edges"].([]any)) != 2 {
			t.Fatal(activity)
		}
		role := "OWNER"
		if actor == 2 {
			role = "MEMBER"
		}
		membershipWorkspaceTabs(t, f, actor, f.public("Membership", 300+actor), role)
	}
}

func TestMembershipScopeSoleOwnerKeepsRealHouseholdData(t *testing.T) {
	f := independentDashboardFixture(t)
	independentDashboardExpense(t, f, 201, 302, 301, 2000)
	independentDashboardExpense(t, f, 202, 305, 306, 3000)
	injectHistoricalDeparture(t, f, f.id(302))
	independentDashboardTotals(t, independentDashboardRead(t, f, 1), "-2000", "1", "1", "2000", "1")
	independentViewSummary(t, independentViewRead(t, f, 1, 100, "", nil, "", "ExpenseView"), "2000", "1", map[string][2]string{"2026-09": {"2000", "1"}})
	membershipWorkspaceTabs(t, f, 1, f.public("Membership", 301), "OWNER")
	if got := independentViewRead(t, f, 1, 100, "", nil, f.public("Group", 202), "ExpenseView"); got["totalExpenseMinor"] != "3000" {
		t.Fatal("independent source access lost", got)
	}
}

func TestMembershipScopeThirdMemberHasAccessAndRequiresEveryMemberInSource(t *testing.T) {
	f := independentDashboardFixture(t)
	independentDashboardExpense(t, f, 201, 302, 301, 2000)
	independentDashboardExpense(t, f, 202, 305, 306, 3000)
	cursor := independentViewRead(t, f, 1, 1, "", nil, "", "ExpenseView")["pageInfo"].(map[string]any)["endCursor"].(string)
	version := matchingContext(t, f)
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator;SELECT app.household_lifecycle_lock(ARRAY(SELECT m.user_id FROM app.memberships m JOIN app.installation i ON i.household_group_id=m.group_id ORDER BY m.user_id)); UPDATE app.memberships SET active=true WHERE id='%s'; UPDATE app.groups SET owner_membership_id='%s' WHERE id='%s'; COMMIT`, f.id(303), f.id(303), f.id(201)))
	if current := matchingContext(t, f); current == version {
		t.Fatal("third membership retained context")
	}
	if got := independentViewRead(t, f, 1, 1, cursor, nil, "", "Problem"); got["code"] != "INVALID_CURSOR" {
		t.Fatal("third membership retained old source cursor", got)
	}
	for _, actor := range []int{1, 2, 3} {
		net := "0"
		if actor == 1 {
			net = "-2000"
		}
		if actor == 2 {
			net = "2000"
		}
		openCount := "1"
		if actor == 3 {
			openCount = "0"
		}
		independentDashboardTotals(t, independentDashboardRead(t, f, actor), net, "1", openCount, "2000", "1")
		independentViewSummary(t, independentViewRead(t, f, actor, 100, "", nil, "", "ExpenseView"), "2000", "1", map[string][2]string{"2026-09": {"2000", "1"}})
		role := "MEMBER"
		if actor == 3 {
			role = "OWNER"
		}
		membershipWorkspaceTabs(t, f, actor, f.public("Membership", 300+actor), role)
	}
	// A and B keep their independent original ledger even while C's absence
	// removes it from the common scope; adding C restores the same financial rows.
	independentViewSummary(t, independentViewRead(t, f, 2, 100, "", nil, f.public("Group", 202), "ExpenseView"), "3000", "1", map[string][2]string{"2026-09": {"3000", "1"}})
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; INSERT INTO app.memberships(id,group_id,user_id) VALUES('%s','%s','%s'); COMMIT`, f.id(310), f.id(202), f.id(103)))
	independentDashboardTotals(t, independentDashboardRead(t, f, 3), "0", "2", "0", "5000", "2")
	independentViewSummary(t, independentViewRead(t, f, 3, 100, "", nil, "", "ExpenseView"), "5000", "2", map[string][2]string{"2026-09": {"5000", "2"}})
}

func TestMembershipScopeAccountLossCannotShrinkCommonMembersAndBroadenSources(t *testing.T) {
	for _, loss := range []string{"disable", "unlink", "auth-delete"} {
		t.Run(loss, func(t *testing.T) {
			f := independentDashboardFixture(t)
			independentDashboardExpense(t, f, 201, 302, 301, 2000)
			independentDashboardExpense(t, f, 202, 305, 306, 3000)
			independentDashboardExpense(t, f, 203, 308, 307, 9000)
			independentDashboardExec(t, f, fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator;SELECT app.household_lifecycle_lock(ARRAY(SELECT m.user_id FROM app.memberships m JOIN app.installation i ON i.household_group_id=m.group_id ORDER BY m.user_id)); UPDATE app.memberships SET active=true WHERE id='%s'; INSERT INTO app.memberships(id,group_id,user_id) VALUES('%s','%s','%s'); COMMIT`, f.id(303), f.id(310), f.id(202), f.id(103)))
			before := matchingContext(t, f)
			viewCursor := independentViewRead(t, f, 1, 1, "", nil, "", "ExpenseView")["pageInfo"].(map[string]any)["endCursor"].(string)
			activityCursor := independentHouseholdActivity(t, f, 1, map[string]any{"first": 1})["pageInfo"].(map[string]any)["endCursor"]
			sql := fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; UPDATE app.users SET enabled=false WHERE id='%s'; COMMIT`, f.id(102))
			if loss == "unlink" {
				sql = fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; UPDATE app.users SET enabled=false,live_auth_id=NULL WHERE id='%s'; COMMIT`, f.id(102))
			}
			if loss == "auth-delete" {
				sql = fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; UPDATE app.users SET enabled=false WHERE id='%s'; RESET ROLE; DELETE FROM auth.users WHERE id='%s'; COMMIT`, f.id(102), f.id(2))
			}
			independentDashboardExec(t, f, sql)
			if current := matchingContext(t, f); current == before {
				t.Fatal("account loss retained context")
			}
			independentDashboardTotals(t, independentDashboardRead(t, f, 1), "-2000", "1", "1", "2000", "1")
			independentDashboardTotals(t, independentDashboardRead(t, f, 3), "0", "1", "0", "2000", "1")
			independentViewSummary(t, independentViewRead(t, f, 1, 100, "", nil, "", "ExpenseView"), "2000", "1", map[string][2]string{"2026-09": {"2000", "1"}})
			if got := independentViewRead(t, f, 1, 1, viewCursor, nil, "", "Problem"); got["code"] != "INVALID_CURSOR" {
				t.Fatal(got)
			}
			if got := independentHouseholdActivity(t, f, 1, map[string]any{"first": 1, "after": activityCursor}); got["code"] != "INVALID_CURSOR" {
				t.Fatal(got)
			}
			fresh := independentHouseholdActivity(t, f, 1, map[string]any{"first": 100})
			if fresh["__typename"] != "ActivityConnection" || len(fresh["edges"].([]any)) != 1 {
				t.Fatal("account loss broadened Activity", fresh)
			}
			if got := groupRequest(t, f, 2, independentDashboardQuery, nil, "householdDashboard", "Problem"); got["code"] != "NOT_FOUND" {
				t.Fatal("lost account retained access", got)
			}
		})
	}
}

type membershipEmailProvider struct{ emails map[string]string }

func (p membershipEmailProvider) CurrentEmail(_ context.Context, subject string) (auth.ProviderEmail, error) {
	return auth.ProviderEmail{Subject: subject, Email: p.emails[subject], Verified: true}, nil
}

func membershipAuthenticatedContext(t *testing.T, f *expenseFixture, actor int) context.Context {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/", nil).WithContext(f.ctx)
	request.Header.Set("Authorization", "Bearer "+f.token(actor))
	var ctx context.Context
	f.verifier.Authenticate(http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) { ctx = request.Context() })).ServeHTTP(httptest.NewRecorder(), request)
	if ctx == nil {
		t.Fatal("missing verified context")
	}
	return ctx
}

func TestMembershipScopeTargetedInvitationAcceptUnlocksWorkspaceOnce(t *testing.T) {
	f := independentDashboardFixture(t)
	// B has a stable existing Auth/application account but no Household admission.
	// The real service must establish membership; merely seeing the link cannot.
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; DELETE FROM app.memberships WHERE id='%s'; COMMIT`, f.id(302)))
	t.Cleanup(func() {
		independentDashboardExec(t, f, fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; DELETE FROM app.invitation_delivery WHERE action_id IN (SELECT id FROM app.invitation_actions WHERE group_id='%s'); DELETE FROM app.invitation_actions WHERE group_id='%s'; DELETE FROM app.invitations WHERE group_id='%s'; COMMIT`, f.id(201), f.id(201), f.id(201)))
	})
	protector, err := invitation.NewProtector("membership-test", map[string][]byte{"membership-test": make([]byte, 32)})
	if err != nil {
		t.Fatal(err)
	}
	recipientEmail := f.id(2) + "@example.invalid"
	provider := membershipEmailProvider{emails: map[string]string{f.id(1): f.id(1) + "@example.invalid", f.id(2): recipientEmail, f.id(3): f.id(3) + "@example.invalid"}}
	service, err := invitation.New(f.db, protector, provider)
	if err != nil {
		t.Fatal(err)
	}
	ownerCtx := membershipAuthenticatedContext(t, f, 1)
	invite, err := service.Create(ownerCtx, uuid.MustParse(f.id(201)), recipientEmail, uuid.New())
	if err != nil || invite.Outcome != "SAVED" {
		t.Fatalf("invitation creation: %v %v", invite.Outcome, err)
	}
	independentDashboardExec(t, f, "SET ROLE kami_migrator")
	var cipher []byte
	var keyVersion string
	err = f.admin.QueryRow(f.ctx, `SELECT token_cipher,token_key FROM app.invitations WHERE id=$1`, invite.InvitationID).Scan(&cipher, &keyVersion)
	independentDashboardExec(t, f, "RESET ROLE")
	if err != nil {
		t.Fatal(err)
	}
	token, err := protector.Decrypt(cipher, keyVersion, "TARGETED:"+invite.InvitationID.String())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Preview(f.ctx, string(token)); err != nil {
		t.Fatal(err)
	}
	if got := groupRequest(t, f, 2, independentDashboardQuery, nil, "householdDashboard", "Problem"); got["code"] != "NOT_FOUND" {
		t.Fatal("preview granted Household access", got)
	}
	wrong, err := service.Accept(membershipAuthenticatedContext(t, f, 3), string(token), uuid.New())
	if err != nil || wrong.HasAccess {
		t.Fatalf("wrong-account acceptance: %v %v", wrong.Outcome, err)
	}
	acceptKey := uuid.New()
	recipientCtx := membershipAuthenticatedContext(t, f, 2)
	accepted, err := service.Accept(recipientCtx, string(token), acceptKey)
	if err != nil || accepted.Outcome != "ADMITTED" || !accepted.HasAccess || accepted.MembershipID == uuid.Nil {
		t.Fatalf("acceptance: %v %v", accepted.Outcome, err)
	}
	replay, err := service.Accept(recipientCtx, string(token), acceptKey)
	if err != nil || replay.MembershipID != accepted.MembershipID || !replay.HasAccess {
		t.Fatalf("same acceptance retry: %v %v", replay.Outcome, err)
	}
	memberID := ledger.PublicID("Membership", accepted.MembershipID.String())
	input := f.input
	input.Key = uuid.NewString()
	input.Total = 2000
	input.PayerID = memberID
	input.ParticipantIDs = []string{f.public("Membership", 301)}
	if out := f.create(2, input); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	membershipWorkspaceTabs(t, f, 1, f.public("Membership", 301), "OWNER")
	membershipWorkspaceTabs(t, f, 2, memberID, "MEMBER")
	independentDashboardTotals(t, independentDashboardRead(t, f, 1), "-2000", "2", "1", "2000", "1")
	independentDashboardTotals(t, independentDashboardRead(t, f, 2), "2000", "2", "1", "2000", "1")
	independentViewSummary(t, independentViewRead(t, f, 2, 100, "", nil, "", "ExpenseView"), "2000", "1", map[string][2]string{"2026-09": {"2000", "1"}})
	activity := independentHouseholdActivity(t, f, 2, map[string]any{"first": 100})
	if activity["__typename"] != "ActivityConnection" || len(activity["edges"].([]any)) != 1 {
		t.Fatal(activity)
	}
	// Historical acceptance does not readmit a subsequently removed member.
	injectHistoricalDeparture(t, f, accepted.MembershipID.String())
	historical, err := service.Accept(recipientCtx, string(token), uuid.New())
	if err != nil || historical.Outcome != "HISTORICAL_ACCEPTANCE" || historical.HasAccess || historical.MembershipID != accepted.MembershipID {
		t.Fatalf("historical acceptance restored access: %v %v", historical.Outcome, err)
	}
	if got := groupRequest(t, f, 2, independentDashboardQuery, nil, "householdDashboard", "Problem"); got["code"] != "NOT_FOUND" {
		t.Fatal(got)
	}
}

func TestMembershipScopeReadmissionCannotReusePreviousCursor(t *testing.T) {
	for _, member := range []int{302, 306} {
		t.Run(fmt.Sprintf("membership%d", member), func(t *testing.T) {
			f := independentDashboardFixture(t)
			independentDashboardExpense(t, f, 201, 302, 301, 2000)
			independentDashboardExpense(t, f, 202, 305, 306, 3000)
			view := independentViewRead(t, f, 1, 1, "", nil, "", "ExpenseView")
			cursor := view["pageInfo"].(map[string]any)["endCursor"].(string)
			activity := independentHouseholdActivity(t, f, 1, map[string]any{"first": 1})
			activityCursor := activity["pageInfo"].(map[string]any)["endCursor"]
			before := matchingContext(t, f)
			injectHistoricalDeparture(t, f, f.id(member))
			independentDashboardExec(t, f, fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator;SELECT app.household_lifecycle_lock(ARRAY(SELECT m.user_id FROM app.memberships m JOIN app.installation i ON i.household_group_id=m.group_id ORDER BY m.user_id)); UPDATE app.memberships SET active=true WHERE id='%s'; COMMIT`, f.id(member)))
			if current := matchingContext(t, f); current == before {
				t.Fatal("leave/rejoin retained old metadata context")
			}
			if got := independentViewRead(t, f, 1, 1, cursor, nil, "", "Problem"); got["code"] != "INVALID_CURSOR" {
				t.Fatal("readmission replayed obsolete expense scope", got)
			}
			if got := independentHouseholdActivity(t, f, 1, map[string]any{"first": 1, "after": activityCursor}); got["code"] != "INVALID_CURSOR" {
				t.Fatal("readmission replayed obsolete activity scope", got)
			}
			independentViewSummary(t, independentViewRead(t, f, 1, 100, "", nil, "", "ExpenseView"), "5000", "2", map[string][2]string{"2026-09": {"5000", "2"}})
		})
	}
}

func TestMembershipScopeAdmissionDuringDiscoveryUsesCurrentCommonSources(t *testing.T) {
	f := independentDashboardFixture(t)
	independentDashboardExpense(t, f, 201, 302, 301, 2000)
	independentDashboardExpense(t, f, 202, 305, 306, 3000)
	tx, err := f.admin.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(f.ctx, `SET LOCAL ROLE kami_migrator; SELECT app.household_lifecycle_lock(ARRAY(SELECT m.user_id FROM app.memberships m JOIN app.installation i ON i.household_group_id=m.group_id ORDER BY m.user_id))`); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(f.ctx, `UPDATE app.memberships SET active=true WHERE id=$1`, f.id(303)); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(f.ctx, "RESET ROLE"); err != nil {
		t.Fatal(err)
	}
	var writerPID int
	if err = tx.QueryRow(f.ctx, `SELECT pg_backend_pid()`).Scan(&writerPID); err != nil {
		t.Fatal(err)
	}
	type response struct {
		status int
		raw    []byte
		err    error
	}
	done := make(chan response, 1)
	go func() {
		status, raw, err := groupHTTP(f, 1, independentDashboardQuery, nil)
		done <- response{status, raw, err}
	}()
	deadline := time.Now().Add(3 * time.Second)
	for {
		if _, err = tx.Exec(f.ctx, `SELECT pg_stat_clear_snapshot()`); err != nil {
			t.Fatal(err)
		}
		var count int
		if err = tx.QueryRow(f.ctx, `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))`, writerPID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("Household discovery did not wait for membership writer")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err = tx.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-done:
		var parsed struct {
			Data   map[string]map[string]any
			Errors []any
		}
		if got.err != nil || got.status != 200 || json.Unmarshal(got.raw, &parsed) != nil || len(parsed.Errors) != 0 {
			t.Fatalf("membership race response: %d %s %v", got.status, got.raw, got.err)
		}
		independentDashboardTotals(t, parsed.Data["householdDashboard"], "-2000", "1", "1", "2000", "1")
	case <-time.After(7 * time.Second):
		t.Fatal("membership discovery never resumed")
	}
}
