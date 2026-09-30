// Package server owns the HTTP transport and its lifecycle.
package server

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/99designs/gqlgen/graphql"
	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/extension"
	"github.com/99designs/gqlgen/graphql/handler/transport"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/vektah/gqlparser/v2/gqlerror"
)

type requestIDKey struct{}

// Readiness is the optional dependency check, with its own bounded deadline.
type Readiness interface{ Ready(context.Context) error }

// Server is a single-use HTTP server. Create a new instance for each run.
type Server struct {
	http            *http.Server
	shutdownTimeout time.Duration
	ready           atomic.Bool
}

// New constructs a server with explicit configuration, schema, and logging dependencies.
func New(cfg config.Config, schema graphql.ExecutableSchema, logger *slog.Logger, dependencies ...Readiness) *Server {
	return NewWithAuthentication(cfg, schema, logger, nil, dependencies...)
}

// NewWithAuthentication attaches verified request evidence without changing the
// public health schema. Future business operations must call auth.WithActor.
// When configured, verifier also participates in protected readiness.
func NewWithAuthentication(cfg config.Config, schema graphql.ExecutableSchema, logger *slog.Logger, verifier *auth.Verifier, dependencies ...Readiness) *Server {
	s := &Server{shutdownTimeout: cfg.ShutdownTimeout}
	if verifier != nil {
		dependencies = append(append([]Readiness(nil), dependencies...), verifier)
	}
	gql := handler.New(schema)
	gql.AddTransport(transport.POST{})
	gql.Use(extension.FixedComplexityLimit(100))
	gql.SetParserTokenLimit(1000)
	gql.SetErrorPresenter(func(ctx context.Context, err error) *gqlerror.Error {
		// Parse/validation errors belong to gqlgen and may safely describe the public schema.
		if graphql.GetFieldContext(ctx) == nil {
			return graphql.DefaultErrorPresenter(ctx, err)
		}
		logger.ErrorContext(ctx, "graphql execution failed", "request_id", ctx.Value(requestIDKey{}))
		return graphql.DefaultErrorPresenter(ctx, errors.New("internal server error"))
	})
	gql.SetRecoverFunc(func(ctx context.Context, recovered any) error {
		// Never log panic values: they may contain private request or dependency data.
		return errors.New("internal server error")
	})
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if !s.ready.Load() {
			http.Error(w, "not ready", http.StatusServiceUnavailable)
			return
		}
		for _, dependency := range dependencies {
			if err := dependency.Ready(r.Context()); err != nil {
				http.Error(w, "not ready", http.StatusServiceUnavailable)
				return
			}
		}
		w.WriteHeader(http.StatusOK)
	})
	graphqlHandler := http.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		gql.ServeHTTP(w, r)
	}))
	if verifier != nil {
		graphqlHandler = verifier.Authenticate(graphqlHandler)
	}
	mux.Handle("/graphql", graphqlHandler)
	s.http = &http.Server{Addr: cfg.Addr, Handler: requestIDs(mux), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	return s
}

func requestIDs(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var bytes [16]byte
		if _, err := rand.Read(bytes[:]); err != nil {
			http.Error(w, "internal server error", 500)
			return
		}
		id := fmt.Sprintf("%x", bytes)
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id)))
	})
}

// Handler exposes the configured HTTP handler for embedding and transport tests.
func (s *Server) Handler() http.Handler { return s.http.Handler }

// Run binds the configured address and serves until cancellation or failure.
func (s *Server) Run(ctx context.Context) error {
	listener, err := net.Listen("tcp", s.http.Addr)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	return s.Serve(ctx, listener)
}

// Serve owns listener and closes it when serving ends. Cancellation first stops
// readiness and accepts, then allows active requests a bounded drain period.
func (s *Server) Serve(ctx context.Context, listener net.Listener) error {
	s.ready.Store(true)
	defer s.ready.Store(false)
	done := make(chan error, 1)
	go func() { done <- s.http.Serve(listener) }()
	select {
	case err := <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		s.ready.Store(false)
		shutdownCtx, cancel := context.WithTimeout(context.Background(), s.shutdownTimeout)
		defer cancel()
		err := s.http.Shutdown(shutdownCtx)
		if err != nil {
			err = errors.Join(err, s.http.Close())
		}
		serveErr := <-done
		if !errors.Is(serveErr, http.ErrServerClosed) {
			err = errors.Join(err, serveErr)
		}
		return err
	}
}
