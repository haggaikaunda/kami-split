package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"

	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/banking"
	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
	"github.com/haggaikaunda/kami-split/apps/api/internal/group"
	"github.com/haggaikaunda/kami-split/apps/api/internal/invitation"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/haggaikaunda/kami-split/apps/api/internal/onboarding"
	"github.com/haggaikaunda/kami-split/apps/api/internal/profile"
	"github.com/haggaikaunda/kami-split/apps/api/internal/server"
)

func main() {
	os.Exit(run())
}

func run() int {
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	cfg, err := config.Load(os.LookupEnv)
	if err != nil {
		logger.Error("invalid server configuration", "error", err)
		return 1
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	dbConfig, err := database.Load(os.LookupEnv)
	if err != nil {
		logger.Error("invalid database configuration", "error", err)
		return 1
	}
	var dependencies []server.Readiness
	var db *database.DB
	if dbConfig != nil {
		db, err = database.Open(ctx, *dbConfig)
		if err != nil {
			if operation, unexpected := diagnostic.Operation(err); unexpected {
				logger.Error("database startup failed", "operation", operation)
			} else {
				logger.Error("database startup failed")
			}
			return 1
		}
		defer db.Close()
		maintenanceCtx, cancelMaintenance := context.WithCancel(ctx)
		maintenanceDone := make(chan struct{})
		go func() {
			defer close(maintenanceDone)
			invitation.RunMaintenance(maintenanceCtx, db, func() { logger.Error("invitation cleanup unavailable") })
		}()
		defer func() { cancelMaintenance(); <-maintenanceDone }()
		dependencies = append(dependencies, db)
	} else {
		logger.Info("health-only development mode; database readiness disabled")
	}
	authConfig, err := auth.Load(os.LookupEnv)
	if err != nil || (authConfig != nil && dbConfig == nil) {
		logger.Error("invalid authentication configuration or missing database")
		return 1
	}
	var verifier *auth.Verifier
	if authConfig != nil {
		verifier, err = auth.New(*authConfig)
		if err != nil {
			logger.Error("invalid authentication configuration")
			return 1
		}
		if verifier.Warm(ctx) != nil {
			logger.Warn("protected authentication readiness unavailable")
		}
		authCtx, cancelAuth := context.WithCancel(ctx)
		finished := make(chan struct{})
		go func() { defer close(finished); verifier.Run(authCtx) }()
		defer func() { cancelAuth(); <-finished }()
		// SIGHUP discards local trust immediately, then the owned refresh loop reloads.
		invalidate := make(chan os.Signal, 1)
		signal.Notify(invalidate, syscall.SIGHUP)
		defer signal.Stop(invalidate)
		invalidationDone := make(chan struct{})
		go func() {
			defer close(invalidationDone)
			for {
				select {
				case <-authCtx.Done():
					return
				case <-invalidate:
					verifier.Invalidate()
				}
			}
		}()
		defer func() { cancelAuth(); <-invalidationDone }()
	}
	cursors, err := ledger.LoadCursorCodec(os.LookupEnv)
	if err != nil || (authConfig != nil && cursors == nil) {
		logger.Error("invalid or missing cursor signing configuration")
		return 1
	}
	invitations, err := onboarding.Load(os.LookupEnv, db)
	if err != nil || (invitations != nil && verifier == nil) {
		logger.Error("invalid onboarding configuration")
		return 1
	}
	resolvers := &graph.Resolver{Profiles: profile.New(db), Expenses: expense.New(db), Groups: group.New(db), Cursors: cursors, Invitations: invitations}
	var bankingHandler http.Handler
	bankingRuntime, err := banking.LoadRuntime(os.LookupEnv)
	if err != nil || (bankingRuntime != nil && db == nil) {
		logger.Error("invalid banking runtime configuration or missing database")
		return 1
	}
	if bankingRuntime != nil {
		service, err := banking.New(db, bankingRuntime.Protector)
		if err != nil {
			logger.Error("banking ingress unavailable")
			return 1
		}
		webhookVerifier, err := banking.NewWebhookVerifier(bankingRuntime.Provider, nil)
		if err != nil {
			logger.Error("banking ingress unavailable")
			return 1
		}
		handler, err := banking.NewWebhookHandler(webhookVerifier, service)
		if err != nil {
			logger.Error("banking ingress unavailable")
			return 1
		}
		enrollment, err := banking.NewEnrollment(service, bankingRuntime.Provider, bankingRuntime.Enrollment)
		if err != nil {
			logger.Error("invalid banking enrollment configuration")
			return 1
		}
		resolvers.Banking = enrollment
		resolvers.BankingStorage = service
		bankingHandler = handler
	}
	schema := graph.NewExecutableSchema(graph.Config{Resolvers: resolvers})
	application := server.NewWithAuthentication(cfg, schema, logger, verifier, dependencies...)
	if bankingHandler != nil {
		application.Use(bankingIngress(bankingHandler, logger))
	}
	if invitations != nil {
		handler, err := onboarding.NewHandler(invitations, verifier, os.Getenv("ONBOARDING_ORIGIN"), os.Getenv("ONBOARDING_AUTH_ADMIN_KEY"), logger)
		if err != nil {
			logger.Error("invalid onboarding handler configuration")
			return 1
		}
		contextCtx, cancelContexts := context.WithCancel(ctx)
		contextsDone := make(chan struct{})
		go func() { defer close(contextsDone); handler.Run(contextCtx) }()
		defer func() { cancelContexts(); <-contextsDone }()
		application.Use(handler.Wrap)
	}
	if err := application.Run(ctx); err != nil {
		logger.Error("server stopped unexpectedly")
		return 1
	}
	return 0
}

// bankingIngress mounts the single verifier and owns one safe diagnostic event
// per request. It never logs raw errors, URL correlations, headers or bodies.
func bankingIngress(handler http.Handler, logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !strings.HasPrefix(r.URL.Path, "/banking/webhooks/") {
				next.ServeHTTP(w, r)
				return
			}
			var once sync.Once
			ctx := diagnostic.WithReporter(r.Context(), func(operation string) {
				once.Do(func() { logger.ErrorContext(r.Context(), "banking ingress unavailable", "operation", operation) })
			})
			handler.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
