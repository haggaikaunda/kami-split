package banking

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestSyncExplicitChangedAndAbsentLinkage(t *testing.T) {
	binding := syncTestBinding()
	// Identical descriptions, dates and amounts must not collapse distinct IDs.
	// A modified row's link is authoritative even when it changes or disappears.
	for _, link := range []string{`"new-pending-id"`, `null`} {
		raw := `{"accounts":[],"added":[{"transaction_id":"separate-credit","account_id":"account-selected","amount":-0.29,"iso_currency_code":"USD","date":"2026-10-19","pending":false,"name":"Same"}],"modified":[{"transaction_id":"existing-credit","account_id":"account-selected","amount":-0.29,"iso_currency_code":"USD","date":"2026-10-19","pending":false,"name":"Same","pending_transaction_id":` + link + `}],"removed":[{"transaction_id":"existing-credit"}],"next_cursor":"next","has_more":false}`
		page, err := decodeSyncPage([]byte(raw), binding, syncTestCursor(t, binding, "saved"))
		if err != nil || len(page.Added) != 1 || len(page.Modified) != 1 || len(page.Removed) != 1 {
			t.Fatal("explicit independent changes were lost", err)
		}
		modified := page.Modified[0]
		if page.Added[0].TransactionID != "separate-credit" || modified.TransactionID != "existing-credit" || modified.AmountMinor != -29 || modified.TransactionCode != nil || page.Removed[0].TransactionID != modified.TransactionID || page.Removed[0].AccountID != nil {
			t.Fatal("identities, credit meaning or scoped removal were inferred")
		}
		if link == "null" {
			if modified.PendingTransactionID != nil {
				t.Fatal("absent provider link was invented")
			}
		} else if modified.PendingTransactionID == nil || *modified.PendingTransactionID != "new-pending-id" {
			t.Fatal("changed explicit provider link was lost")
		}
	}
}

func TestSyncHTTPRejectsLateInvalidFactsAtomically(t *testing.T) {
	binding := syncTestBinding()
	// A valid added row precedes the malformed modified/removal facts. None of
	// that financial payload or the new checkpoint may escape on failure.
	fixture := syncFixture(t, "sync-page-2")
	for _, tc := range []struct{ name, from, to string }{
		{"modified sibling", "\"account_id\": \"account-selected\",\n      \"transaction_id\": \"separate-credit\"", "\"account_id\": \"sibling\",\n      \"transaction_id\": \"separate-credit\""},
		{"modified subcent", `"amount": -1.01`, `"amount": -1.011`},
		{"removed sibling", `"transaction_id": "pending-purchase"`, `"account_id":"sibling","transaction_id": "pending-purchase"`},
		{"removed empty identity", `"transaction_id": "pending-purchase"`, `"transaction_id": ""`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := strings.Replace(fixture, tc.from, tc.to, 1)
			if raw == fixture {
				t.Fatal("negative fixture did not change")
			}
			calls := 0
			provider := testPlaid(t, bankingRoundTrip(func(request *http.Request) (*http.Response, error) {
				calls++
				if request.URL.Path == "/item/get" {
					return plaidTestResponse(200, syncIdentityFixture), nil
				}
				return plaidTestResponse(200, raw), nil
			}))
			cursor := syncTestCursor(t, binding, "saved")
			page, err := provider.SyncTransactions(context.Background(), binding, Credential{raw: []byte("access-private")}, cursor)
			assertSyncFailure(t, page, err, SyncInvalidResponse)
			if calls != 2 || cursor.Opaque() != "saved" {
				t.Fatal("failure retried or changed input checkpoint")
			}
		})
	}
}

func TestSyncPageLimitAndIndependentResponseOwnership(t *testing.T) {
	binding := syncTestBinding()
	for _, count := range []int{20, 21} {
		rows := make([]string, count)
		for i := range rows {
			rows[i] = fmt.Sprintf(`{"transaction_id":"id-%d","account_id":"account-selected","amount":0,"iso_currency_code":"USD","date":"2024-02-29","pending":false,"merchant_name":"Merchant"}`, i)
		}
		raw := []byte(strings.Replace(syncEmptyFixture, `"added":[]`, `"added":[`+strings.Join(rows, ",")+`]`, 1))
		page, err := decodeSyncPage(raw, binding, syncTestCursor(t, binding, "saved"))
		if count == 21 {
			assertSyncFailure(t, page, err, SyncInvalidResponse)
			continue
		}
		if err != nil || len(page.Added) != count || page.Added[19].AmountMinor != 0 {
			t.Fatal("valid full zero-amount page rejected", err)
		}
		*page.Added[0].MerchantName = "caller edit"
		page.Added[0].TransactionID = "caller edit"
		again, err := decodeSyncPage(raw, binding, syncTestCursor(t, binding, "saved"))
		if err != nil || *again.Added[0].MerchantName != "Merchant" || again.Added[0].TransactionID != "id-0" || !json.Valid(raw) {
			t.Fatal("returned page mutation changed future provider facts")
		}
	}
}

func TestSyncBothCallsShareCallerDeadline(t *testing.T) {
	binding := syncTestBinding()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	wantDeadline, _ := ctx.Deadline()
	calls := 0
	provider := testPlaid(t, bankingRoundTrip(func(request *http.Request) (*http.Response, error) {
		calls++
		deadline, ok := request.Context().Deadline()
		if !ok || !deadline.Equal(wantDeadline) {
			t.Error("provider call reset or extended the caller deadline")
		}
		if request.URL.Path == "/item/get" {
			return plaidTestResponse(200, syncIdentityFixture), nil
		}
		<-request.Context().Done()
		return nil, fmt.Errorf("transport-private: %w", request.Context().Err())
	}))
	page, err := provider.SyncTransactions(ctx, binding, Credential{raw: []byte("access-private")}, syncTestCursor(t, binding, "saved"))
	assertSyncFailure(t, page, err, SyncTemporary)
	if calls != 2 {
		t.Fatal("unexpected request count")
	}
}

func TestSyncRateLimitStatusSurvivesUnreadableBody(t *testing.T) {
	binding := syncTestBinding()
	for _, failingPath := range []string{"/item/get", "/transactions/sync"} {
		t.Run(failingPath, func(t *testing.T) {
			provider := testPlaid(t, bankingRoundTrip(func(request *http.Request) (*http.Response, error) {
				if request.URL.Path != failingPath {
					return plaidTestResponse(200, syncIdentityFixture), nil
				}
				response := &http.Response{StatusCode: http.StatusTooManyRequests, Header: make(http.Header), Body: &syncBrokenBody{}}
				response.Header.Set("Retry-After", "123")
				return response, nil
			}))
			page, err := provider.SyncTransactions(context.Background(), binding, Credential{raw: []byte("access-private")}, syncTestCursor(t, binding, "saved"))
			if failure, ok := err.(*SyncError); ok {
				t.Logf("known HTTP 429: kind=%s retry_after=%s", failure.Kind, failure.RetryAfter)
			}
			assertSyncFailure(t, page, err, SyncRateLimited)
			if err.(*SyncError).RetryAfter != 123*time.Second {
				t.Fatal("known minimum rate-limit delay was lost")
			}
		})
	}
}
