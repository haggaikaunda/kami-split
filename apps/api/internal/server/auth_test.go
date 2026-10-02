package server

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
)

func TestAuthenticationReadinessPreservesPublicHealth(t *testing.T) {
	verifier, err := auth.New(auth.Config{Issuer: "https://auth.example.invalid", Audience: "authenticated", JWKSURL: "https://auth.example.invalid/keys"})
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Load(func(string) (string, bool) { return "", false })
	if err != nil {
		t.Fatal(err)
	}
	schema := graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{}})
	server := NewWithAuthentication(cfg, schema, slog.New(slog.NewTextHandler(io.Discard, nil)), verifier)
	server.ready.Store(true)
	for _, tc := range []struct {
		path, method, body string
		status             int
	}{{"/health", "GET", "", 200}, {"/ready", "GET", "", 503}, {"/healthz", "GET", "", 200}, {"/readyz", "GET", "", 503}, {"/graphql", "POST", `{"query":"{ health { status } }"}`, 200}} {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer malformed")
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, req)
		if response.Code != tc.status {
			t.Errorf("%s: %d %s", tc.path, response.Code, response.Body.String())
		}
		if tc.path == "/graphql" && !strings.Contains(response.Body.String(), `"status":"ok"`) {
			t.Fatal("health contract changed")
		}
	}
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/protected", nil))
	if response.Code != 404 {
		t.Fatal("added an unapproved business route")
	}
}
