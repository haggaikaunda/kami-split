//go:build integration

package expense_test

import (
	"fmt"
	"strings"
	"testing"
)

func contextDashboard(t *testing.T, f *expenseFixture, actor int) map[string]any {
	t.Helper()
	query := strings.Replace(independentDashboardQuery, "... on HouseholdDashboard{state", "... on HouseholdDashboard{contextVersion state", 1)
	return groupRequest(t, f, actor, query, nil, "householdDashboard", "HouseholdDashboard")
}

func contextView(t *testing.T, f *expenseFixture, filter map[string]any) map[string]any {
	t.Helper()
	query := strings.Replace(independentHouseholdViewQuery, "... on ExpenseView{", "... on ExpenseView{contextVersion ", 1)
	return groupRequest(t, f, 1, query, map[string]any{"first": 1, "filter": filter}, "householdExpenses", "ExpenseView")
}

func matchingContext(t *testing.T, f *expenseFixture) string {
	t.Helper()
	dashboard, view := contextDashboard(t, f, 1), contextView(t, f, nil)
	version, ok := dashboard["contextVersion"].(string)
	if !ok || len(version) != 64 || view["contextVersion"] != version {
		t.Fatalf("complete context versions do not match: dashboard=%v view=%v", dashboard["contextVersion"], view["contextVersion"])
	}
	return version
}

func TestContextVersionBindsCurrentMetadataWithEmptyLedger(t *testing.T) {
	f := independentDashboardFixture(t, 1, 2)
	t.Cleanup(func() {
		independentDashboardExec(t, f, fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; DELETE FROM app.group_trip WHERE group_id='%s'; COMMIT`, f.id(202)))
	})
	previous := matchingContext(t, f)
	// Each change leaves the same source set and an empty expense page. Neither
	// comparison of returned expense rows nor the cursor eligibility anchor can
	// detect these incompatible member/group contexts.
	changes := []struct{ name, sql string }{
		{"profile", fmt.Sprintf(`UPDATE app.users SET display_name='Updated member' WHERE id='%s'`, f.id(104))},
		{"participation", fmt.Sprintf(`UPDATE app.users SET enabled=false WHERE id='%s'`, f.id(104))},
		{"owner role", fmt.Sprintf(`UPDATE app.groups SET owner_membership_id='%s' WHERE id='%s'`, f.id(305), f.id(202))},
		{"membership", fmt.Sprintf(`UPDATE app.memberships SET active=false WHERE id='%s'`, f.id(304))},
		{"label", fmt.Sprintf(`UPDATE app.groups SET name='Updated space' WHERE id='%s'`, f.id(202))},
		{"trip", fmt.Sprintf(`INSERT INTO app.group_trip(group_id,destination,start_date,end_date) VALUES('%s','Coast','2026-10-01','2026-10-02')`, f.id(202))},
		{"designation generation", `UPDATE app.household_designation_guard SET version=version+1 WHERE singleton`},
	}
	for _, change := range changes {
		t.Run(change.name, func(t *testing.T) {
			independentDashboardExec(t, f, "BEGIN; SET LOCAL ROLE kami_migrator; "+change.sql+"; COMMIT")
			current := matchingContext(t, f)
			if current == previous {
				t.Fatal("metadata change retained context version")
			}
			previous = current
		})
	}
	if other := contextDashboard(t, f, 2)["contextVersion"]; other == previous {
		t.Fatal("context version is not viewer scoped")
	}
}

func TestContextVersionIncludesSourcesOutsideFilteredPage(t *testing.T) {
	f := independentDashboardFixture(t, 1, 2)
	emptyVersion := matchingContext(t, f)
	independentViewExpense(t, f, 201, 301, 302, 100, "2026-10-01", "HOME")
	independentViewExpense(t, f, 202, 305, 306, 200, "2026-09-01", "HOME")
	previous := matchingContext(t, f)
	if previous != emptyVersion {
		t.Fatal("financial writes changed metadata context version")
	}
	filtered := contextView(t, f, map[string]any{"groupId": f.public("Group", 201)})
	if filtered["contextVersion"] != previous {
		t.Fatal("structured filter changed context version")
	}
	if len(filtered["edges"].([]any)) != 1 {
		t.Fatal("expected one filtered row")
	}
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; SELECT id FROM app.groups WHERE id='%s' FOR UPDATE; UPDATE app.memberships SET active=false WHERE id='%s'; COMMIT`, f.id(202), f.id(306)))
	if current := matchingContext(t, f); current == previous {
		t.Fatal("removed source outside page retained context version")
	}
}

func TestContextVersionUnavailableAndDenied(t *testing.T) {
	f := independentDashboardFixture(t, 0, 0)
	got := contextDashboard(t, f, 1)
	if got["state"] != "UNAVAILABLE" || got["contextVersion"] != nil {
		t.Fatal("unavailable dashboard exposed context version", got)
	}
	independentDashboardDesignate(t, f, 1, 2)
	matchingContext(t, f)
	query := strings.Replace(independentDashboardQuery, "... on HouseholdDashboard{state", "... on HouseholdDashboard{contextVersion state", 1)
	denied := groupRequest(t, f, 3, query, nil, "householdDashboard", "Problem")
	if denied["code"] != "NOT_FOUND" || denied["contextVersion"] != nil {
		t.Fatal("denied dashboard exposed context version", denied)
	}
}
