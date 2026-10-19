package banking

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"
)

func enrollmentPlaid(t *testing.T, transport http.RoundTripper) *PlaidProvider {
	t.Helper()
	p, err := NewPlaidProvider(PlaidConfig{Environment: "sandbox", ClientID: "client-private", Secret: "secret-private", UserScopedDiscovery: true, UserScopedRemoval: true}, &http.Client{Transport: transport})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func enrollmentRequest(t *testing.T, r *http.Request) map[string]any {
	t.Helper()
	if r.Method != http.MethodPost || r.URL.Scheme != "https" || r.URL.Host != "sandbox.plaid.com" || r.Header.Get("PLAID-CLIENT-ID") != "client-private" || r.Header.Get("PLAID-SECRET") != "secret-private" || r.Header.Get("Plaid-Version") != "2020-09-14" {
		t.Fatal("invalid official provider request boundary")
	}
	deadline, ok := r.Context().Deadline()
	if !ok || time.Until(deadline) > 30*time.Second {
		t.Fatal("unbounded provider request")
	}
	var request map[string]any
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		t.Fatal(err)
	}
	return request
}

func TestEnrollmentUserPersistsBeforeExactLinkPreparation(t *testing.T) {
	expiry := time.Now().UTC().Add(3 * time.Hour).Truncate(time.Second)
	calls := 0
	provider := enrollmentPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		request := enrollmentRequest(t, r)
		switch r.URL.Path {
		case "/user/create":
			if !reflect.DeepEqual(request, map[string]any{"client_user_id": "actor-environment"}) {
				t.Fatal("user creation accepted browser identity or unnecessary PII")
			}
			return plaidTestResponse(200, `{"user_id":"usr_actor","request_id":"id"}`), nil
		case "/link/token/create":
			want := map[string]any{
				"user":    map[string]any{"client_user_id": "actor-environment"},
				"user_id": "usr_actor", "client_name": "Kami Split", "language": "en",
				"products": []any{"transactions"}, "country_codes": []any{"US"},
				"transactions": map[string]any{"days_requested": float64(365)},
				"webhook":      "https://app.example/banking/webhook/attempt-1", "enable_multi_item_link": false,
				"account_filters": map[string]any{
					"depository": map[string]any{"account_subtypes": []any{"checking", "savings"}},
					"credit":     map[string]any{"account_subtypes": []any{"credit card"}},
				},
			}
			if !reflect.DeepEqual(request, want) {
				t.Fatal("Link preparation did not freeze identity, US filters, 365-day request and exact correlation")
			}
			return plaidTestResponse(200, fmt.Sprintf(`{"link_token":"link-private","expiration":%q}`, expiry.Format(time.RFC3339))), nil
		default:
			t.Fatal("unexpected external operation")
			return nil, errors.New("unexpected operation")
		}
	}))
	input := EnrollmentPreparation{Environment: "sandbox", ClientUserID: "actor-environment", WebhookURL: "https://app.example/banking/webhook/attempt-1"}
	if _, err := provider.Prepare(context.Background(), input); err == nil || calls != 0 {
		t.Fatal("Link created before user was persisted")
	}
	for range 2 {
		userID, err := provider.EnsureUser(context.Background(), "sandbox", input.ClientUserID)
		if err != nil || userID != "usr_actor" {
			t.Fatal("stable actor user was not recoverable")
		}
		input.UserID = userID
	}
	prepared, err := provider.Prepare(context.Background(), input)
	if err != nil || calls != 3 || prepared.UserID != input.UserID || prepared.LinkToken != "link-private" || !prepared.ExpiresAt.Equal(expiry) {
		t.Fatal("provider Link handoff or actual expiration was lost")
	}
}

func TestEnrollmentCapabilityEnvironmentAndInputGates(t *testing.T) {
	calls := 0
	provider := enrollmentPlaid(t, bankingRoundTrip(func(*http.Request) (*http.Response, error) {
		calls++
		return nil, errors.New("unexpected external operation")
	}))
	correlation := EnrollmentCorrelation{"usr_actor", "actor-environment", "https://app.example/hook/attempt"}
	for _, capabilities := range []EnrollmentCapabilities{{}, {UserScopedDiscovery: true}, {UserScopedRemoval: true}} {
		provider.config.UserScopedDiscovery = capabilities.UserScopedDiscovery
		provider.config.UserScopedRemoval = capabilities.UserScopedRemoval
		if got := provider.EnrollmentCapabilities(); got != capabilities {
			t.Fatal("configured capabilities misrepresented")
		}
		if _, err := provider.EnsureUser(context.Background(), "sandbox", "actor-environment"); err == nil {
			t.Fatal("user creation bypassed verified cleanup gates")
		}
		if _, err := provider.Prepare(context.Background(), EnrollmentPreparation{"sandbox", "actor-environment", "usr_actor", correlation.WebhookURL}); err == nil {
			t.Fatal("Link bypassed verified cleanup gates")
		}
		if _, err := provider.Exchange(context.Background(), "sandbox", NewPublicToken([]byte("public-private"))); err == nil {
			t.Fatal("exchange bypassed verified cleanup gates")
		}
		if _, err := provider.RemoveDiscovered(context.Background(), "sandbox", correlation, "target"); err == nil {
			t.Fatal("removal bypassed capability gate")
		}
	}
	provider.config.UserScopedDiscovery, provider.config.UserScopedRemoval = true, true
	for _, env := range []string{"production", "unknown", ""} {
		_, userErr := provider.EnsureUser(context.Background(), env, "actor-environment")
		_, linkErr := provider.Prepare(context.Background(), EnrollmentPreparation{env, "actor-environment", "usr_actor", correlation.WebhookURL})
		_, exchangeErr := provider.Exchange(context.Background(), env, NewPublicToken([]byte("public-private")))
		_, accountsErr := provider.Accounts(context.Background(), env, Credential{raw: []byte("access-private")})
		_, discoverErr := provider.Discover(context.Background(), env, correlation)
		_, removeErr := provider.RemoveDiscovered(context.Background(), env, correlation, "target")
		if userErr == nil || linkErr == nil || exchangeErr == nil || accountsErr == nil || discoverErr == nil || removeErr == nil {
			t.Fatal("environment mismatch reached provider")
		}
	}
	for _, webhook := range []string{"http://app.example/hook", "https://user:secret@app.example/hook", "https://app.example/hook#fragment", ""} {
		if _, err := provider.Prepare(context.Background(), EnrollmentPreparation{"sandbox", "actor-environment", "usr_actor", webhook}); err == nil {
			t.Fatal("invalid webhook reached provider")
		}
	}
	if _, err := provider.Exchange(context.Background(), "sandbox", PublicToken{}); err == nil {
		t.Fatal("empty public token reached provider")
	}
	if _, err := provider.Accounts(context.Background(), "sandbox", Credential{}); err == nil {
		t.Fatal("empty access token reached provider")
	}
	if calls != 0 {
		t.Fatal("disabled, mismatched or invalid enrollment made an external call")
	}
}

func TestEnrollmentExchangeSingleExecutionAndSafeFailure(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
		failure    error
		uncertain  bool
	}{
		{name: "lost response after remote effect", failure: errors.New("public-private access-private secret-private"), uncertain: true},
		{name: "timeout", failure: context.DeadlineExceeded, uncertain: true},
		{name: "server error", status: 503, body: `{}`, uncertain: true},
		{name: "rate limit", status: 429, body: `{}`},
		{name: "invalid public token", status: 400, body: `{"error_code":"INVALID_PUBLIC_TOKEN","error_message":"private"}`},
		{name: "malformed", status: 200, body: `private`, uncertain: true},
		{name: "missing item", status: 200, body: `{"access_token":"access-private"}`, uncertain: true},
		{name: "missing credential", status: 200, body: `{"item_id":"item-private"}`, uncertain: true},
		{name: "top level error", status: 200, body: `{"item_id":"item-private","access_token":"access-private","error_code":"ERROR"}`, uncertain: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			provider := enrollmentPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
				calls++
				request := enrollmentRequest(t, r)
				if r.URL.Path != "/item/public_token/exchange" || !reflect.DeepEqual(request, map[string]any{"public_token": "public-private"}) {
					t.Fatal("incorrect one-use exchange boundary")
				}
				if tc.failure != nil {
					return nil, tc.failure
				}
				return plaidTestResponse(tc.status, tc.body), nil
			}))
			result, err := provider.Exchange(context.Background(), "sandbox", NewPublicToken([]byte("public-private")))
			var failure *EnrollmentError
			if !errors.As(err, &failure) || failure.Uncertain != tc.uncertain || failure.Retryable || calls != 1 || result.ItemID != "" || len(result.AccessToken.Bytes()) != 0 {
				t.Fatal("one-use exchange retried, returned partial state or misclassified uncertainty")
			}
			if strings.Contains(fmt.Sprintf("%v %+v %#v", err, err, err), "private") {
				t.Fatal("error disclosed protected provider data")
			}
		})
	}
	provider := enrollmentPlaid(t, bankingRoundTrip(func(*http.Request) (*http.Response, error) {
		return plaidTestResponse(200, `{"item_id":"item-private","access_token":"access-private"}`), nil
	}))
	result, err := provider.Exchange(context.Background(), "sandbox", NewPublicToken([]byte("public-private")))
	if err != nil || result.ItemID != "item-private" || string(result.AccessToken.Bytes()) != "access-private" {
		t.Fatal("successful exchange lost protected identity or credential")
	}
}

func TestEnrollmentInventoryUsesServerEvidenceWithoutContinuityGuesses(t *testing.T) {
	calls := 0
	provider := enrollmentPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		request := enrollmentRequest(t, r)
		switch r.URL.Path {
		case "/accounts/get":
			if !reflect.DeepEqual(request, map[string]any{"access_token": "access-private"}) {
				t.Fatal("inventory did not use protected credential")
			}
			return plaidTestResponse(200, `{"item":{"item_id":"item-private","institution_id":"ins_private"},"accounts":[{"account_id":"checking","name":"private bank name","type":"depository","subtype":"checking","persistent_account_id":"exact-stable-id","balances":{"iso_currency_code":"USD","current":123}},{"account_id":"credit","name":"private bank name","mask":"1234","type":"credit","subtype":"credit card","balances":{"iso_currency_code":"USD"}},{"account_id":"unsupported","type":"investment","subtype":"brokerage","balances":{"iso_currency_code":"EUR"}}]}`), nil
		case "/institutions/get_by_id":
			if !reflect.DeepEqual(request, map[string]any{"institution_id": "ins_private", "country_codes": []any{"US"}}) {
				t.Fatal("institution lookup changed identity")
			}
			return plaidTestResponse(200, `{"institution":{"institution_id":"ins_private","country_codes":["US"]}}`), nil
		default:
			t.Fatal("unexpected inventory endpoint")
			return nil, errors.New("unexpected")
		}
	}))
	result, err := provider.Accounts(context.Background(), "sandbox", Credential{raw: []byte("access-private")})
	if err != nil || calls != 2 || result.ItemID != "item-private" || result.CountryCode != "US" || len(result.Accounts) != 3 {
		t.Fatal("server inventory was not returned")
	}
	if result.Accounts[0].StableID != "exact-stable-id" || result.Accounts[1].StableID != "" || result.Accounts[2].Currency != "EUR" {
		t.Fatal("adapter guessed continuity or hid eligibility evidence from application selection")
	}
}

func TestEnrollmentDiscoveryAndRemovalKeepUnrelatedItems(t *testing.T) {
	correlation := EnrollmentCorrelation{"usr_actor", "actor-environment", "https://app.example/hook/attempt-1"}
	remaining := map[string]string{"target": correlation.WebhookURL, "healthy-sibling": "https://app.example/hook/other-attempt", "similar-prefix": correlation.WebhookURL + "0"}
	removals := 0
	loseResponse := true
	provider := enrollmentPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
		request := enrollmentRequest(t, r)
		switch r.URL.Path {
		case "/user/items/get":
			if !reflect.DeepEqual(request, map[string]any{"user_id": correlation.UserID}) {
				t.Fatal("discovery used wrong actor user")
			}
			items := make([]map[string]string, 0)
			for id, webhook := range remaining {
				items = append(items, map[string]string{"item_id": id, "webhook": webhook})
			}
			body, _ := json.Marshal(map[string]any{"items": items})
			return plaidTestResponse(200, string(body)), nil
		case "/user/items/remove":
			if !reflect.DeepEqual(request, map[string]any{"user_id": correlation.UserID, "item_ids": []any{"target"}}) {
				t.Fatal("removal broadened beyond exact correlated target")
			}
			removals++
			delete(remaining, "target")
			if loseResponse {
				return nil, errors.New("response lost after removal")
			}
			return plaidTestResponse(200, `{"request_id":"confirmed"}`), nil
		default:
			t.Fatal("unexpected endpoint, including forbidden broad product termination")
			return nil, errors.New("unexpected")
		}
	}))
	items, err := provider.Discover(context.Background(), "sandbox", correlation)
	if err != nil || !reflect.DeepEqual(items, []string{"target"}) {
		t.Fatal("discovery did not require exact attempt URL")
	}
	if result, err := provider.RemoveDiscovered(context.Background(), "sandbox", correlation, "healthy-sibling"); err == nil || result.Confirmed || removals != 0 {
		t.Fatal("unrelated same-user Item was removable")
	}
	result, err := provider.RemoveDiscovered(context.Background(), "sandbox", correlation, "target")
	var failure *RemovalError
	if !errors.As(err, &failure) || !failure.Uncertain || !failure.Retryable || result.Confirmed || removals != 1 {
		t.Fatal("lost removal response incorrectly confirmed")
	}
	result, err = provider.RemoveDiscovered(context.Background(), "sandbox", correlation, "target")
	if !errors.As(err, &failure) || !failure.Uncertain || failure.Retryable || result.Confirmed || removals != 1 {
		t.Fatal("absent rediscovery invented cleanup confirmation or replayed removal")
	}
	if len(remaining) != 2 || remaining["healthy-sibling"] == "" || remaining["similar-prefix"] == "" {
		t.Fatal("cleanup affected unrelated Items")
	}
	remaining["target"] = correlation.WebhookURL
	loseResponse = false
	result, err = provider.RemoveDiscovered(context.Background(), "sandbox", correlation, "target")
	if err != nil || !result.Confirmed || removals != 2 {
		t.Fatal("confirmed narrow removal was not accepted")
	}
	items, err = provider.Discover(context.Background(), "sandbox", correlation)
	if err != nil || len(items) != 0 {
		t.Fatal("empty discovery did not remain an observation")
	}
}

func TestEnrollmentMalformedResponsesNeverInventEvidence(t *testing.T) {
	for _, tc := range []struct {
		name, path, body string
	}{
		{"missing user", "/user/create", `{}`},
		{"legacy user", "/user/create", `{"user_id":"legacy-user","user_token":"private"}`},
		{"expired Link", "/link/token/create", `{"link_token":"private","expiration":"2000-01-01T00:00:00Z"}`},
		{"long Link", "/link/token/create", `{"link_token":"private","expiration":"2100-01-01T00:00:00Z"}`},
		{"missing items", "/user/items/get", `{}`},
		{"malformed items", "/user/items/get", `{"items":[{"webhook":"https://app.example/hook/attempt"}]}`},
		{"duplicate items", "/user/items/get", `{"items":[{"item_id":"same"},{"item_id":"same"}]}`},
		{"missing inventory", "/accounts/get", `{"item":{"item_id":"id","institution_id":"ins"}}`},
		{"duplicate accounts", "/accounts/get", `{"item":{"item_id":"id","institution_id":"ins"},"accounts":[{"account_id":"same"},{"account_id":"same"}]}`},
		{"wrong institution", "/institutions/get_by_id", `{"institution":{"institution_id":"wrong","country_codes":["US"]}}`},
		{"unsupported country", "/institutions/get_by_id", `{"institution":{"institution_id":"ins","country_codes":["CA"]}}`},
		{"ambiguous country", "/institutions/get_by_id", `{"institution":{"institution_id":"ins","country_codes":["US","CA"]}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			provider := enrollmentPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path == tc.path {
					return plaidTestResponse(200, tc.body), nil
				}
				if r.URL.Path == "/accounts/get" {
					return plaidTestResponse(200, `{"item":{"item_id":"id","institution_id":"ins"},"accounts":[]}`), nil
				}
				return plaidTestResponse(200, `{"institution":{"institution_id":"ins","country_codes":["US"]}}`), nil
			}))
			var err error
			switch tc.path {
			case "/user/create":
				_, err = provider.EnsureUser(context.Background(), "sandbox", "actor-environment")
			case "/link/token/create":
				_, err = provider.Prepare(context.Background(), EnrollmentPreparation{"sandbox", "actor-environment", "usr_actor", "https://app.example/hook/attempt"})
			case "/user/items/get":
				_, err = provider.Discover(context.Background(), "sandbox", EnrollmentCorrelation{"usr_actor", "actor-environment", "https://app.example/hook/attempt"})
			default:
				_, err = provider.Accounts(context.Background(), "sandbox", Credential{raw: []byte("access-private")})
			}
			if err == nil {
				t.Fatal("malformed or unsupported response became positive evidence")
			}
		})
	}
}

func TestEnrollmentProtectedOwnershipAndDiagnostics(t *testing.T) {
	raw := []byte("public-private")
	token := NewPublicToken(raw)
	raw[0] = 'X'
	copy := token.Bytes()
	copy[0] = 'Y'
	if string(token.Bytes()) != "public-private" {
		t.Fatal("public token did not own its bytes")
	}
	values := []any{token, EnrollmentPreparation{"sandbox", "actor-private", "usr_private", "https://private.example/hook"}, LinkPreparation{"usr_private", "link-private", time.Now()}, ExchangeResult{"item-private", Credential{raw: []byte("access-private")}}, ProviderAccount{ID: "account-private", Name: "bank-private"}, AccountInventory{ItemID: "item-private"}, EnrollmentCorrelation{"usr_private", "actor-private", "https://private.example/hook"}, &EnrollmentError{Uncertain: true, Retryable: true}}
	for _, value := range values {
		if strings.Contains(fmt.Sprintf("%v %+v %#v", value, value, value), "private") {
			t.Fatal("diagnostic disclosed private enrollment fields")
		}
	}
}

func TestEnrollmentRetryGuidanceAndReadFailures(t *testing.T) {
	for _, status := range []int{http.StatusTooManyRequests, http.StatusServiceUnavailable} {
		provider := enrollmentPlaid(t, bankingRoundTrip(func(*http.Request) (*http.Response, error) {
			response := plaidTestResponse(status, `{"error_message":"private"}`)
			response.Header.Set("Retry-After", "180")
			return response, nil
		}))
		correlation := EnrollmentCorrelation{"usr_actor", "actor-environment", "https://app.example/hook/attempt"}
		_, discoveryErr := provider.Discover(context.Background(), "sandbox", correlation)
		_, preparationErr := provider.Prepare(context.Background(), EnrollmentPreparation{"sandbox", "actor-environment", "usr_actor", correlation.WebhookURL})
		_, exchangeErr := provider.Exchange(context.Background(), "sandbox", NewPublicToken([]byte("public-private")))
		_, inventoryErr := provider.Accounts(context.Background(), "sandbox", Credential{raw: []byte("access-private")})
		for _, err := range []error{discoveryErr, preparationErr, exchangeErr, inventoryErr} {
			var failure *EnrollmentError
			if !errors.As(err, &failure) || failure.RetryAfter != 3*time.Minute {
				t.Fatal("provider minimum retry guidance lost")
			}
		}
		var discoveryFailure *EnrollmentError
		if !errors.As(discoveryErr, &discoveryFailure) || discoveryFailure.Uncertain || !discoveryFailure.Retryable {
			t.Fatal("read failure misclassified as an external effect")
		}
		result, err := provider.RemoveDiscovered(context.Background(), "sandbox", correlation, "target")
		var failure *RemovalError
		if !errors.As(err, &failure) || !failure.Retryable || result.Confirmed || result.RetryAfter != 3*time.Minute {
			t.Fatal("discovery retry minimum lost at cleanup boundary")
		}
	}
}

func TestEnrollmentRemovalRequiresUsableConfirmation(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
		uncertain  bool
		retryable  bool
	}{
		{"provider unavailable", `{}`, 503, true, true},
		{"rate limit", `{}`, 429, false, true},
		{"not associated is not confirmation", `{"error_code":"ITEM_NOT_FOUND"}`, 400, false, false},
		{"invalid body", `private`, 200, true, true},
		{"missing request ID", `{}`, 200, true, true},
		{"top-level error", `{"request_id":"id","error_code":"ERROR"}`, 200, true, true},
		{"explicit denial", `{"request_id":"id","removed":false}`, 200, true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			provider := enrollmentPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.URL.Path == "/user/items/get" {
					return plaidTestResponse(200, `{"items":[{"item_id":"target","webhook":"https://app.example/hook/attempt"}]}`), nil
				}
				response := plaidTestResponse(tc.status, tc.body)
				response.Header.Set("Retry-After", "120")
				return response, nil
			}))
			result, err := provider.RemoveDiscovered(context.Background(), "sandbox", EnrollmentCorrelation{"usr_actor", "actor-environment", "https://app.example/hook/attempt"}, "target")
			var failure *RemovalError
			if !errors.As(err, &failure) || result.Confirmed || failure.Uncertain != tc.uncertain || failure.Retryable != tc.retryable || calls != 2 || result.RetryAfter != 2*time.Minute {
				t.Fatal("failed cleanup invented confirmation, retried or lost provider guidance")
			}
		})
	}
}

func TestEnrollmentRedirectAndCancelledExchangeHaveOneAttempt(t *testing.T) {
	for _, cancelled := range []bool{false, true} {
		calls := 0
		provider := enrollmentPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
			calls++
			if cancelled {
				if !errors.Is(r.Context().Err(), context.Canceled) {
					t.Fatal("request cancellation lost")
				}
				return nil, r.Context().Err()
			}
			response := plaidTestResponse(302, "")
			response.Header.Set("Location", "https://attacker.invalid/exchange")
			return response, nil
		}))
		ctx, cancel := context.WithCancel(context.Background())
		if cancelled {
			cancel()
		}
		_, err := provider.Exchange(ctx, "sandbox", NewPublicToken([]byte("public-private")))
		cancel()
		var failure *EnrollmentError
		if !errors.As(err, &failure) || failure.Retryable || calls != 1 {
			t.Fatal("one-use exchange followed redirect, retried or ignored cancellation")
		}
	}
}
