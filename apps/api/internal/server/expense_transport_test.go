package server

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProtectedExpenseOperationsRejectAbsentIdentity(t *testing.T) {
	for _, query := range []string{`{ viewer { __typename } }`, `query { alias: group(id:"ks1:Group:82000000-0000-4000-8000-000000000201") { __typename } }`, `query { ...Protected } fragment Protected on Query { viewer { __typename } }`} {
		req := httptest.NewRequest("POST", "/graphql", strings.NewReader(`{"query":`+quoteJSON(query)+`}`))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		newTestServer().Handler().ServeHTTP(w, req)
		if w.Code != 401 || !strings.Contains(w.Body.String(), `"code":"UNAUTHENTICATED"`) {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
	}
}
func quoteJSON(s string) string { return `"` + strings.ReplaceAll(s, `"`, `\"`) + `"` }
func TestMalformedUnicodeCannotChangeFinancialIntent(t *testing.T) {
	for _, body := range []string{`{"query":"{ health { status } }","variables":{"note":"\ud800"}}`, `{"query":"{ health { status } }","variables":{"note":"\udc00"}}`, `{"query":"mutation { createExpense(input: {description: \"\\uD800\"}) { __typename } }"}`} {
		req := httptest.NewRequest("POST", "/graphql", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		newTestServer().Handler().ServeHTTP(w, req)
		if w.Code != 400 || !strings.Contains(w.Body.String(), "BAD_USER_INPUT") {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
	}
	for _, valid := range []string{`"\ud83d\ude00"`, `"\\ud800"`, `"normal"`} {
		if !validSurrogates(valid) {
			t.Fatalf("valid %s rejected", valid)
		}
	}
}
