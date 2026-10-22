package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
)

func TestLoadWorkerConfiguration(t *testing.T) {
	const url = "postgres://kami_worker:private@127.0.0.1:5432/postgres?sslmode=disable"
	values := map[string]string{"WORKER_DATABASE_URL": url, "DATABASE_URL": "ignored-api-url", "DATABASE_MAX_CONNS": "20", "DATABASE_TIMEOUT": "10s"}
	lookup := func(key string) (string, bool) { value, ok := values[key]; return value, ok }
	cfg, err := loadConfig(lookup)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.addr != "127.0.0.1:8081" || cfg.shutdownTimeout != 5*time.Second || cfg.database.URL != url || cfg.database.MaxConns != 5 || cfg.database.Timeout != 2*time.Second {
		t.Fatal("worker defaults or isolated database configuration changed")
	}
	values["WORKER_ADDR"] = ":9090"
	values["WORKER_SHUTDOWN_TIMEOUT"] = "15s"
	cfg, err = loadConfig(lookup)
	if err != nil || cfg.addr != ":9090" || cfg.shutdownTimeout != 15*time.Second {
		t.Fatal("explicit worker settings rejected")
	}
	for _, tc := range []struct{ key, value string }{
		{"WORKER_DATABASE_URL", ""},
		{"WORKER_DATABASE_URL", "postgres://kami_worker:private@external.example/postgres?sslmode=disable"},
		{"WORKER_DATABASE_URL", "postgres://kami_worker:private@localhost/postgres?sslmode=disable&options=-c+role=postgres"},
		{"WORKER_ADDR", ""}, {"WORKER_ADDR", "localhost"}, {"WORKER_ADDR", ":0"}, {"WORKER_ADDR", ":65536"},
		{"WORKER_SHUTDOWN_TIMEOUT", ""}, {"WORKER_SHUTDOWN_TIMEOUT", "0s"}, {"WORKER_SHUTDOWN_TIMEOUT", "61s"},
	} {
		t.Run(tc.key+tc.value, func(t *testing.T) {
			before, existed := values[tc.key]
			values[tc.key] = tc.value
			defer func() {
				if existed {
					values[tc.key] = before
				} else {
					delete(values, tc.key)
				}
			}()
			_, err := loadConfig(lookup)
			if err == nil || err.Error() != "invalid worker configuration" {
				t.Fatal("invalid or unsafe worker configuration result")
			}
		})
	}
	delete(values, "WORKER_DATABASE_URL")
	if _, err := loadConfig(lookup); err == nil {
		t.Fatal("worker fell back to API credentials")
	}
}

type fakeOperations struct {
	ready  func(context.Context) error
	status func(context.Context) ([]database.BankingWorkStatus, error)
}

func (f fakeOperations) Ready(ctx context.Context) error { return f.ready(ctx) }
func (f fakeOperations) BankingStatus(ctx context.Context) ([]database.BankingWorkStatus, error) {
	return f.status(ctx)
}

func TestOperationalStatusAggregatesWithoutIdentities(t *testing.T) {
	id := uuid.New()
	operations := []database.BankingWorkStatus{
		{OperationID: id, Kind: "teardown", State: "pending", Attempts: 2, AgeSeconds: 120, ImportLagSeconds: 3600},
		{OperationID: id, Kind: "purge", State: "running", Attempts: 1, AgeSeconds: 90, Progress: 35},
		{OperationID: id, Kind: "purge", State: "complete", Attempts: 3, AgeSeconds: 9999, Progress: 72},
		{OperationID: id, Kind: "teardown", State: "needs_attention", Attempts: 10, AgeSeconds: 1000},
	}
	var ready atomic.Bool
	ready.Store(true)
	db := fakeOperations{status: func(ctx context.Context) ([]database.BankingWorkStatus, error) {
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > 2*time.Second {
			t.Error("unbounded status query")
		}
		return operations, nil
	}}
	handler := operationalHandler(context.Background(), db, &ready, slog.New(slog.NewTextHandler(io.Discard, nil)))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/status", nil))
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("status transport failed")
	}
	var status operationSummary
	if err := json.Unmarshal(response.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	expected := operationSummary{SampleLimit: 100, SampledOperations: 4, Pending: 1, Running: 1, Complete: 1, NeedsAttention: 1, RetriedOperations: 3, OldestIncompleteAgeSeconds: 1000, MaxAttempts: 10, MaxCleanupProgressRows: 72, OldestLocalImportLagSeconds: 3600}
	if status != expected {
		t.Fatalf("unexpected aggregate: %+v", status)
	}
	if strings.Contains(response.Body.String(), id.String()) || strings.Contains(response.Body.String(), "operation_id") || strings.Contains(response.Body.String(), "teardown") {
		t.Fatal("status exposed row metadata")
	}
	operations = make([]database.BankingWorkStatus, 101)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/status", nil))
	if err := json.Unmarshal(response.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if status.SampledOperations != 100 || !status.SampleMayBeTruncated {
		t.Fatal("bounded sample claimed a full queue count")
	}
}

func TestOperationalFailureAndReadiness(t *testing.T) {
	var ready atomic.Bool
	ready.Store(true)
	var calls int
	db := fakeOperations{
		ready: func(ctx context.Context) error {
			deadline, ok := ctx.Deadline()
			if !ok || time.Until(deadline) > 2*time.Second {
				t.Error("unbounded readiness")
			}
			calls++
			return nil
		},
		status: func(context.Context) ([]database.BankingWorkStatus, error) {
			return nil, errors.New("postgres://private-user:private-password@private-provider/item")
		},
	}
	var logs strings.Builder
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	handler := operationalHandler(ctx, db, &ready, logger)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/ready", nil))
	if response.Code != 200 || calls != 1 {
		t.Fatal("readiness did not probe restricted pool")
	}
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/status", nil))
	if response.Code != 503 || strings.Contains(response.Body.String()+logs.String(), "private-") {
		t.Fatal("status failure exposed private diagnostics")
	}
	ready.Store(false)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/ready", nil))
	if response.Code != 503 || calls != 1 {
		t.Fatal("stopping worker remained ready")
	}
	ready.Store(true)
	cancel()
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/ready", nil))
	if response.Code != 503 || calls != 1 {
		t.Fatal("canceled worker remained ready")
	}
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/status", nil))
	if response.Code != http.StatusMethodNotAllowed {
		t.Fatal("operational endpoint accepted mutation")
	}
}

type fakeConsumer func(context.Context, func())

func (f fakeConsumer) Run(ctx context.Context, onFailure func()) { f(ctx, onFailure) }

func TestServeWorkerCancellationWaitsForConsumer(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	stopping := make(chan struct{})
	release := make(chan struct{})
	worker := fakeConsumer(func(ctx context.Context, _ func()) {
		close(started)
		<-ctx.Done()
		close(stopping)
		<-release
	})
	db := fakeOperations{ready: func(context.Context) error { return nil }, status: func(context.Context) ([]database.BankingWorkStatus, error) { return nil, nil }}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		result <- serveWorker(ctx, listener, worker, db, slog.New(slog.NewTextHandler(io.Discard, nil)), time.Second)
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("worker did not start")
	}
	response, err := http.Get("http://" + listener.Addr().String() + "/ready")
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("actual operational listener not ready")
	}
	cancel()
	select {
	case <-stopping:
	case <-time.After(2 * time.Second):
		t.Fatal("shutdown did not cancel consumer")
	}
	select {
	case <-result:
		t.Fatal("returned before consumer joined")
	default:
	}
	close(release)
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("shutdown did not join consumer")
	}
}

func TestServeWorkerUnexpectedConsumerExitStopsListener(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		result <- serveWorker(context.Background(), listener, fakeConsumer(func(context.Context, func()) {}), fakeOperations{}, slog.New(slog.NewTextHandler(io.Discard, nil)), time.Second)
	}()
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("consumer exit silently accepted")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("consumer exit stranded listener")
	}
	connection, err := net.DialTimeout("tcp", listener.Addr().String(), 100*time.Millisecond)
	if err == nil {
		_ = connection.Close()
		t.Fatal("operational listener survived consumer")
	}
}
