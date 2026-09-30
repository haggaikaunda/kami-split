package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const validExpenseInput = `{groupId:"ks1:Group:00000000-0000-4000-8000-000000000001",key:"00000000-0000-4000-8000-000000000001",totalMinor:"1000",currency:USD,description:"Dinner",effectiveDate:"2026-09-29",category:DINING,payerId:"ks1:Membership:00000000-0000-4000-8000-000000000001",participantIds:["ks1:Membership:00000000-0000-4000-8000-000000000001"],split:EQUAL}`

func scalarRequest(t *testing.T, query string, variables map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	body, e := json.Marshal(map[string]any{"query": query, "variables": variables})
	if e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest("POST", "/graphql", strings.NewReader(string(body)))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	newTestServer().Handler().ServeHTTP(w, r)
	return w
}

func TestScalarPreflightChecksLaterMutationFieldsBeforeExecution(t *testing.T) {
	// Authentication runs after scalar preflight. 400 rather than 401 proves that
	// all selected mutation inputs are checked before any operation may execute.
	for _, invalid := range []string{
		strings.Replace(validExpenseInput, `totalMinor:"1000"`, `totalMinor:1000`, 1),
		strings.Replace(validExpenseInput, `totalMinor:"1000"`, `totalMinor:"01"`, 1),
		strings.Replace(validExpenseInput, `totalMinor:"1000"`, `totalMinor:"9223372036854775808"`, 1),
		strings.Replace(validExpenseInput, `effectiveDate:"2026-09-29"`, `effectiveDate:"2026-02-30"`, 1),
		strings.Replace(validExpenseInput, `key:"00000000-0000-4000-8000-000000000001"`, `key:"00000000-0000-1000-8000-000000000001"`, 1),
		strings.Replace(validExpenseInput, `split:EQUAL`, `split:EXACT,exactAllocations:[{participantId:"ks1:Membership:00000000-0000-4000-8000-000000000001",amountMinor:1000}]`, 1),
	} {
		query := `mutation { first:createExpense(input:` + validExpenseInput + `) { __typename } second:createExpense(input:` + invalid + `) { __typename } }`
		w := scalarRequest(t, query, nil)
		if w.Code != 400 || !strings.Contains(w.Body.String(), "BAD_USER_INPUT") {
			t.Fatalf("later scalar was not rejected before execution: %d %s", w.Code, w.Body.String())
		}
	}
	w := scalarRequest(t, `mutation { createExpense(input:`+validExpenseInput+`) { __typename } }`, nil)
	if w.Code != 401 {
		t.Fatalf("valid scalar input rejected: %d %s", w.Code, w.Body.String())
	}
}

func TestScalarPreflightTraversesVariablesAndNestedFragments(t *testing.T) {
	query := `query($from:Date!){group(id:"ks1:Group:00000000-0000-4000-8000-000000000001"){...Page}} fragment Page on Group { expenses(filter:{from:$from}){edges{node{id}}}}`
	for _, value := range []any{20260929, "2026-02-30", "0000-01-01"} {
		w := scalarRequest(t, query, map[string]any{"from": value})
		if w.Code != 400 || !strings.Contains(w.Body.String(), "BAD_USER_INPUT") {
			t.Fatalf("invalid nested variable: %d %s", w.Code, w.Body.String())
		}
	}
	w := scalarRequest(t, query, map[string]any{"from": "2026-09-29"})
	if w.Code != 401 {
		t.Fatalf("valid variable: %d %s", w.Code, w.Body.String())
	}
}

func TestGraphExecutionDeadlineCancelsBlockedWork(t *testing.T) {
	var cancellation error
	handler := graphTransportWithTimeout(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		deadline, ok := r.Context().Deadline()
		if !ok || time.Until(deadline) > 100*time.Millisecond {
			t.Error("execution deadline missing")
		}
		<-r.Context().Done()
		cancellation = r.Context().Err()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"createExpense":{"__typename":"OperationProgress","state":"UNKNOWN"}}}`))
	}), 5*time.Millisecond)
	req := httptest.NewRequest("POST", "/graphql", strings.NewReader(`{"query":"mutation { createExpense { __typename } }"}`))
	out := httptest.NewRecorder()
	handler.ServeHTTP(out, req)
	if cancellation != context.DeadlineExceeded || out.Code != 200 || !strings.Contains(out.Body.String(), "UNKNOWN") {
		t.Fatalf("deadline did not propagate: %v %d %s", cancellation, out.Code, out.Body.String())
	}
}

func TestGraphQLUnicodePreservesBlockStringsCommentsAndPairs(t *testing.T) {
	for _, source := range []string{
		`query { health { status } } # literal \uD800`,
		`mutation { field(note:"""literal \uD800""") }`,
		`mutation { field(note:"""escaped \""" still a block \uD800""") }`,
		`mutation { field(note:"literal \\uD800") }`,
	} {
		got, ok := normalizeGraphQLUnicode(source)
		if !ok || got != source {
			t.Fatalf("changed literal source: %q %v", got, ok)
		}
	}
	source := `mutation { field(note:"\uD83D\uDE00") }`
	got, ok := normalizeGraphQLUnicode(source)
	if !ok || got != `mutation { field(note:"😀") }` {
		t.Fatalf("lost valid pair: %q %v", got, ok)
	}
	for _, source := range []string{`mutation { field(note:"\uD800") }`, `mutation { field(note:"\uDC00") }`} {
		if _, ok := normalizeGraphQLUnicode(source); ok {
			t.Fatal("lone surrogate accepted")
		}
	}
	w := scalarRequest(t, "{ health { status } } # literal \\uD800", nil)
	if w.Code != 200 {
		t.Fatalf("comment rejected: %d %s", w.Code, w.Body.String())
	}
	// A block string is valid input text even when it spells an invalid escape.
	input := strings.Replace(validExpenseInput, `description:"Dinner"`, `description:"""literal \uD800"""`, 1)
	w = scalarRequest(t, `mutation { createExpense(input:`+input+`) { __typename } }`, nil)
	if w.Code != 401 {
		t.Fatalf("block string rejected before auth: %d %s", w.Code, w.Body.String())
	}
}
