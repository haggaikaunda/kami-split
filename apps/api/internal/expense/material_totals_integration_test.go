//go:build integration

package expense_test

import (
	"reflect"
	"testing"
)

func TestMaterialCategoryAggregatesCompleteFilteredAnchoredAndRepaymentIndependent(t *testing.T) {
	f := independentViewDataset(t)
	first := independentViewRead(t, f, 1, 1, "", nil, "", "ExpenseView")
	if first["viewerShareMinor"] != "200" || first["viewerPaidMinor"] != "500" {
		t.Fatal(first)
	}
	want := []any{
		map[string]any{"category": "DINING", "totalExpenseMinor": "600", "viewerShareMinor": "200", "expenseCount": "2"},
		map[string]any{"category": "GROCERIES", "totalExpenseMinor": "300", "viewerShareMinor": "0", "expenseCount": "1"},
		map[string]any{"category": "HOME", "totalExpenseMinor": "100", "viewerShareMinor": "0", "expenseCount": "1"},
	}
	if !reflect.DeepEqual(first["categories"], want) {
		t.Fatal(first)
	}
	filter := map[string]any{"groupId": f.public("Group", 201), "memberId": f.public("Membership", 301), "category": "GROCERIES", "from": "2026-09-30", "to": "2026-09-30"}
	zero := independentViewRead(t, f, 1, 1, "", filter, "", "ExpenseView")
	if zero["viewerShareMinor"] != "0" || zero["expenseCount"] != "1" || zero["totalExpenseMinor"] != "300" {
		t.Fatal(zero)
	}
	empty := independentViewRead(t, f, 1, 1, "", map[string]any{"category": "OTHER"}, "", "ExpenseView")
	if empty["viewerShareMinor"] != "0" || empty["viewerPaidMinor"] != "0" || len(empty["categories"].([]any)) != 0 {
		t.Fatal(empty)
	}
	repayment := repaymentInput(f)
	repayment.Amount = 100
	if out := repaymentRecord(t, repaymentEndpoint(t, f, f.db), 1, repayment); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	dashboard := independentDashboardRead(t, f, 1)
	totals := dashboard["totals"].(map[string]any)
	if totals["viewerShareMinor"] != "200" || totals["viewerPaidMinor"] != "500" {
		t.Fatal(totals)
	}
	cursor := first["pageInfo"].(map[string]any)["endCursor"].(string)
	independentViewExpense(t, f, 201, 302, 301, 500, "2026-08-01", "HOME")
	next := independentViewRead(t, f, 1, 100, cursor, nil, "", "ExpenseView")
	if !reflect.DeepEqual(next["categories"], want) || next["viewerShareMinor"] != "200" || next["viewerPaidMinor"] != "500" {
		t.Fatal(next)
	}
	fresh := independentViewRead(t, f, 1, 1, "", nil, "", "ExpenseView")
	if fresh["viewerShareMinor"] != "700" || fresh["viewerPaidMinor"] != "500" {
		t.Fatal(fresh)
	}
}
