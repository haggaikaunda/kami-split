package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
	"github.com/haggaikaunda/kami-split/apps/api/internal/group"
	"github.com/haggaikaunda/kami-split/apps/api/internal/invitation"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
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
			logger.Error("database startup failed")
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
	schema := graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{Expenses: expense.New(db), Groups: group.New(db), Cursors: cursors}})
	if err := server.NewWithAuthentication(cfg, schema, logger, verifier, dependencies...).Run(ctx); err != nil {
		logger.Error("server stopped unexpectedly")
		return 1
	}
	return 0
}
