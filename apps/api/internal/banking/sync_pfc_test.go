package banking

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestSyncPFCFactsRoundTrip(t *testing.T) {
	for _, tc := range []struct {
		name, category              string
		primary, detail, confidence *string
	}{
		{name: "missing"},
		{name: "null", category: `,"personal_finance_category":null`},
		{name: "partial", category: `,"personal_finance_category":{"primary":"FOOD_AND_DRINK"}`, primary: pfcString("FOOD_AND_DRINK")},
		{name: "v2", category: `,"personal_finance_category":{"primary":"FOOD_AND_DRINK","detailed":"FOOD_AND_DRINK_GROCERIES","confidence_level":"HIGH"}`, primary: pfcString("FOOD_AND_DRINK"), detail: pfcString("FOOD_AND_DRINK_GROCERIES"), confidence: pfcString("HIGH")},
		{name: "unknown taxonomy retained", category: `,"personal_finance_category":{"primary":"FUTURE_PRIMARY","detailed":"FUTURE_DETAIL","confidence_level":"FUTURE_CONFIDENCE"}`, primary: pfcString("FUTURE_PRIMARY"), detail: pfcString("FUTURE_DETAIL"), confidence: pfcString("FUTURE_CONFIDENCE")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			binding := syncTestBinding()
			from := syncTestCursor(t, binding, "")
			raw := `{"accounts":[],"added":[{"transaction_id":"pfc","account_id":"account-selected","amount":12.34,"iso_currency_code":"USD","date":"2026-10-01","pending":false,"transaction_code":"future-code"` + tc.category + `}],"modified":[],"removed":[],"has_more":false,"next_cursor":"next"}`
			page, err := decodeSyncPage([]byte(raw), binding, from)
			if err != nil {
				t.Fatal(err)
			}
			fact := page.Added[0]
			if !reflect.DeepEqual(fact.ProviderPrimaryCategory, tc.primary) || !reflect.DeepEqual(fact.ProviderCategory, tc.detail) || !reflect.DeepEqual(fact.ProviderConfidence, tc.confidence) || fact.TransactionCode == nil || *fact.TransactionCode != "future-code" {
				t.Fatal("provider facts lost or inferred")
			}
			payload, err := encodeSyncPage(SyncBatch{id: uuid.New(), binding: binding, cursor: from}, from, page)
			if err != nil {
				t.Fatal(err)
			}
			var saved syncStoredPage
			if err = json.Unmarshal(payload, &saved); err != nil {
				t.Fatal(err)
			}
			row := saved.Changes[0]
			if !reflect.DeepEqual(row.ProviderPrimaryCategory, tc.primary) || !reflect.DeepEqual(row.ProviderCategory, tc.detail) || !reflect.DeepEqual(row.ProviderConfidence, tc.confidence) {
				t.Fatal("staging discarded nullable taxonomy facts")
			}
		})
	}
}

func TestSyncPFCRejectsMalformedFacts(t *testing.T) {
	binding := syncTestBinding()
	for _, category := range []string{`true`, `[]`, `{"primary":12}`, `{"detailed":[]}`, `{"confidence_level":false}`} {
		raw := `{"accounts":[],"added":[{"transaction_id":"pfc","account_id":"account-selected","amount":12.34,"iso_currency_code":"USD","date":"2026-10-01","pending":false,"personal_finance_category":` + category + `}],"modified":[],"removed":[],"has_more":false,"next_cursor":"next"}`
		if page, err := decodeSyncPage([]byte(raw), binding, syncTestCursor(t, binding, "")); err == nil || len(page.Added) != 0 {
			t.Fatal("malformed category produced usable facts")
		}
	}
}

func TestSyncRequestsPFCVersionTwo(t *testing.T) {
	binding := syncTestBinding()
	observed := false
	provider := testPlaid(t, bankingRoundTrip(func(request *http.Request) (*http.Response, error) {
		if request.URL.Path == "/item/get" {
			return plaidTestResponse(200, syncIdentityFixture), nil
		}
		var body struct {
			Options map[string]string `json:"options"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Options["personal_finance_category_version"] != "v2" || body.Options["account_id"] != binding.AccountID {
			t.Fatal("request did not pin account-filtered PFC v2")
		}
		observed = true
		return plaidTestResponse(200, syncEmptyFixture), nil
	}))
	if _, err := provider.SyncTransactions(context.Background(), binding, Credential{raw: []byte("private")}, syncTestCursor(t, binding, "")); err != nil || !observed {
		t.Fatal("sync failed", err)
	}
}

func TestSyncPFCFactsStayRedacted(t *testing.T) {
	fact := SyncTransaction{ProviderPrimaryCategory: pfcString("private-primary"), ProviderCategory: pfcString("private-category"), ProviderConfidence: pfcString("private-confidence")}
	if strings.Contains(fact.String(), "private-") {
		t.Fatal("classification facts leaked")
	}
}

func pfcString(value string) *string { return &value }
