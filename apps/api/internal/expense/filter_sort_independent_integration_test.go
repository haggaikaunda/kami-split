//go:build integration

package expense_test

import (
	"reflect"
	"testing"
)

func TestIndependentArrayFiltersReauthorizeEveryContinuation(t *testing.T) {
	for _, field := range []string{"memberIds", "paidByIds"} {
		t.Run(field, func(t *testing.T) {
			f := independentViewDataset(t)
			filter := map[string]any{field: []string{f.public("Membership", 301), f.public("Membership", 305)}, "sort": "AMOUNT_ASC"}
			first := independentViewRead(t, f, 1, 1, "", filter, "", "ExpenseView")
			cursor := first["pageInfo"].(map[string]any)["endCursor"].(string)
			// Losing common-source eligibility must reject the complete selection,
			// rather than silently keeping its still-authorized Household alternative.
			injectHistoricalDeparture(t, f, f.id(306))
			for _, after := range []string{"", cursor, "malformed.cursor"} {
				got := independentViewRead(t, f, 1, 1, after, filter, "", "Problem")
				if got["code"] != "NOT_FOUND" {
					t.Fatalf("selected source no longer shared: %v", got)
				}
			}
			// Removing the inaccessible selection still cannot reuse its old binding.
			remaining := map[string]any{field: []string{f.public("Membership", 301)}, "sort": "AMOUNT_ASC"}
			got := independentViewRead(t, f, 1, 1, cursor, remaining, "", "Problem")
			if got["code"] != "INVALID_CURSOR" {
				t.Fatalf("changed array reused cursor: %v", got)
			}
			independentViewRead(t, f, 1, 1, "", remaining, "", "ExpenseView")
		})
	}
}

func TestIndependentGroupAmountTraversalAndFilterBinding(t *testing.T) {
	f := independentViewDataset(t)
	for _, order := range []string{"AMOUNT_ASC", "AMOUNT_DESC"} {
		t.Run(order, func(t *testing.T) {
			filter := map[string]any{"categories": []string{"DINING", "GROCERIES"}, "paidByIds": []string{f.public("Membership", 301), f.public("Membership", 302)}, "memberIds": []string{f.public("Membership", 301)}, "sort": order}
			group := f.public("Group", 201)
			amounts := []string{}
			after := ""
			for page := 0; page < 3; page++ {
				got := independentViewRead(t, f, 1, 1, after, filter, group, "ExpenseView")
				if got["totalExpenseMinor"] != "500" || got["expenseCount"] != "2" {
					t.Fatalf("group full summary: %v", got)
				}
				for _, edge := range got["edges"].([]any) {
					amounts = append(amounts, edge.(map[string]any)["node"].(map[string]any)["totalMinor"].(string))
				}
				info := got["pageInfo"].(map[string]any)
				if !info["hasNextPage"].(bool) {
					break
				}
				after = info["endCursor"].(string)
			}
			want := []string{"200", "300"}
			if order == "AMOUNT_DESC" {
				want = []string{"300", "200"}
			}
			if !reflect.DeepEqual(amounts, want) {
				t.Fatalf("group order got %v want %v", amounts, want)
			}
			changed := map[string]any{"categories": []string{"DINING"}, "paidByIds": filter["paidByIds"], "memberIds": filter["memberIds"], "sort": order}
			got := independentViewRead(t, f, 1, 1, after, changed, group, "Problem")
			if got["code"] != "INVALID_CURSOR" {
				t.Fatalf("changed categories reused cursor: %v", got)
			}
		})
	}
}
