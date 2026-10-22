package banking

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

func syncTestBinding() SyncBinding {
	return SyncBinding{BindingID: "binding-private", Environment: "sandbox", ItemID: "item-private", AccountID: "account-selected"}
}

func syncTestCursor(t *testing.T, binding SyncBinding, value string) SyncCursor {
	t.Helper()
	cursor, err := NewSyncCursor(binding, value)
	if err != nil {
		t.Fatal("invalid synthetic cursor")
	}
	return cursor
}

func syncFixture(t *testing.T, name string) string {
	t.Helper()
	raw, err := os.ReadFile("testdata/" + name + ".json")
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

const syncIdentityFixture = `{"item":{"item_id":"item-private","error":null},"status":{"transactions":{"last_successful_update":"2026-10-20T12:00:00Z","last_failed_update":null}}}`
const syncEmptyFixture = `{"accounts":[],"added":[],"modified":[],"removed":[],"has_more":false,"next_cursor":"checkpoint-private"}`

func TestSyncFilteredPaginationPreservesFacts(t *testing.T) {
	binding := syncTestBinding()
	credential := Credential{raw: []byte("access-private")}
	cursors := []string{"", "filtered-page-one+/="}
	pageIndex, calls := 0, 0
	provider := testPlaid(t, bankingRoundTrip(func(request *http.Request) (*http.Response, error) {
		calls++
		if request.URL.Host != "sandbox.plaid.com" || request.URL.Scheme != "https" || request.Method != http.MethodPost || request.Header.Get("Plaid-Version") != "2020-09-14" || request.Header.Get("PLAID-SECRET") != "secret-private" {
			t.Error("incorrect official host, method, version or authentication")
		}
		deadline, ok := request.Context().Deadline()
		if !ok || time.Until(deadline) > 30*time.Second {
			t.Error("unbounded sync request")
		}
		var body map[string]json.RawMessage
		if json.NewDecoder(request.Body).Decode(&body) != nil || string(body["access_token"]) != `"access-private"` {
			t.Fatal("credential not preserved")
		}
		if request.URL.Path == "/item/get" {
			if len(body) != 1 {
				t.Error("unexpected identity request")
			}
			return plaidTestResponse(200, syncIdentityFixture), nil
		}
		if request.URL.Path != "/transactions/sync" || len(body) != 4 || string(body["count"]) != "20" {
			t.Fatal("unexpected sync request shape")
		}
		var cursor string
		_ = json.Unmarshal(body["cursor"], &cursor)
		var options map[string]string
		_ = json.Unmarshal(body["options"], &options)
		if cursor != cursors[pageIndex] || len(options) != 2 || options["account_id"] != binding.AccountID || options["personal_finance_category_version"] != "v2" {
			t.Error("selected account/cursor changed or history initialization repeated")
		}
		pageIndex++
		return plaidTestResponse(200, syncFixture(t, fmt.Sprintf("sync-page-%d", pageIndex))), nil
	}))
	initial := syncTestCursor(t, binding, "")
	first, err := provider.SyncTransactions(context.Background(), binding, credential, initial)
	if err != nil || !first.HasMore || len(first.Added) != 2 || first.NextCursor.Opaque() != cursors[1] {
		t.Fatal("first page contract failed", err)
	}
	if first.Added[0].AmountMinor != 1234 || !first.Added[0].Pending || first.Added[0].PendingTransactionID != nil || first.Added[0].AuthorizedDate == nil || *first.Added[0].AuthorizedDate != "2026-10-18" || first.Added[0].TransactionCode == nil || *first.Added[0].TransactionCode != "provider-future-code" || first.Added[0].MerchantName != nil {
		t.Error("pending fact or optional values changed")
	}
	if first.Added[1].AmountMinor != -29 || first.Added[1].TransactionCode != nil || first.Added[1].PendingTransactionID != nil {
		t.Error("credit was rounded or inferred to be a refund")
	}
	second, err := provider.SyncTransactions(context.Background(), binding, credential, first.NextCursor)
	if err != nil || second.HasMore || len(second.Added) != 1 || len(second.Modified) != 1 || len(second.Removed) != 1 || calls != 4 {
		t.Fatal("second page contract failed", err)
	}
	if *second.Added[0].PendingTransactionID != first.Added[0].TransactionID || second.Modified[0].TransactionID != first.Added[1].TransactionID || second.Modified[0].AmountMinor != -101 || *second.Modified[0].TransactionCode != "refund" || second.Removed[0].TransactionID != first.Added[0].TransactionID || second.Removed[0].AccountID != nil || second.Binding != binding {
		t.Error("explicit identity/linkage/modification/removal facts changed")
	}
	if second.Freshness.LastSuccessfulUpdate == nil || second.Freshness.LastSuccessfulUpdate.Format(time.RFC3339) != "2026-10-20T12:00:00Z" || second.Freshness.LastFailedUpdate != nil || *second.UpdateStatus != "HISTORICAL_UPDATE_COMPLETE" {
		t.Error("available freshness/status or unknown values changed")
	}
	if initial.Opaque() != "" || first.NextCursor.Opaque() != cursors[1] || string(credential.Bytes()) != "access-private" {
		t.Error("caller inputs mutated")
	}
}

func TestSyncExactUSDAmounts(t *testing.T) {
	for _, tc := range []struct {
		input string
		want  int64
		valid bool
	}{
		{"0", 0, true}, {"-0.00", 0, true}, {"0.29", 29, true}, {"-12.34", -1234, true},
		{"1.2300", 123, true}, {"123e-2", 123, true}, {"1E+2", 10000, true},
		{"92233720368547758.07", 9223372036854775807, true}, {"-92233720368547758.08", -9223372036854775808, true},
		{"92233720368547758.08", 0, false}, {"-92233720368547758.09", 0, false},
		{"0.001", 0, false}, {"-0.001", 0, false}, {"1e-3", 0, false},
		{`"12.34"`, 0, false}, {"null", 0, false}, {"NaN", 0, false}, {"1/2", 0, false},
		{"01", 0, false}, {"+1", 0, false}, {"1.", 0, false}, {"1e999999999999", 0, false}, {"1e1001", 0, false},
	} {
		t.Run(tc.input, func(t *testing.T) {
			got, valid := exactUSDMinor(json.RawMessage(tc.input))
			if valid != tc.valid || (valid && got != tc.want) {
				t.Errorf("exact conversion = %d, %t; want %d, %t", got, valid, tc.want, tc.valid)
			}
		})
	}
}

func TestSyncSupportedAccountFixturesKeepProviderDirection(t *testing.T) {
	binding := syncTestBinding()
	for _, account := range []struct{ kind, subtype string }{{"depository", "checking"}, {"depository", "savings"}, {"credit", "credit card"}} {
		t.Run(account.subtype, func(t *testing.T) {
			fixture := syncFixture(t, "sync-page-1")
			fixture = strings.Replace(fixture, `"type": "depository"`, `"type": "`+account.kind+`"`, 1)
			fixture = strings.Replace(fixture, `"subtype": "checking"`, `"subtype": "`+account.subtype+`"`, 1)
			page, err := decodeSyncPage([]byte(fixture), binding, syncTestCursor(t, binding, ""))
			if err != nil || page.Added[0].AmountMinor != 1234 || page.Added[1].AmountMinor != -29 {
				t.Fatal("account kind changed exact provider direction")
			}
		})
	}
}

func TestSyncRejectsInvalidFactsWithoutPage(t *testing.T) {
	binding := syncTestBinding()
	fixture := syncFixture(t, "sync-page-1")
	for _, tc := range []struct{ name, from, to string }{
		{"sibling transaction", `"account_id": "account-selected"`, `"account_id": "sibling-private"`},
		{"wrong currency", `"iso_currency_code": "USD"`, `"iso_currency_code": "EUR"`},
		{"unknown currency", `"iso_currency_code": "USD"`, `"iso_currency_code": null`},
		{"unofficial currency", `"unofficial_currency_code": null`, `"unofficial_currency_code": "BTC"`},
		{"fractional cents", `"amount": 12.34`, `"amount": 12.345`},
		{"amount string", `"amount": 12.34`, `"amount": "12.34"`},
		{"overflow", `"amount": 12.34`, `"amount": 92233720368547758.08`},
		{"invalid date", `"date": "2026-10-19"`, `"date": "2026-02-30"`},
		{"timestamp date", `"date": "2026-10-19"`, `"date": "2026-10-19T00:00:00Z"`},
		{"zero year", `"date": "2026-10-19"`, `"date": "0000-01-01"`},
		{"invalid authorized date", `"authorized_date": "2026-10-18"`, `"authorized_date": "2026-13-18"`},
		{"missing pending", `"pending": true,`, ``},
		{"empty explicit link", `"pending_transaction_id": null`, `"pending_transaction_id": ""`},
		{"empty transaction identity", `"transaction_id": "pending-purchase"`, `"transaction_id": ""`},
		{"missing pagination", `"has_more": true,`, ``},
		{"null changes", `"modified": []`, `"modified": null`},
		{"empty cursor with changes", `"next_cursor": "filtered-page-one+/="`, `"next_cursor": ""`},
		{"skip history cursor", `"next_cursor": "filtered-page-one+/="`, `"next_cursor": "now"`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Replace all account IDs only in this case to also test sibling metadata.
			raw := strings.ReplaceAll(fixture, tc.from, tc.to)
			page, err := decodeSyncPage([]byte(raw), binding, syncTestCursor(t, binding, ""))
			assertSyncFailure(t, page, err, SyncInvalidResponse)
		})
	}
	for _, raw := range []string{`{`, syncEmptyFixture + `{}`, strings.Replace(syncEmptyFixture, `"removed":[]`, `"removed":[{"transaction_id":"private","account_id":"sibling"}]`, 1), strings.Replace(syncEmptyFixture, `"next_cursor":"checkpoint-private"`, `"next_cursor":null`, 1)} {
		page, err := decodeSyncPage([]byte(raw), binding, syncTestCursor(t, binding, ""))
		assertSyncFailure(t, page, err, SyncInvalidResponse)
	}
}

func assertSyncFailure(t *testing.T, page SyncPage, err error, kind SyncErrorKind) {
	t.Helper()
	var failure *SyncError
	if !errors.As(err, &failure) || failure.Kind != kind || !reflect.DeepEqual(page, SyncPage{}) {
		t.Fatalf("failure contract: kind=%v pageZero=%t error=%v", failure, reflect.DeepEqual(page, SyncPage{}), err)
	}
	for _, secret := range []string{"secret-private", "access-private", "item-private", "account-selected", "checkpoint-private", "transport-private"} {
		if strings.Contains(fmt.Sprintf("%v %+v %#v", err, err, err), secret) {
			t.Fatal("failure leaked private content")
		}
	}
}

func TestSyncFailureKindsAndRetryGuidance(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		kind   SyncErrorKind
	}{
		{"mutation", 400, `{"error_code":"TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"}`, SyncPaginationMutation},
		{"not ready error", 400, `{"error_code":"PRODUCT_NOT_READY"}`, SyncNotReady},
		{"rate limit", 429, `{"error_message":"access-private"}`, SyncRateLimited},
		{"temporary", 503, `{"error_code":"ITEM_NOT_FOUND"}`, SyncTemporary},
		{"reconnect", 400, `{"error_code":"ITEM_LOGIN_REQUIRED"}`, SyncReconnect},
		{"permission", 400, `{"error_code":"ACCESS_NOT_GRANTED"}`, SyncReconnect},
		{"bad token", 400, `{"error_code":"INVALID_ACCESS_TOKEN"}`, SyncReconnect},
		{"limit requires attention", 400, `{"error_code":"TRANSACTIONS_SYNC_ITEM_LIMIT_EXCEEDED"}`, SyncRejected},
		{"unknown permanent", 400, `{"error_code":"unknown-private","error_message":"secret-private"}`, SyncRejected},
		{"malformed", 200, `{"access-private":`, SyncInvalidResponse},
		{"error in success", 200, strings.TrimSuffix(syncEmptyFixture, "}") + `,"error_code":"private"}`, SyncInvalidResponse},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			provider := testPlaid(t, bankingRoundTrip(func(request *http.Request) (*http.Response, error) {
				calls++
				if request.URL.Path == "/item/get" {
					return plaidTestResponse(200, syncIdentityFixture), nil
				}
				response := plaidTestResponse(tc.status, tc.body)
				response.Header.Set("Retry-After", "123")
				return response, nil
			}))
			binding := syncTestBinding()
			page, err := provider.SyncTransactions(context.Background(), binding, Credential{raw: []byte("access-private")}, syncTestCursor(t, binding, "checkpoint-private"))
			assertSyncFailure(t, page, err, tc.kind)
			if calls != 2 {
				t.Error("unexpected retry")
			}
			if tc.status != 200 && err.(*SyncError).RetryAfter != 123*time.Second {
				t.Error("lost minimum retry delay")
			}
		})
	}
}

func TestSyncScopeAndCredentialFailuresDoNotAdvance(t *testing.T) {
	binding := syncTestBinding()
	for _, tc := range []struct {
		name, identity string
	}{
		{"wrong item credential", strings.Replace(syncIdentityFixture, "item-private", "other-item", 1)},
		{"malformed freshness", strings.Replace(syncIdentityFixture, "2026-10-20T12:00:00Z", "yesterday", 1)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			provider := testPlaid(t, bankingRoundTrip(func(*http.Request) (*http.Response, error) {
				calls++
				return plaidTestResponse(200, tc.identity), nil
			}))
			page, err := provider.SyncTransactions(context.Background(), binding, Credential{raw: []byte("access-private")}, syncTestCursor(t, binding, ""))
			assertSyncFailure(t, page, err, SyncInvalidResponse)
			if calls != 1 {
				t.Error("sync reached provider after identity mismatch")
			}
		})
	}
	calls := 0
	provider := testPlaid(t, bankingRoundTrip(func(*http.Request) (*http.Response, error) { calls++; return nil, errors.New("must not call") }))
	for _, field := range []string{"environment", "account", "item", "binding", "zero cursor", "credential"} {
		changed := binding
		credential := Credential{raw: []byte("access-private")}
		cursor := syncTestCursor(t, binding, "checkpoint-private")
		switch field {
		case "environment":
			changed.Environment = "production"
		case "account":
			changed.AccountID = "sibling"
		case "item":
			changed.ItemID = "sibling"
		case "binding":
			changed.BindingID = "other-binding"
		case "zero cursor":
			cursor = SyncCursor{}
		case "credential":
			credential = Credential{}
		}
		page, err := provider.SyncTransactions(context.Background(), changed, credential, cursor)
		assertSyncFailure(t, page, err, SyncInvalidRequest)
	}
	if calls != 0 {
		t.Error("invalid request reached transport")
	}
}

func TestSyncNotReadyUnknownStatusAndRemovalScope(t *testing.T) {
	binding := syncTestBinding()
	initial := syncTestCursor(t, binding, "")
	empty := strings.Replace(syncEmptyFixture, "checkpoint-private", "", 1)
	page, err := decodeSyncPage([]byte(empty), binding, initial)
	assertSyncFailure(t, page, err, SyncNotReady)
	page, err = decodeSyncPage([]byte(empty), binding, syncTestCursor(t, binding, "saved"))
	assertSyncFailure(t, page, err, SyncInvalidResponse)
	for _, status := range []string{"null", `"TRANSACTIONS_UPDATE_STATUS_UNKNOWN"`, `"PROVIDER_FUTURE_STATUS"`} {
		raw := strings.TrimSuffix(syncEmptyFixture, "}") + `,"transactions_update_status":` + status + `}`
		page, err = decodeSyncPage([]byte(raw), binding, initial)
		if err != nil || (status == "null" && page.UpdateStatus != nil) || (status != "null" && (page.UpdateStatus == nil || `"`+*page.UpdateStatus+`"` != status)) {
			t.Fatal("optional/unknown status lost", err)
		}
	}
	for _, account := range []string{"", `,"account_id":"account-selected"`} {
		raw := strings.Replace(syncEmptyFixture, `"removed":[]`, `"removed":[{"transaction_id":"removed-private"`+account+`}]`, 1)
		page, err = decodeSyncPage([]byte(raw), binding, initial)
		if err != nil || len(page.Removed) != 1 || page.Binding != binding || (account == "" && page.Removed[0].AccountID != nil) {
			t.Fatal("valid scoped removal rejected", err)
		}
	}
}

func TestSyncRejectsSiblingRowsDuplicateIDsAndPaginationLoops(t *testing.T) {
	binding := syncTestBinding()
	cursor := syncTestCursor(t, binding, "")
	fixture := syncFixture(t, "sync-page-1")
	// Keep account metadata in scope so the transaction check itself must reject.
	siblingRow := strings.Replace(fixture, `"account_id": "account-selected",`+"\n"+`      "transaction_id"`, `"account_id": "sibling",`+"\n"+`      "transaction_id"`, 1)
	if siblingRow == fixture {
		t.Fatal("sibling fixture was not changed")
	}
	duplicate := strings.Replace(fixture, "separate-credit", "pending-purchase", 1)
	loop := strings.Replace(fixture, "filtered-page-one+/=", "saved", 1)
	for _, raw := range []string{siblingRow, duplicate} {
		page, err := decodeSyncPage([]byte(raw), binding, cursor)
		assertSyncFailure(t, page, err, SyncInvalidResponse)
	}
	page, err := decodeSyncPage([]byte(loop), binding, syncTestCursor(t, binding, "saved"))
	assertSyncFailure(t, page, err, SyncInvalidResponse)
	for _, value := range []string{"now", strings.Repeat("x", 257)} {
		if _, err := NewSyncCursor(binding, value); err == nil {
			t.Error("invalid checkpoint accepted")
		}
	}
}

func TestSyncItemErrorAndMissingFreshness(t *testing.T) {
	binding := syncTestBinding()
	for _, tc := range []struct {
		identity string
		kind     SyncErrorKind
	}{
		{`{"item":{"item_id":"item-private","error":{"error_code":"ITEM_LOGIN_REQUIRED","error_message":"access-private"}}}`, SyncReconnect},
		{`{"item":{"item_id":"item-private","error":{"error_code":"unknown-private"}}}`, SyncRejected},
	} {
		provider := testPlaid(t, bankingRoundTrip(func(*http.Request) (*http.Response, error) { return plaidTestResponse(200, tc.identity), nil }))
		page, err := provider.SyncTransactions(context.Background(), binding, Credential{raw: []byte("access-private")}, syncTestCursor(t, binding, ""))
		assertSyncFailure(t, page, err, tc.kind)
	}
	provider := testPlaid(t, bankingRoundTrip(func(request *http.Request) (*http.Response, error) {
		if request.URL.Path == "/item/get" {
			return plaidTestResponse(200, `{"item":{"item_id":"item-private","error":null},"status":null}`), nil
		}
		return plaidTestResponse(200, syncEmptyFixture), nil
	}))
	page, err := provider.SyncTransactions(context.Background(), binding, Credential{raw: []byte("access-private")}, syncTestCursor(t, binding, ""))
	if err != nil || page.UpdateStatus != nil || page.Freshness.LastSuccessfulUpdate != nil || page.Freshness.LastFailedUpdate != nil {
		t.Fatal("missing provider freshness was invented or rejected")
	}
}

func TestSyncTransportProtectionAndRedaction(t *testing.T) {
	for _, mode := range []string{"transport", "timeout", "oversized", "truncated", "redirect"} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			provider := testPlaid(t, bankingRoundTrip(func(request *http.Request) (*http.Response, error) {
				calls++
				if request.URL.Path == "/item/get" {
					return plaidTestResponse(200, syncIdentityFixture), nil
				}
				switch mode {
				case "transport":
					return nil, errors.New("transport-private access-private")
				case "timeout":
					return nil, context.DeadlineExceeded
				case "oversized":
					return plaidTestResponse(200, strings.Repeat("x", 64*1024+1)), nil
				case "truncated":
					return &http.Response{StatusCode: 200, Header: make(http.Header), Body: &syncBrokenBody{}}, nil
				default:
					response := plaidTestResponse(302, "")
					response.Header.Set("Location", "https://attacker.invalid")
					return response, nil
				}
			}))
			binding := syncTestBinding()
			page, err := provider.SyncTransactions(context.Background(), binding, Credential{raw: []byte("access-private")}, syncTestCursor(t, binding, ""))
			kind := SyncTemporary
			if mode == "redirect" {
				kind = SyncRejected
			}
			assertSyncFailure(t, page, err, kind)
			if calls != 2 {
				t.Error("redirect followed or request retried")
			}
		})
	}
	for _, value := range []any{syncTestBinding(), syncTestCursor(t, syncTestBinding(), "checkpoint-private"), SyncTransaction{TransactionID: "transaction-private", Name: new("name-private")}, SyncRemoval{TransactionID: "transaction-private"}, SyncFreshness{LastSuccessfulUpdate: new(time.Now())}, SyncPage{Binding: syncTestBinding()}} {
		formatted := fmt.Sprintf("%v %+v %#v", value, value, value)
		if strings.Contains(formatted, "private") || strings.Contains(formatted, "account-selected") || !strings.Contains(formatted, "redacted") {
			t.Fatal("sync diagnostics leaked payload")
		}
	}
}

func TestSyncUnreadableResponseUsesOnlyReceivedStatus(t *testing.T) {
	binding := syncTestBinding()
	for _, failingPath := range []string{"/item/get", "/transactions/sync"} {
		for _, tc := range []struct {
			status int
			kind   SyncErrorKind
		}{{http.StatusOK, SyncTemporary}, {http.StatusBadRequest, SyncRejected}, {http.StatusServiceUnavailable, SyncTemporary}} {
			t.Run(fmt.Sprintf("%s/%d", failingPath, tc.status), func(t *testing.T) {
				provider := testPlaid(t, bankingRoundTrip(func(request *http.Request) (*http.Response, error) {
					if request.URL.Path != failingPath {
						return plaidTestResponse(200, syncIdentityFixture), nil
					}
					// Even a complete JSON prefix cannot establish a reconnect
					// outcome when the response body was not successfully read.
					body := io.MultiReader(strings.NewReader(`{"error_code":"ITEM_LOGIN_REQUIRED","error_message":"access-private"}`), &syncBrokenBody{})
					response := &http.Response{StatusCode: tc.status, Header: make(http.Header), Body: io.NopCloser(body)}
					response.Header.Set("Retry-After", "123")
					return response, nil
				}))
				page, err := provider.SyncTransactions(context.Background(), binding, Credential{raw: []byte("access-private")}, syncTestCursor(t, binding, "saved"))
				assertSyncFailure(t, page, err, tc.kind)
				if err.(*SyncError).RetryAfter != 123*time.Second {
					t.Fatal("minimum retry guidance lost after body failure")
				}
			})
		}
	}
}

type syncBrokenBody struct{}

func (*syncBrokenBody) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }
func (*syncBrokenBody) Close() error             { return nil }
