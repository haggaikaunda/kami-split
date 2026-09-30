package server

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/99designs/gqlgen/graphql"
	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
)

type diagnosticSchema struct {
	graphql.ExecutableSchema
	failure error
}

func (s diagnosticSchema) Exec(ctx context.Context) graphql.ResponseHandler {
	return func(ctx context.Context) *graphql.Response {
		// Union-returning resolvers consume the error; they must still report it.
		diagnostic.Report(ctx, s.failure)
		diagnostic.Report(ctx, s.failure)
		return &graphql.Response{Data: []byte(`{"health":{"status":"OK"}}`)}
	}
}
func TestConsumedFailuresProduceOneSafeCorrelatedDiagnostic(t *testing.T) {
	for _, unexpected := range []bool{false, true} {
		var logs bytes.Buffer
		var failure error = expense.Failure("INVALID_INPUT")
		if unexpected {
			failure = diagnostic.Wrap(expense.Failure("UNAVAILABLE"), errors.New("password SQL bearer token recipient@example.test"), "expense.transaction")
		}
		schema := diagnosticSchema{graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{}}), failure}
		s := New(config.Config{}, schema, slog.New(slog.NewJSONHandler(&logs, nil)))
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/graphql", strings.NewReader(`{"query":"{ health { status } }"}`))
		r.Header.Set("Content-Type", "application/json")
		s.Handler().ServeHTTP(w, r)
		if !unexpected {
			if logs.Len() != 0 {
				t.Fatal("expected failure logged")
			}
			continue
		}
		if strings.Count(logs.String(), "graphql execution failed") != 1 || !strings.Contains(logs.String(), w.Header().Get("X-Request-ID")) || !strings.Contains(logs.String(), "expense.transaction") {
			t.Fatalf("missing/duplicate correlation: %s", logs.String())
		}
		for _, secret := range []string{"password", "SQL", "bearer", "token", "recipient@example.test"} {
			if strings.Contains(logs.String()+w.Body.String(), secret) {
				t.Fatal("secret leaked")
			}
		}
	}
}

type diagnosticReadiness struct{ err error }

func (d diagnosticReadiness) Ready(context.Context) error { return d.err }
func TestReadinessDependenciesAreOwnedWithoutAuthentication(t *testing.T) {
	dependencies := []Readiness{diagnosticReadiness{}}
	s := New(config.Config{}, graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{}}), slog.Default(), dependencies...)
	dependencies[0] = diagnosticReadiness{errors.New("failed")}
	s.ready.Store(true)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/readyz", nil))
	if w.Code != 200 {
		t.Fatal("caller changed retained dependency slice")
	}
}
