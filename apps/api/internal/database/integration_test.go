//go:build integration

package database_test

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database/sqlctest"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
	"github.com/haggaikaunda/kami-split/apps/api/internal/server"
	"github.com/jackc/pgx/v5"
)

func TestDatabaseIntegration(t *testing.T) {
	runtimeURL, adminURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_DATABASE_ADMIN_URL")
	if runtimeURL == "" || adminURL == "" {
		t.Fatal("integration requires isolated local Supabase: run make db-test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close(ctx)
	exec := func(sql string) {
		t.Helper()
		if _, err := admin.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	cfg := database.Config{URL: runtimeURL, MaxConns: 1, Timeout: 200 * time.Millisecond}
	db, err := database.Open(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.Ready(ctx); err != nil {
		t.Fatal(err)
	}

	t.Run("runtime isolation and sqlc fixture", func(t *testing.T) {
		exec(`SET ROLE kami_migrator;
   CREATE TABLE app.foundation_fixture(id bigint PRIMARY KEY, label text NOT NULL);
   CREATE FUNCTION app.foundation_probe() RETURNS integer LANGUAGE sql AS 'SELECT 1';
   RESET ROLE`)
		defer exec(`SET ROLE kami_migrator; DROP TABLE app.foundation_fixture; DROP FUNCTION app.foundation_probe(); RESET ROLE`)
		for _, sql := range []string{
			`CREATE TABLE app.denied(id integer)`, `SET ROLE kami_migrator`,
			`SELECT * FROM app.foundation_fixture`, `SELECT app.foundation_probe()`,
			`SELECT * FROM auth.users`, `CREATE ROLE foundation_denied`,
		} {
			if _, err := db.Pool.Exec(ctx, sql); err == nil {
				t.Fatalf("runtime unexpectedly allowed %s", sql)
			}
		}
		for _, role := range []string{"anon", "authenticated", "service_role"} {
			tx, err := admin.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = tx.Exec(ctx, "SET LOCAL ROLE "+role); err != nil {
				t.Fatal(err)
			}
			if _, err = tx.Exec(ctx, `SELECT * FROM app.foundation_fixture`); err == nil {
				t.Fatalf("%s can access app", role)
			}
			if err = tx.Rollback(ctx); err != nil {
				t.Fatal(err)
			}
		}
		// Explicitly grant only this disposable fixture; future features must grant
		// their own privileges and introduce their separately reviewed RLS policies.
		exec(`SET ROLE kami_migrator; GRANT SELECT ON app.foundation_fixture TO kami_api;
   INSERT INTO app.foundation_fixture VALUES(74, 'synthetic'); RESET ROLE`)
		conn, err := db.Pool.Acquire(ctx)
		if err != nil {
			t.Fatal(err)
		}
		tx, err := conn.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec(ctx, `SET LOCAL search_path = app; CREATE TEMP VIEW fixture AS SELECT * FROM app.foundation_fixture`); err != nil {
			t.Fatal(err)
		}
		got, err := sqlctest.New(tx).GetFixture(ctx, 74)
		if err != nil || got.Label != "synthetic" {
			t.Fatalf("generated query result %v, %v", got, err)
		}
		if err = tx.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
		conn.Release()
	})
	t.Run("bounded pool exhaustion", func(t *testing.T) {
		held, err := db.Pool.Acquire(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer held.Release()
		start := time.Now()
		if db.Ready(ctx) == nil {
			t.Fatal("ready with exhausted pool")
		}
		if time.Since(start) > time.Second {
			t.Fatal("readiness not bounded")
		}
	})
	t.Run("startup failures", func(t *testing.T) {
		bad := cfg
		bad.URL = strings.Replace(runtimeURL, "kami-local-only", "wrong-synthetic", 1)
		if p, err := database.Open(ctx, bad); err == nil {
			p.Close()
			t.Fatal("accepted wrong credentials")
		}
		bad.URL = adminURL
		if p, err := database.Open(ctx, bad); err == nil {
			p.Close()
			t.Fatal("accepted admin role")
		}
		canceled, stop := context.WithCancel(ctx)
		stop()
		if p, err := database.Open(canceled, cfg); err == nil {
			p.Close()
			t.Fatal("ignored cancellation")
		}
	})
	t.Run("HTTP readiness loss recovery and liveness", func(t *testing.T) {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		srv := server.New(config.Config{ShutdownTimeout: time.Second}, graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{}}), slog.New(slog.NewTextHandler(io.Discard, nil)), db)
		runCtx, stop := context.WithCancel(ctx)
		defer stop()
		done := make(chan error, 1)
		go func() { done <- srv.Serve(runCtx, listener) }()
		client := &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{DisableKeepAlives: true}}
		status := func(path string, want int) {
			t.Helper()
			res, err := client.Get("http://" + listener.Addr().String() + path)
			if err != nil {
				t.Fatal(err)
			}
			io.Copy(io.Discard, res.Body)
			res.Body.Close()
			if res.StatusCode != want {
				t.Fatalf("%s = %d want %d", path, res.StatusCode, want)
			}
		}
		status("/readyz", 200)
		exec(`ALTER ROLE kami_api NOLOGIN; SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='kami_api'`)
		defer exec(`ALTER ROLE kami_api LOGIN`)
		db.Pool.Reset()
		status("/readyz", 503)
		status("/healthz", 200)
		exec(`ALTER ROLE kami_api LOGIN`)
		status("/readyz", 200)
		stop()
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	})
	db.Close()
	if db.Pool.Stat().TotalConns() != 0 || db.Ready(ctx) == nil {
		t.Fatal("pool not closed")
	}
}
