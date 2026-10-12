//go:build integration

package expense_test

import (
	"fmt"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"reflect"
	"sort"
	"strconv"
	"testing"
)

func TestExpenseViewMultipleFiltersAndPayerDistinction(t *testing.T) {
	f := independentViewDataset(t)
	member := func(n int) string { return f.public("Membership", n) }
	tests := []struct {
		name         string
		filter       map[string]any
		total, count string
	}{
		{"categories OR", map[string]any{"categories": []string{"HOME", "DINING"}}, "700", "3"},
		{"people OR across sources", map[string]any{"memberIds": []string{member(301), member(305)}}, "1000", "4"},
		{"payer excludes participant", map[string]any{"paidByIds": []string{member(301)}}, "100", "1"},
		{"involving includes zero allocation", map[string]any{"memberIds": []string{member(301)}}, "600", "3"},
		{"AND fields OR alternatives", map[string]any{"categories": []string{"HOME", "DINING"}, "memberIds": []string{member(301), member(305)}, "paidByIds": []string{member(302), member(305)}}, "600", "2"},
		{"inclusive dates", map[string]any{"categories": []string{"HOME", "DINING"}, "from": "2026-09-30", "to": "2026-09-30"}, "600", "2"},
		{"empty intersection", map[string]any{"categories": []string{"HOME"}, "paidByIds": []string{member(302)}}, "0", "0"},
		{"duplicates do not duplicate expenses", map[string]any{"categories": []string{"HOME", "HOME"}, "paidByIds": []string{member(301), member(301)}}, "100", "1"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := independentViewRead(t, f, 1, 1, "", tc.filter, "", "ExpenseView")
			if got["totalExpenseMinor"] != tc.total || got["expenseCount"] != tc.count {
				t.Fatalf("got %v", got)
			}
		})
	}
	for _, field := range []string{"memberIds", "paidByIds"} {
		for _, bad := range []string{member(307), member(999), ""} {
			expected := "NOT_FOUND"
			if bad == "" {
				expected = "INVALID_INPUT"
			}
			got := independentViewRead(t, f, 1, 1, "", map[string]any{field: []string{member(301), bad}}, "", "Problem")
			if got["code"] != expected {
				t.Fatalf("%s mixed selection: %v", field, got)
			}
		}
		got := independentViewRead(t, f, 1, 1, "", map[string]any{field: []string{member(301), member(305)}}, f.public("Group", 201), "Problem")
		if got["code"] != "NOT_FOUND" {
			t.Fatal("cross-group selection accepted", got)
		}
	}
	trip := independentViewRead(t, f, 1, 1, "", map[string]any{"paidByIds": []string{member(305)}, "memberIds": []string{member(306)}}, f.public("Group", 202), "ExpenseView")
	if trip["expenseCount"] != "1" {
		t.Fatal(trip)
	}
}

func TestExpenseViewAllSortsPageCompleteAuthorizedDataset(t *testing.T) {
	f := independentViewDataset(t)
	// Equal amounts and dates across spaces exercise every deterministic tie-break.
	for i := 0; i < 9; i++ {
		group, payer, participant := 201, 301, 302
		if i%2 == 1 {
			group, payer, participant = 202, 305, 306
		}
		independentViewExpense(t, f, group, payer, participant, int64(100+(i%3)*100), "2026-09-30", "HOME")
	}
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN;SET LOCAL session_replication_role=replica;SET LOCAL ROLE kami_migrator;ALTER TABLE app.expenses NO FORCE ROW LEVEL SECURITY;UPDATE app.expenses SET created_at='2026-09-30T12:00:00.123456Z' WHERE group_id IN('%s','%s');UPDATE app.expense_revisions SET created_at='2026-09-30T12:00:00.123456Z' WHERE group_id IN('%s','%s');ALTER TABLE app.expenses FORCE ROW LEVEL SECURITY;COMMIT`, f.id(201), f.id(202), f.id(201), f.id(202)))
	for _, order := range []string{"DATE_DESC", "DATE_ASC", "AMOUNT_DESC", "AMOUNT_ASC"} {
		t.Run(order, func(t *testing.T) {
			filter := map[string]any{"sort": order}
			full := independentViewRead(t, f, 1, 100, "", filter, "", "ExpenseView")
			rows := full["edges"].([]any)
			expected := append([]any(nil), rows...)
			sort.Slice(expected, func(i, j int) bool {
				a := expected[i].(map[string]any)["node"].(map[string]any)
				b := expected[j].(map[string]any)["node"].(map[string]any)
				comparison := 0
				if order == "AMOUNT_ASC" || order == "AMOUNT_DESC" {
					av, _ := strconv.ParseInt(a["totalMinor"].(string), 10, 64)
					bv, _ := strconv.ParseInt(b["totalMinor"].(string), 10, 64)
					if av < bv {
						comparison = -1
					}
					if av > bv {
						comparison = 1
					}
				}
				for _, key := range []string{"effectiveDate", "createdAt", "groupId", "id"} {
					if comparison == 0 {
						av := a[key].(string)
						bv := b[key].(string)
						if key == "groupId" {
							av, _ = ledger.ParseID(av, "Group")
							bv, _ = ledger.ParseID(bv, "Group")
						}
						if key == "id" {
							av, _ = ledger.ParseID(av, "Expense")
							bv, _ = ledger.ParseID(bv, "Expense")
						}
						if av < bv {
							comparison = -1
						}
						if av > bv {
							comparison = 1
						}
					}
				}
				if order == "DATE_ASC" || order == "AMOUNT_ASC" {
					return comparison < 0
				}
				return comparison > 0
			})
			ids := func(edges []any) []string {
				result := []string{}
				for _, edge := range edges {
					result = append(result, edge.(map[string]any)["node"].(map[string]any)["id"].(string))
				}
				return result
			}
			if !reflect.DeepEqual(ids(rows), ids(expected)) {
				t.Fatalf("incorrect complete %s order", order)
			}
			collected := []any{}
			after := ""
			for page := 0; page < 20; page++ {
				got := independentViewRead(t, f, 1, 2, after, filter, "", "ExpenseView")
				if got["expenseCount"] != full["expenseCount"] || got["totalExpenseMinor"] != full["totalExpenseMinor"] || !reflect.DeepEqual(got["categories"], full["categories"]) {
					t.Fatal("page-derived summaries", got)
				}
				collected = append(collected, got["edges"].([]any)...)
				info := got["pageInfo"].(map[string]any)
				if !info["hasNextPage"].(bool) {
					break
				}
				after = info["endCursor"].(string)
			}
			if !reflect.DeepEqual(ids(collected), ids(rows)) {
				t.Fatal("pages omit, duplicate or reorder rows", ids(collected), ids(rows))
			}
			first := rows[0].(map[string]any)["cursor"].(string)
			other := "DATE_DESC"
			if order == other {
				other = "DATE_ASC"
			}
			got := independentViewRead(t, f, 1, 2, first, map[string]any{"sort": other}, "", "Problem")
			if got["code"] != "INVALID_CURSOR" {
				t.Fatal("sort cursor reused", got)
			}
		})
	}
}

func TestExpenseViewAmountAnchorSurvivesEditAndCanonicalSelections(t *testing.T) {
	f := independentViewDataset(t)
	filter := map[string]any{"sort": "AMOUNT_ASC", "categories": []string{"DINING", "HOME", "GROCERIES"}, "memberIds": []string{f.public("Membership", 301), f.public("Membership", 305)}}
	first := independentViewRead(t, f, 1, 1, "", filter, "", "ExpenseView")
	full := independentViewRead(t, f, 1, 100, "", filter, "", "ExpenseView")
	target := full["edges"].([]any)[3].(map[string]any)["node"].(map[string]any)["id"].(string)
	in := editInput(f)
	in.ExpenseID = target
	in.GroupID = f.public("Group", 202)
	in.PayerID = f.public("Membership", 305)
	in.ParticipantIDs = []string{f.public("Membership", 306)}
	in.Total = 50
	in.Category = "OTHER"
	if out := performEdit(t, f, 1, in); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	// Singular inputs, duplicates and reordered alternatives identify the same set.
	equivalent := map[string]any{"sort": "AMOUNT_ASC", "category": "HOME", "categories": []string{"GROCERIES", "DINING", "HOME"}, "memberId": f.public("Membership", 301), "memberIds": []string{f.public("Membership", 305), f.public("Membership", 301)}}
	continuation := independentViewRead(t, f, 1, 100, first["pageInfo"].(map[string]any)["endCursor"].(string), equivalent, "", "ExpenseView")
	if continuation["totalExpenseMinor"] != "1000" || continuation["expenseCount"] != "4" {
		t.Fatal(continuation)
	}
	edges := continuation["edges"].([]any)
	if len(edges) != 3 || edges[2].(map[string]any)["node"].(map[string]any)["totalMinor"] != "400" {
		t.Fatal("anchored amount moved after edit", continuation)
	}
	fresh := independentViewRead(t, f, 1, 100, "", filter, "", "ExpenseView")
	if fresh["expenseCount"] != "3" || fresh["totalExpenseMinor"] != "600" {
		t.Fatal("fresh filter retained edited category", fresh)
	}
}
