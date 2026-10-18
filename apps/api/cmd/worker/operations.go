package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
)

type consumer interface{ Run(context.Context, func()) }
type operationalDatabase interface {
	Ready(context.Context) error
	BankingStatus(context.Context) ([]database.BankingWorkStatus, error)
}

// serveWorker owns both goroutines and listener. It cancels and joins the durable
// consumer on every exit before the caller may close its database pool.
func serveWorker(ctx context.Context, listener net.Listener, worker consumer, db operationalDatabase, logger *slog.Logger, shutdownTimeout time.Duration) error {
	workerCtx, cancelWorker := context.WithCancel(ctx)
	doneWorker := make(chan struct{})
	go func() {
		defer close(doneWorker)
		worker.Run(workerCtx, func() { logger.Error("banking lifecycle work unavailable") })
	}()
	defer func() { cancelWorker(); <-doneWorker }()
	var ready atomic.Bool
	ready.Store(true)
	defer ready.Store(false)
	server := &http.Server{
		Handler:           operationalHandler(workerCtx, db, &ready, logger),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Second,
		WriteTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8 << 10,
		BaseContext: func(net.Listener) context.Context { return workerCtx },
	}
	doneHTTP := make(chan error, 1)
	go func() { doneHTTP <- server.Serve(listener) }()
	var serveErr error
	select {
	case serveErr = <-doneHTTP:
		cancelWorker()
		// Serve has already returned, but close idle and in-flight connections too.
		return errors.Join(serveErr, server.Close())
	case <-doneWorker:
		if ctx.Err() == nil {
			serveErr = errors.New("banking consumer stopped unexpectedly")
		}
	case <-ctx.Done():
	}
	ready.Store(false)
	cancelWorker()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	shutdownErr := server.Shutdown(shutdownCtx)
	if shutdownErr != nil {
		shutdownErr = errors.Join(shutdownErr, server.Close())
	}
	httpErr := <-doneHTTP
	if !errors.Is(httpErr, http.ErrServerClosed) {
		shutdownErr = errors.Join(shutdownErr, httpErr)
	}
	return errors.Join(serveErr, shutdownErr)
}

func operationalHandler(ctx context.Context, db operationalDatabase, ready *atomic.Bool, logger *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ready", func(w http.ResponseWriter, r *http.Request) {
		probe, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if ctx.Err() != nil || !ready.Load() || db.Ready(probe) != nil {
			http.Error(w, "not ready", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, r *http.Request) {
		if ctx.Err() != nil || !ready.Load() {
			http.Error(w, "not ready", http.StatusServiceUnavailable)
			return
		}
		probe, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		operations, err := db.BankingStatus(probe)
		if err != nil {
			logger.Error("banking status unavailable")
			http.Error(w, "status unavailable", http.StatusServiceUnavailable)
			return
		}
		// The database already limits the projection. Keep a defensive transport bound
		// and serialize fixed aggregate fields only, never row IDs or arbitrary text.
		if len(operations) > 100 {
			operations = operations[:100]
		}
		status := summarize(operations)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if json.NewEncoder(w).Encode(status) != nil {
			logger.Error("banking status response unavailable")
		}
	})
	return mux
}

type operationSummary struct {
	SampleLimit                int   `json:"sample_limit"`
	SampledOperations          int   `json:"sampled_operations"`
	SampleMayBeTruncated       bool  `json:"sample_may_be_truncated"`
	Pending                    int   `json:"pending"`
	Running                    int   `json:"running"`
	Complete                   int   `json:"complete"`
	NeedsAttention             int   `json:"needs_attention"`
	RetriedOperations          int   `json:"retried_operations"`
	OldestIncompleteAgeSeconds int64 `json:"oldest_incomplete_age_seconds"`
	MaxAttempts                int   `json:"max_attempts"`
	MaxCleanupProgressRows     int64 `json:"max_cleanup_progress_rows"`
}

func summarize(operations []database.BankingWorkStatus) operationSummary {
	summary := operationSummary{SampleLimit: 100, SampledOperations: len(operations), SampleMayBeTruncated: len(operations) >= 100}
	for _, op := range operations {
		switch op.State {
		case "pending":
			summary.Pending++
		case "running":
			summary.Running++
		case "complete":
			summary.Complete++
		case "needs_attention":
			summary.NeedsAttention++
		}
		if op.Attempts > 1 {
			summary.RetriedOperations++
		}
		if op.State != "complete" && op.AgeSeconds > summary.OldestIncompleteAgeSeconds {
			summary.OldestIncompleteAgeSeconds = op.AgeSeconds
		}
		if op.Attempts > summary.MaxAttempts {
			summary.MaxAttempts = op.Attempts
		}
		if op.Kind == "purge" && op.Progress > summary.MaxCleanupProgressRows {
			summary.MaxCleanupProgressRows = op.Progress
		}
	}
	return summary
}
