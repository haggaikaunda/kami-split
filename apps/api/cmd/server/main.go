package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
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
	if dbConfig != nil {
		db, err := database.Open(ctx, *dbConfig)
		if err != nil {
			logger.Error("database startup failed")
			return 1
		}
		defer db.Close()
		dependencies = append(dependencies, db)
	} else {
		logger.Info("health-only development mode; database readiness disabled")
	}
	schema := graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{}})
	if err := server.New(cfg, schema, logger, dependencies...).Run(ctx); err != nil {
		logger.Error("server stopped unexpectedly")
		return 1
	}
	return 0
}
