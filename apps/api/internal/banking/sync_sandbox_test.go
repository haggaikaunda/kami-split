package banking

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"
)

// This opt-in check creates only synthetic Sandbox data, never a live Link or
// refresh. Output is deliberately limited to stages, counts and allowlisted facts.
func TestSyncSandboxContract(t *testing.T) {
	if os.Getenv("PLAID_SYNC_SANDBOX_CHECK") != "1" {
		t.Skip("opt-in Sandbox contract check disabled")
	}
	clientID, secret := os.Getenv("PLAID_CLIENT_ID"), os.Getenv("PLAID_SANDBOX_SECRET")
	if clientID == "" || secret == "" {
		t.Fatal("Sandbox client ID and Sandbox secret are required")
	}
	provider, err := NewPlaidProvider(PlaidConfig{Environment: "sandbox", ClientID: clientID, Secret: secret}, nil)
	if err != nil {
		t.Fatal("Sandbox configuration rejected")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	var created struct {
		PublicToken string `json:"public_token"`
	}
	err = provider.enrollmentPost(ctx, "/sandbox/public_token/create", map[string]any{
		"institution_id": "ins_109508", "initial_products": []string{"transactions"},
		"options": map[string]any{"transactions": map[string]int{"days_requested": 365}},
	}, &created, true)
	if err != nil || created.PublicToken == "" {
		t.Fatal("Sandbox synthetic Item creation unavailable; inspect owned Sandbox inventory for an uncertain effect")
	}
	var exchanged struct {
		ItemID      string `json:"item_id"`
		AccessToken string `json:"access_token"`
	}
	err = provider.enrollmentPost(ctx, "/item/public_token/exchange", map[string]string{"public_token": created.PublicToken}, &exchanged, true)
	if err != nil || !validProviderID(exchanged.ItemID) || exchanged.AccessToken == "" {
		t.Fatal("Sandbox single exchange unavailable; inspect owned Sandbox inventory for an uncertain effect, do not replay exchange")
	}
	credential := Credential{raw: []byte(exchanged.AccessToken)}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		removed, removalErr := provider.Remove(cleanupCtx, "sandbox", credential)
		if removalErr != nil || !removed.Confirmed {
			t.Error("owned synthetic Sandbox Item cleanup unconfirmed; operator must reconcile Sandbox inventory")
			return
		}
		t.Log("owned synthetic Sandbox Item removal confirmed")
	})
	var inventory struct {
		Item struct {
			ID string `json:"item_id"`
		} `json:"item"`
		Accounts []struct {
			Type, Subtype string
			AccountID     string `json:"account_id"`
			Balances      struct {
				Currency string `json:"iso_currency_code"`
			} `json:"balances"`
		} `json:"accounts"`
	}
	err = provider.enrollmentPost(ctx, "/accounts/get", map[string]string{"access_token": exchanged.AccessToken}, &inventory, false)
	if err != nil || inventory.Item.ID != exchanged.ItemID {
		t.Fatal("Sandbox owned Item inventory unavailable")
	}
	// Select one synthetic account of each supported kind explicitly. Never use
	// an Item-wide checkpoint or infer selection from returned transaction rows.
	selected := make(map[string]SyncBinding)
	for _, account := range inventory.Accounts {
		eligible := (account.Type == "depository" && (account.Subtype == "checking" || account.Subtype == "savings")) || (account.Type == "credit" && account.Subtype == "credit card")
		if !eligible || account.Balances.Currency != "USD" || !validProviderID(account.AccountID) {
			continue
		}
		if _, exists := selected[account.Subtype]; !exists {
			selected[account.Subtype] = SyncBinding{BindingID: "synthetic-" + account.Subtype, Environment: "sandbox", ItemID: exchanged.ItemID, AccountID: account.AccountID}
		}
	}
	if len(selected) == 0 {
		t.Fatal("Sandbox supplied no supported synthetic account")
	}
	var lastBinding SyncBinding
	for _, kind := range []string{"checking", "savings", "credit card"} {
		binding, available := selected[kind]
		if !available {
			t.Logf("synthetic %s stream unavailable; capability unobserved", kind)
			continue
		}
		lastBinding = binding
		cursor := syncTestCursor(t, binding, "")
		pages, facts, notReady := 0, 0, 0
		for pages < 100 {
			page, syncErr := provider.SyncTransactions(ctx, binding, credential, cursor)
			if syncErr != nil {
				var failure *SyncError
				if errors.As(syncErr, &failure) && failure.Kind == SyncNotReady && notReady < 5 {
					notReady++
					wait := max(2*time.Second, failure.RetryAfter)
					timer := time.NewTimer(wait)
					select {
					case <-ctx.Done():
						timer.Stop()
						t.Fatal("Sandbox readiness deadline elapsed")
					case <-timer.C:
					}
					continue
				}
				t.Fatal("Sandbox sync unavailable; no checkpoint accepted")
			}
			pages++
			facts += len(page.Added) + len(page.Modified) + len(page.Removed)
			cursor = page.NextCursor
			if !page.HasMore {
				// Observe continuation using the exact account-filtered cursor.
				continued, continuationErr := provider.SyncTransactions(ctx, binding, credential, cursor)
				if continuationErr != nil || continued.Binding != binding || continued.NextCursor.Opaque() == "" {
					t.Fatal("Sandbox saved account-filtered cursor continuation unavailable")
				}
				t.Logf("synthetic %s stream: pages=%d changes=%d status_supplied=%t freshness_supplied=%t not_ready_observed=%t", kind, pages, facts, page.UpdateStatus != nil, page.Freshness.LastSuccessfulUpdate != nil, notReady > 0)
				break
			}
		}
		if pages >= 100 || facts == 0 {
			t.Fatal("Sandbox complete nonempty synthetic stream not observed within page budget")
		}
	}
	// Reset only this test-owned Item after all stream observations. The documented
	// Sandbox endpoint produces ITEM_LOGIN_REQUIRED, without a live repair or Link.
	var reset struct {
		Reset bool `json:"reset_login"`
	}
	err = provider.enrollmentPost(ctx, "/sandbox/item/reset_login", map[string]string{"access_token": exchanged.AccessToken}, &reset, true)
	if err != nil || !reset.Reset {
		t.Fatal("Sandbox owned Item login-reset contract unavailable")
	}
	page, err := provider.SyncTransactions(ctx, lastBinding, credential, syncTestCursor(t, lastBinding, ""))
	assertSyncFailure(t, page, err, SyncReconnect)
	t.Log("owned synthetic Sandbox reconnect outcome observed; mutation, rate limit and institution failures remain fixture-only")
}
