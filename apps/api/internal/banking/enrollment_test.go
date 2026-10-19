package banking

import "testing"

func TestExplicitEligibleSelection(t *testing.T) {
	inventory := AccountInventory{ItemID: "item", InstitutionID: "institution", CountryCode: "US", Accounts: []ProviderAccount{
		{ID: "checking", Type: "depository", Subtype: "checking", Currency: "USD"},
		{ID: "savings", Type: "depository", Subtype: "savings", Currency: "USD"},
		{ID: "card", Type: "credit", Subtype: "credit card", Currency: "USD"},
		{ID: "loan", Type: "loan", Subtype: "mortgage", Currency: "USD"},
		{ID: "foreign", Type: "depository", Subtype: "checking", Currency: "CAD"},
	}}
	for _, id := range []string{"checking", "savings", "card"} {
		selected, ok := selectAccounts(inventory, []string{id})
		if !ok || len(selected) != 1 || selected[0].ID != id {
			t.Fatalf("eligible %s rejected", id)
		}
	}
	for _, ids := range [][]string{nil, {"loan"}, {"foreign"}, {"unknown"}, {"checking", "checking"}, {"checking", "loan"}} {
		if _, ok := selectAccounts(inventory, ids); ok {
			t.Fatalf("invalid explicit selection accepted: %v", ids)
		}
	}
	inventory.CountryCode = "CA"
	if _, ok := selectAccounts(inventory, []string{"checking"}); ok {
		t.Fatal("non-US admitted")
	}
}
