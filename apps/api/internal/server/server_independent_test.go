package server

import (
	"context"
	"encoding/json"
	"net"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIndependentGraphQLContractAndValidation(t *testing.T) {
	s := newTestServer()
	seen := make(map[string]bool)
	for _, tc := range []struct{ query, want string }{
		{`{ health { status } }`, `"status":"ok"`},
		{`{ missing }`, `Cannot query field`},
		{`{ health }`, `must have a selection`},
	} {
		body, err := json.Marshal(map[string]string{"query": tc.query})
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest("POST", "/graphql", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer private-token")
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		if !strings.Contains(rec.Body.String(), tc.want) {
			t.Fatalf("query %s: %s", tc.query, rec.Body.String())
		}
		if strings.Contains(rec.Body.String(), "private-token") {
			t.Fatal("credential exposed")
		}
		id := rec.Header().Get("X-Request-ID")
		if seen[id] {
			t.Fatal("request IDs were reused")
		}
		seen[id] = true
	}
}

func TestIndependentBindFailureDoesNotBecomeReady(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	s := newTestServer()
	s.http.Addr = listener.Addr().String()
	if err := s.Run(context.Background()); err == nil {
		t.Fatal("occupied address accepted")
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/readyz", nil))
	if rec.Code != 503 {
		t.Fatalf("ready after bind failure: %d", rec.Code)
	}
}
