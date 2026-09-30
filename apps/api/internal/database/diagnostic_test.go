package database

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
	"testing"
	"time"
)

func TestDatabaseOperationsPreserveCancellationWithoutCredentials(t *testing.T) {
	cfg := Config{URL: "postgres://kami_api:private-password@127.0.0.1:1/postgres?sslmode=disable", MaxConns: 1, Timeout: time.Second}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Open(ctx, cfg)
	if !errors.Is(err, context.Canceled) || strings.Contains(err.Error(), "private-password") {
		t.Fatalf("unsafe/lost cause: %s", err)
	}
	pc, err := cfg.poolConfig()
	if err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), pc)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	db := &DB{Pool: pool, timeout: time.Second}
	err = db.Ready(ctx)
	if !errors.Is(err, context.Canceled) || err.Error() != "database unavailable" {
		t.Fatalf("unsafe/lost readiness cause: %s", err)
	}
}
