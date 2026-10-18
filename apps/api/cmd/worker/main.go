// Command worker runs the opt-in restricted banking lifecycle consumer.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/banking"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
)

func main() { os.Exit(run()) }

func run() int {
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	cfg, err := loadConfig(os.LookupEnv)
	if err != nil {
		logger.Error("invalid worker configuration")
		return 1
	}
	runtime, err := banking.LoadRuntime(os.LookupEnv)
	if err != nil || runtime == nil {
		logger.Error("invalid or missing banking runtime configuration")
		return 1
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	db, err := database.OpenWorker(ctx, cfg.database)
	if err != nil {
		logger.Error("worker database startup failed")
		return 1
	}
	defer db.Close()
	worker, err := banking.NewWorker(db, runtime.Protector, runtime.Provider)
	if err != nil {
		logger.Error("worker startup failed")
		return 1
	}
	listener, err := net.Listen("tcp", cfg.addr)
	if err != nil {
		logger.Error("worker operational listener unavailable")
		return 1
	}
	if err := serveWorker(ctx, listener, worker, db, logger, cfg.shutdownTimeout); err != nil {
		logger.Error("worker stopped unexpectedly")
		return 1
	}
	return 0
}

type workerConfig struct {
	addr            string
	shutdownTimeout time.Duration
	database        database.Config
}

func loadConfig(lookup func(string) (string, bool)) (workerConfig, error) {
	failure := errors.New("invalid worker configuration")
	// Deliberately ignore the API URL and pool settings. This process requires its
	// own restricted role and uses the same validated URL policy with fixed bounds.
	db, err := database.Load(func(key string) (string, bool) {
		if key == "DATABASE_URL" {
			return lookup("WORKER_DATABASE_URL")
		}
		return "", false
	})
	if err != nil || db == nil {
		return workerConfig{}, failure
	}
	cfg := workerConfig{addr: "127.0.0.1:8081", shutdownTimeout: 5 * time.Second, database: *db}
	if addr, ok := lookup("WORKER_ADDR"); ok {
		cfg.addr = addr
	}
	_, port, err := net.SplitHostPort(cfg.addr)
	if err != nil {
		return workerConfig{}, failure
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return workerConfig{}, failure
	}
	if raw, ok := lookup("WORKER_SHUTDOWN_TIMEOUT"); ok {
		cfg.shutdownTimeout, err = time.ParseDuration(raw)
		if err != nil || cfg.shutdownTimeout <= 0 || cfg.shutdownTimeout > time.Minute {
			return workerConfig{}, failure
		}
	}
	return cfg, nil
}
