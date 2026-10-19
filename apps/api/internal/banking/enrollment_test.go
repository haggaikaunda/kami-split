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

func TestEnrollmentOriginValidationAndNormalization(t *testing.T) {
	provider, _ := NewPlaidProvider(PlaidConfig{Environment: "sandbox", ClientID: "synthetic", Secret: "synthetic"}, nil)
	for _, origin := range []string{"", "http://api.example.invalid", "https://:443", "https://api.example.invalid/path", "https://user@api.example.invalid", "https://api.example.invalid?private=query", "https://api.example.invalid#fragment"} {
		if _, err := NewEnrollment(&Service{}, provider, EnrollmentConfig{Enabled: true, Environment: "sandbox", WebhookOrigin: origin}); err == nil {
			t.Fatalf("invalid origin accepted: %s", origin)
		}
	}
	service, err := NewEnrollment(&Service{}, provider, EnrollmentConfig{Enabled: true, Environment: "sandbox", WebhookOrigin: "https://api.example.invalid/"})
	if err != nil || service.config.WebhookOrigin != "https://api.example.invalid" {
		t.Fatal("origin not normalized")
	}
}
