package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"testing"

	"github.com/99designs/gqlgen/complexity"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
	"github.com/vektah/gqlparser/v2"
)

func compiledRelayOperation(t *testing.T, path string) string {
	t.Helper()
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	match := regexp.MustCompile(`"text":\s*("(?:[^"\\]|\\.)*")`).FindSubmatch(source)
	if len(match) == 0 {
		return ""
	} // Reader fragments do not contain a wire operation.
	var operation string
	if err = json.Unmarshal(match[1], &operation); err != nil {
		t.Fatal(err)
	}
	return operation
}

func TestShippedRelayOperationsFitFiniteTransportBudget(t *testing.T) {
	paths, err := filepath.Glob("../../../web/src/lib/relay/__generated__/*.graphql.ts")
	if err != nil || len(paths) == 0 {
		t.Fatalf("compiled operation inventory unavailable: %v", err)
	}
	schema := graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{}})
	maximum, count := 0, 0
	maximumName := ""
	for _, path := range paths {
		operation := compiledRelayOperation(t, path)
		if operation == "" {
			continue
		}
		doc, errs := gqlparser.LoadQuery(schema.Schema(), operation)
		if len(errs) != 0 {
			t.Fatalf("compiled operation %s invalid: %v", filepath.Base(path), errs)
		}
		value := complexity.Calculate(context.Background(), schema, doc.Operations[0], nil)
		if value > 200 {
			t.Errorf("compiled operation %s complexity%d exceeds finite budget200", filepath.Base(path), value)
		}
		count++
		if value > maximum {
			maximum, maximumName = value, filepath.Base(path)
		}
	}
	if count == 0 {
		t.Fatal("no compiled wire operations examined")
	}
	t.Logf("examined%d compiled operations: maximum%d (%s), finite budget200", count, maximum, maximumName)
}

func TestCompiledWorkspacePassesTransportAndStillRequiresAuthentication(t *testing.T) {
	operation := compiledRelayOperation(t, "../../../web/src/lib/relay/__generated__/journeyWorkspaceQuery.graphql.ts")
	if operation == "" {
		t.Fatal("workspace artifact is missing its wire operation")
	}
	server := newTestServer()
	for _, tab := range []string{"overview", "expenses", "balances", "activity", "members"} {
		t.Run(tab, func(t *testing.T) {
			variables := map[string]any{"id": "ks1:Group:00000000-0000-4000-8000-000000000001", "overview": tab == "overview", "balances": tab == "balances", "summary": tab == "overview" || tab == "balances" || tab == "expenses", "ledger": tab == "expenses", "activity": tab == "activity", "filter": nil}
			body, err := json.Marshal(map[string]any{"query": operation, "variables": variables})
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, "/graphql", bytes.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			server.Handler().ServeHTTP(response, request)
			var result struct {
				Errors []struct{ Extensions map[string]any }
			}
			if response.Code != http.StatusUnauthorized || json.Unmarshal(response.Body.Bytes(), &result) != nil || len(result.Errors) != 1 || result.Errors[0].Extensions["code"] != "UNAUTHENTICATED" {
				t.Fatalf("compiled workspace failed to reach authentication boundary: status%d response%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestComplexityBoundaryAccepts200AndRejects202(t *testing.T) {
	server := newTestServer()
	for _, tc := range []struct{ fields, status int }{{100, http.StatusOK}, {101, http.StatusBadRequest}} {
		body, err := json.Marshal(map[string]string{"query": "{" + repeatedFields(tc.fields) + "}"})
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodPost, "/graphql", bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != tc.status {
			t.Fatalf("%d health selections: status%d wanted%d", tc.fields, response.Code, tc.status)
		}
		if tc.fields == 101 {
			var result struct {
				Errors []struct {
					Message    string
					Extensions map[string]any
				}
			}
			if json.Unmarshal(response.Body.Bytes(), &result) != nil || len(result.Errors) != 1 || result.Errors[0].Message != "operation has complexity 202, which exceeds the limit of 200" || result.Errors[0].Extensions["code"] != "BAD_USER_INPUT" {
				t.Fatal("oversized request was not rejected by the finite complexity guard")
			}
		}
	}
}
