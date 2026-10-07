package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgproto3"
)

func TestDatabaseStartupReportsOnceWithoutPrivatePayloads(t *testing.T) {
	for _, stage := range []string{"authentication", "runtime-role query"} {
		t.Run(stage, func(t *testing.T) {
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			finished := make(chan error, 1)
			go func() { finished <- rejectStartup(listener, stage) }()

			t.Setenv("API_ADDR", "127.0.0.1:8080")
			t.Setenv("API_SHUTDOWN_TIMEOUT", "5s")
			t.Setenv("DATABASE_URL", fmt.Sprintf("postgres://kami_api:synthetic-private-password@%s/private_database?sslmode=disable", listener.Addr()))
			t.Setenv("DATABASE_MAX_CONNS", "1")
			t.Setenv("DATABASE_TIMEOUT", "2s")
			output, err := os.CreateTemp(t.TempDir(), "startup-log")
			if err != nil {
				t.Fatal(err)
			}
			defer output.Close()
			// Capture both the owning boundary and the default logger so a database-layer
			// regression cannot escape the duplicate/payload assertions.
			originalStderr, originalLogger := os.Stderr, slog.Default()
			os.Stderr = output
			slog.SetDefault(slog.New(slog.NewJSONHandler(output, nil)))
			defer func() { os.Stderr = originalStderr; slog.SetDefault(originalLogger) }()
			if code := run(); code != 1 {
				t.Fatalf("exit code = %d", code)
			}
			select {
			case err := <-finished:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("synthetic server did not finish")
			}
			logs, err := os.ReadFile(output.Name())
			if err != nil {
				t.Fatal(err)
			}
			lines := strings.Split(strings.TrimSpace(string(logs)), "\n")
			if len(lines) != 1 {
				t.Fatalf("expected one startup event, got %d", len(lines))
			}
			var event map[string]any
			if err := json.Unmarshal(logs, &event); err != nil {
				t.Fatal(err)
			}
			if event["level"] != "ERROR" || event["msg"] != "database startup failed" || event["operation"] != "database.startup" {
				t.Fatalf("missing safe classification: %v", event)
			}
			for _, private := range []string{"synthetic-private-password", "private_database", listener.Addr().String(), "synthetic-server-secret", "synthetic-sql", "28P01", "XX000", "postgres://"} {
				if strings.Contains(string(logs), private) {
					t.Fatalf("startup logs exposed synthetic private content: %s", private)
				}
			}
			if len(event) != 4 {
				t.Fatalf("unexpected diagnostic fields: %v", event)
			}
		})
	}
}

// rejectStartup speaks only enough PostgreSQL protocol to inject representative
// private dependency failures through the real pgx startup path. No database or
// real credentials are used. Every connection and goroutine has a bounded owner.
func rejectStartup(listener net.Listener, stage string) error {
	conn, err := listener.Accept()
	if err != nil {
		return err
	}
	defer conn.Close()
	if err := conn.SetDeadline(time.Now().Add(4 * time.Second)); err != nil {
		return err
	}
	backend := pgproto3.NewBackend(conn, conn)
	if _, err := backend.ReceiveStartupMessage(); err != nil {
		return err
	}
	failure := &pgproto3.ErrorResponse{Severity: "FATAL", Code: "28P01", Message: "synthetic-server-secret", Detail: "synthetic-private-password", InternalQuery: "synthetic-sql"}
	if stage == "authentication" {
		backend.Send(failure)
		return backend.Flush()
	}
	backend.Send(&pgproto3.AuthenticationOk{})
	backend.Send(&pgproto3.ReadyForQuery{TxStatus: 'I'})
	if err := backend.Flush(); err != nil {
		return err
	}
	failure.Code = "XX000"
	for {
		message, err := backend.Receive()
		if err != nil {
			return err
		}
		switch message.(type) {
		case *pgproto3.Parse:
			backend.Send(failure)
			if err := backend.Flush(); err != nil {
				return err
			}
		case *pgproto3.Sync:
			backend.Send(&pgproto3.ReadyForQuery{TxStatus: 'I'})
			return backend.Flush()
		}
	}
}
