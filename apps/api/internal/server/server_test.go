package server

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/99designs/gqlgen/graphql"
	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
)

func newTestServer() *Server {
	return New(config.Config{Addr: "127.0.0.1:0", ShutdownTimeout: time.Second}, graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{}}), slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func TestGraphQLTransport(t *testing.T) {
	s := newTestServer()
	cases := []struct {
		name, method, contentType, body string
		success                         bool
	}{
		{"health", "POST", "application/json", `{"query":"{ health { status } }"}`, true},
		{"malformed json", "POST", "application/json", `{`, false},
		{"invalid query", "POST", "application/json", `{"query":"{ missing }"}`, false},
		{"get disabled", "GET", "", "", false},
		{"multipart disabled", "POST", "multipart/form-data", "anything", false},
		{"body bounded", "POST", "application/json", `{"query":"` + strings.Repeat(" ", 65536) + `{ health { status } }"}`, false},
		{"complexity bounded", "POST", "application/json", `{"query":"{` + repeatedFields(60) + `}"}`, false},
		{"tokens bounded", "POST", "application/json", `{"query":"{ health {` + strings.Repeat("status ", 1100) + `} }"}`, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, "/graphql", strings.NewReader(tc.body))
			r.Header.Set("Content-Type", tc.contentType)
			r.Header.Set("X-Request-ID", "untrusted-id")
			w := httptest.NewRecorder()
			s.Handler().ServeHTTP(w, r)
			if id := w.Header().Get("X-Request-ID"); len(id) != 32 || id == "untrusted-id" {
				t.Fatalf("invalid generated request id %q", id)
			}
			success := w.Code == 200 && !strings.Contains(w.Body.String(), `"errors"`)
			if success != tc.success {
				t.Fatalf("status %d body %s", w.Code, w.Body.String())
			}
			if tc.success && !strings.Contains(w.Body.String(), `"status"`) {
				t.Fatal(w.Body.String())
			}
		})
	}
}

func repeatedFields(n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		b.WriteString("a" + strings.Repeat("x", i) + ": health { status } ")
	}
	return b.String()
}

func TestLifecycle(t *testing.T) {
	s := newTestServer()
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/readyz", nil))
	if w.Code != 503 {
		t.Fatal("ready before serving")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- s.Serve(ctx, listener) }()
	client := &http.Client{Timeout: time.Second}
	for _, path := range []string{"/health", "/healthz", "/ready", "/readyz"} {
		resp, err := client.Get("http://" + listener.Addr().String() + path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("%s: %d", path, resp.StatusCode)
		}
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("shutdown blocked")
	}
	w = httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/readyz", nil))
	if w.Code != 503 {
		t.Fatal("ready after shutdown")
	}
}

// failingSchema substitutes only execution, keeping real parsing and validation.
type failingSchema struct {
	graphql.ExecutableSchema
	panics bool
}

func (s failingSchema) Exec(ctx context.Context) graphql.ResponseHandler {
	return func(ctx context.Context) (response *graphql.Response) {
		ctx = graphql.WithFieldContext(ctx, &graphql.FieldContext{})
		response = &graphql.Response{Data: []byte("null")}
		if s.panics {
			defer func() {
				if value := recover(); value != nil {
					graphql.AddError(ctx, graphql.GetOperationContext(ctx).Recover(ctx, value))
				}
			}()
			panic("secret-password")
		}
		graphql.AddError(ctx, errors.New("secret-password"))
		return response
	}
}

func TestExecutionErrorsAreMasked(t *testing.T) {
	for _, panics := range []bool{false, true} {
		var logs bytes.Buffer
		schema := failingSchema{graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{}}), panics}
		s := New(config.Config{ShutdownTimeout: time.Second}, schema, slog.New(slog.NewTextHandler(&logs, nil)))
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/graphql", strings.NewReader(`{"query":"{ health { status } }"}`))
		r.Header.Set("Content-Type", "application/json")
		s.Handler().ServeHTTP(w, r)
		if strings.Contains(w.Body.String()+logs.String(), "secret-password") {
			t.Fatal("secret leaked")
		}
		if strings.Count(logs.String(), "graphql execution failed") != 1 || !strings.Contains(logs.String(), w.Header().Get("X-Request-ID")) {
			t.Fatal("missing or duplicate diagnostic correlation")
		}
		if panics && !strings.Contains(logs.String(), "graphql.panic") {
			t.Fatal("missing panic classification")
		}
		if !strings.Contains(w.Body.String(), "internal server error") {
			t.Fatal(w.Body.String())
		}
	}
}

func TestShutdownTimeoutClosesActiveRequests(t *testing.T) {
	s := newTestServer()
	s.shutdownTimeout = 20 * time.Millisecond
	entered := make(chan struct{})
	exited := make(chan struct{})
	s.http.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-r.Context().Done()
		close(exited)
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- s.Serve(ctx, listener) }()
	requestDone := make(chan struct{})
	go func() {
		defer close(requestDone)
		client := &http.Client{Timeout: time.Second}
		resp, err := client.Get("http://" + listener.Addr().String())
		if err == nil {
			resp.Body.Close()
		}
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("request never entered")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("expected deadline: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("shutdown blocked")
	}
	select {
	case <-exited:
	case <-time.After(time.Second):
		t.Fatal("request not canceled")
	}
	<-requestDone
}

func TestShutdownDrainsActiveRequest(t *testing.T) {
	s := newTestServer()
	entered := make(chan struct{})
	release := make(chan struct{})
	s.http.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-release
		w.WriteHeader(http.StatusNoContent)
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- s.Serve(ctx, listener) }()
	result := make(chan error, 1)
	go func() {
		client := &http.Client{Timeout: time.Second}
		resp, err := client.Get("http://" + listener.Addr().String())
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode != http.StatusNoContent {
				err = errors.New("request did not complete")
			}
		}
		result <- err
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		close(release)
		t.Fatal("request never entered")
	}
	cancel()
	// A pending handler must prevent shutdown from returning until released.
	select {
	case err := <-done:
		close(release)
		t.Fatalf("returned before drain: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("drain blocked")
	}
}

func TestProbeAliases(t *testing.T) {
	dependency := &diagnosticReadiness{}
	s := New(config.Config{}, graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{}}), slog.New(slog.NewTextHandler(io.Discard, nil)), dependency)
	for _, tc := range []struct {
		name          string
		serving       bool
		dependencyErr error
		wantReady     int
	}{
		{"before serving", false, nil, 503},
		{"serving", true, nil, 200},
		{"dependency unavailable", true, errors.New("private dependency failure"), 503},
		{"dependency recovered", true, nil, 200},
		{"shutting down", false, nil, 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s.ready.Store(tc.serving)
			dependency.err = tc.dependencyErr
			for _, probe := range []struct {
				path   string
				status int
			}{{"/health", 200}, {"/ready", tc.wantReady}} {
				alias := httptest.NewRecorder()
				legacy := httptest.NewRecorder()
				s.Handler().ServeHTTP(alias, httptest.NewRequest(http.MethodGet, probe.path, nil))
				s.Handler().ServeHTTP(legacy, httptest.NewRequest(http.MethodGet, probe.path+"z", nil))
				wantBody := ""
				if probe.status == 503 {
					wantBody = "not ready\n"
				}
				if alias.Code != probe.status || legacy.Code != probe.status || alias.Body.String() != wantBody || legacy.Body.String() != wantBody {
					t.Fatalf("%s: alias %d %q; legacy %d %q", probe.path, alias.Code, alias.Body.String(), legacy.Code, legacy.Body.String())
				}
				for _, header := range []string{"Content-Type", "X-Content-Type-Options"} {
					if alias.Header().Get(header) != legacy.Header().Get(header) {
						t.Errorf("%s: different %s", probe.path, header)
					}
				}
			}
		})
	}
}
