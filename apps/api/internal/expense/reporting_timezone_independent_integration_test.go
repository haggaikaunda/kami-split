//go:build integration

package expense_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
	"github.com/haggaikaunda/kami-split/apps/api/internal/reportingtimezone"
	"github.com/haggaikaunda/kami-split/apps/api/internal/server"
	"github.com/jackc/pgx/v5"
)

func independentTimezoneFixture(t *testing.T) *expenseFixture {
	t.Helper()
	f := newExpenseFixture(t)
	t.Cleanup(func() {
		timezoneFixtureOwner(t, f, func(ctx context.Context, tx pgx.Tx) error {
			for _, table := range []string{"reporting_timezone_attempts", "reporting_timezones"} {
				if _, err := tx.Exec(ctx, `DELETE FROM app.`+table+` WHERE owner_id IN ($1,$2)`, f.id(101), f.id(102)); err != nil {
					return err
				}
			}
			return nil
		})
	})
	return f
}

func TestIndependentTimezoneDurableFailuresAndCanonicalRetries(t *testing.T) {
	f := independentTimezoneFixture(t)
	init := func(actor int, key string, zone any) map[string]any {
		return timezoneRequest(t, f, actor, timezoneInitialize, "initializeReportingTimezone", map[string]any{"key": key, "zone": zone})
	}
	update := func(key, zone, version string) map[string]any {
		return timezoneRequest(t, f, 2, timezoneUpdate, "updateReportingTimezone", map[string]any{"key": key, "zone": zone, "version": version})
	}
	recover := func(key, kind string) map[string]any {
		return timezoneRequest(t, f, 2, timezoneRecover, "reportingTimezoneAttempt", map[string]any{"key": key, "kind": kind})
	}
	missing, invalid, initialized := uuid.NewString(), uuid.NewString(), uuid.NewString()
	requireTimezoneCode(t, update(missing, "Europe/Paris", "1"), "NOT_INITIALIZED")
	requireTimezoneCode(t, init(2, invalid, " UTC "), "INVALID_INPUT")
	requireTimezone(t, init(2, initialized, nil), "UTC", "1")
	// Null and UTC are the same canonical initialization input, even on retry.
	requireTimezone(t, init(2, initialized, "UTC"), "UTC", "1")
	requireTimezoneCode(t, recover(missing, "UPDATE"), "NOT_INITIALIZED")
	requireTimezoneCode(t, update(missing, "Europe/Paris", "1"), "NOT_INITIALIZED")
	requireTimezoneCode(t, recover(invalid, "INITIALIZE"), "INVALID_INPUT")
	requireTimezoneCode(t, init(2, invalid, "Europe/Paris"), "ATTEMPT_MISMATCH")
	// Operation kind and actor are independent namespaces for a client-known UUID.
	requireTimezone(t, update(initialized, "UTC", "1"), "UTC", "2")
	requireTimezone(t, init(1, initialized, "Asia/Tokyo"), "Asia/Tokyo", "1")
	requireTimezone(t, recover(initialized, "INITIALIZE"), "UTC", "1")
	requireTimezone(t, recover(initialized, "UPDATE"), "UTC", "2")
	for _, version := range []any{0, "0", "01", "+2", "2.0", "9007199254740992"} {
		key := uuid.NewString()
		_, body, err := groupHTTP(f, 2, timezoneUpdate, map[string]any{"key": key, "zone": "Europe/Paris", "version": version})
		if err != nil {
			t.Fatal(err)
		}
		var response struct{ Errors []any }
		if err := json.Unmarshal(body, &response); err != nil || len(response.Errors) == 0 {
			t.Fatalf("invalid wire version accepted: %v: %s", version, body)
		}
		requireTimezoneCode(t, recover(key, "UPDATE"), "NOT_FOUND")
	}
	requireTimezone(t, timezoneRequest(t, f, 2, timezoneRead, "reportingTimezone", nil), "UTC", "2")
	// All selected scalar inputs must pass preflight before an earlier mutation
	// can commit. A malformed later preference version must preserve that boundary.
	query := fmt.Sprintf(`mutation {
 first:updateReportingTimezone(attemptId:"%s",timezone:"Europe/Paris",expectedVersion:"2") { __typename }
 second:updateReportingTimezone(attemptId:"%s",timezone:"UTC",expectedVersion:"01") { __typename }
}`, uuid.NewString(), uuid.NewString())
	_, body, err := groupHTTP(f, 2, query, nil)
	if err != nil {
		t.Fatal(err)
	}
	var response struct{ Errors []any }
	if err := json.Unmarshal(body, &response); err != nil || len(response.Errors) == 0 {
		t.Fatalf("malformed later scalar accepted: %s", body)
	}
	requireTimezone(t, timezoneRequest(t, f, 2, timezoneRead, "reportingTimezone", nil), "UTC", "2")
}

func TestIndependentTimezoneDroppedResponseAndFreshPoolRecovery(t *testing.T) {
	f := independentTimezoneFixture(t)
	key := uuid.NewString()
	// Forward the write fully, then close the client connection without delivering
	// its result. No fixture assertion stands in for an actual transport failure.
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, f.endpoint.URL+"/graphql", r.Body)
		if err != nil {
			t.Error(err)
			return
		}
		request.Header = r.Header.Clone()
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Error(err)
			return
		}
		defer response.Body.Close()
		if _, err := io.Copy(io.Discard, response.Body); err != nil {
			t.Error(err)
		}
		connection, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		_ = connection.Close()
	}))
	t.Cleanup(proxy.Close)
	payload, err := json.Marshal(map[string]any{"query": timezoneInitialize, "variables": map[string]any{"key": key, "zone": "Pacific/Auckland"}})
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequestWithContext(f.ctx, http.MethodPost, proxy.URL, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+f.token(2))
	if response, err := http.DefaultClient.Do(request); err == nil {
		_ = response.Body.Close()
		t.Fatal("proxy delivered a response instead of simulating response loss")
	}
	db, err := database.Open(f.ctx, database.Config{URL: f.runtime, MaxConns: 2, Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	cfg, err := config.Load(os.LookupEnv)
	if err != nil {
		t.Fatal(err)
	}
	fresh := server.NewWithAuthentication(cfg, graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{ReportingTimezones: reportingtimezone.New(db)}}), slog.New(slog.NewTextHandler(io.Discard, nil)), f.verifier)
	f.endpoint = httptest.NewServer(f.verifier.Protect(fresh.Handler()))
	t.Cleanup(f.endpoint.Close)
	requireTimezone(t, timezoneRequest(t, f, 2, timezoneRecover, "reportingTimezoneAttempt", map[string]any{"key": key, "kind": "INITIALIZE"}), "Pacific/Auckland", "1")
	requireTimezone(t, timezoneRequest(t, f, 2, timezoneInitialize, "initializeReportingTimezone", map[string]any{"key": key, "zone": "Pacific/Auckland"}), "Pacific/Auckland", "1")
	requireTimezone(t, timezoneRequest(t, f, 2, timezoneRead, "reportingTimezone", nil), "Pacific/Auckland", "1")
}

func TestIndependentTimezoneRevocationFencesWaitingWrite(t *testing.T) {
	f := independentTimezoneFixture(t)
	requireTimezone(t, timezoneRequest(t, f, 2, timezoneInitialize, "initializeReportingTimezone", map[string]any{"key": uuid.NewString(), "zone": "UTC"}), "UTC", "1")
	locker, err := pgx.Connect(f.ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = locker.Close(context.Background()) })
	tx, err := locker.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(f.ctx, `SET LOCAL ROLE kami_migrator`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(f.ctx, `UPDATE app.users SET enabled=false WHERE id=$1`, f.id(102)); err != nil {
		t.Fatal(err)
	}
	pid := make(chan int, 1)
	done := make(chan error, 1)
	key := uuid.NewString()
	go func() {
		done <- f.db.WithIdentity(f.ctx, f.id(2), func(write pgx.Tx) error {
			var backend int
			if err := write.QueryRow(f.ctx, `SELECT pg_backend_pid()`).Scan(&backend); err != nil {
				return err
			}
			pid <- backend
			var code string
			var zone *string
			var version *int64
			if err := write.QueryRow(f.ctx, `SELECT * FROM app.write_reporting_timezone('UPDATE',$1,'Asia/Tokyo',1)`, key).Scan(&code, &zone, &version); err != nil {
				return err
			}
			if code != "FORBIDDEN" || zone != nil || version != nil {
				return fmt.Errorf("revoked waiting write returned %s/%v/%v", code, zone, version)
			}
			return nil
		})
	}()
	var backend int
	select {
	case backend = <-pid:
	case err := <-done:
		t.Fatalf("write did not reach its owned transaction: %v", err)
	case <-f.ctx.Done():
		t.Fatal(f.ctx.Err())
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		var blocked bool
		if err := f.admin.QueryRow(f.ctx, `SELECT cardinality(pg_blocking_pids($1)) > 0`, backend).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("write never demonstrably waited on the revocation lock")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := tx.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	// Disabling an application identity is irreversible. Inspect persisted state
	// through the fixture owner while the public surfaces must remain forbidden.
	timezoneFixtureOwner(t, f, func(ctx context.Context, tx pgx.Tx) error {
		var zone string
		var version, attempts int64
		if err := tx.QueryRow(ctx, `SELECT p.timezone,p.version,
 (SELECT count(*) FROM app.reporting_timezone_attempts a WHERE a.owner_id=p.owner_id AND a.operation='UPDATE' AND a.attempt_id=$2)
 FROM app.reporting_timezones p WHERE p.owner_id=$1`, f.id(102), key).Scan(&zone, &version, &attempts); err != nil {
			return err
		}
		if zone != "UTC" || version != 1 || attempts != 0 {
			return fmt.Errorf("revoked write changed persisted state: %s/%d, receipts=%d", zone, version, attempts)
		}
		return nil
	})
	requireTimezoneCode(t, timezoneRequest(t, f, 2, timezoneRead, "reportingTimezone", nil), "FORBIDDEN")
	requireTimezoneCode(t, timezoneRequest(t, f, 2, timezoneRecover, "reportingTimezoneAttempt", map[string]any{"key": key, "kind": "UPDATE"}), "FORBIDDEN")
}

func TestIndependentTimezoneExhaustionAndRestrictedRoles(t *testing.T) {
	f := independentTimezoneFixture(t)
	requireTimezone(t, timezoneRequest(t, f, 2, timezoneInitialize, "initializeReportingTimezone", map[string]any{"key": uuid.NewString(), "zone": "UTC"}), "UTC", "1")
	timezoneFixtureOwner(t, f, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE app.reporting_timezones SET version=9007199254740991 WHERE owner_id=$1`, f.id(102))
		return err
	})
	key := uuid.NewString()
	requireTimezoneCode(t, timezoneRequest(t, f, 2, timezoneUpdate, "updateReportingTimezone", map[string]any{"key": key, "zone": "Europe/Paris", "version": "9007199254740991"}), "CONFLICT")
	requireTimezoneCode(t, timezoneRequest(t, f, 2, timezoneRecover, "reportingTimezoneAttempt", map[string]any{"key": key, "kind": "UPDATE"}), "CONFLICT")
	requireTimezone(t, timezoneRequest(t, f, 2, timezoneRead, "reportingTimezone", nil), "UTC", "9007199254740991")
	for _, role := range []string{"anon", "authenticated", "service_role", "kami_worker"} {
		for _, signature := range []string{"app.read_reporting_timezone()", "app.read_reporting_timezone_attempt(text,uuid)", "app.write_reporting_timezone(text,uuid,text,bigint)"} {
			var allowed bool
			if err := f.admin.QueryRow(f.ctx, `SELECT has_function_privilege($1,$2,'EXECUTE')`, role, signature).Scan(&allowed); err != nil {
				t.Fatal(err)
			}
			if allowed {
				t.Fatalf("%s can execute %s", role, signature)
			}
		}
		for _, table := range []string{"app.reporting_timezones", "app.reporting_timezone_attempts"} {
			var allowed bool
			if err := f.admin.QueryRow(f.ctx, `SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE')`, role, table).Scan(&allowed); err != nil {
				t.Fatal(err)
			}
			if allowed {
				t.Fatalf("%s has direct preference/receipt privileges on %s", role, table)
			}
		}
	}
}

func TestIndependentTimezoneManagedAuthRevocation(t *testing.T) {
	f := independentTimezoneFixture(t)
	key := uuid.NewString()
	requireTimezone(t, timezoneRequest(t, f, 2, timezoneInitialize, "initializeReportingTimezone", map[string]any{"key": key, "zone": "Asia/Tokyo"}), "Asia/Tokyo", "1")
	// The identity contract requires disabling the application owner before
	// managed Auth deletion; its FK then clears the live linkage irreversibly.
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator;UPDATE app.users SET enabled=false WHERE id='%s';RESET ROLE;DELETE FROM auth.users WHERE id='%s'`, f.id(102), f.id(2)))
	requireTimezoneCode(t, timezoneRequest(t, f, 2, timezoneRead, "reportingTimezone", nil), "FORBIDDEN")
	requireTimezoneCode(t, timezoneRequest(t, f, 2, timezoneRecover, "reportingTimezoneAttempt", map[string]any{"key": key, "kind": "INITIALIZE"}), "FORBIDDEN")
	requireTimezoneCode(t, timezoneRequest(t, f, 2, timezoneInitialize, "initializeReportingTimezone", map[string]any{"key": uuid.NewString(), "zone": "UTC"}), "FORBIDDEN")
	requireTimezoneCode(t, timezoneRequest(t, f, 2, timezoneUpdate, "updateReportingTimezone", map[string]any{"key": uuid.NewString(), "zone": "UTC", "version": "1"}), "FORBIDDEN")
	timezoneFixtureOwner(t, f, func(ctx context.Context, tx pgx.Tx) error {
		var enabled, linked bool
		var zone string
		var version, attempts int64
		if err := tx.QueryRow(ctx, `SELECT u.enabled,u.live_auth_id IS NOT NULL,p.timezone,p.version,
 (SELECT count(*) FROM app.reporting_timezone_attempts a WHERE a.owner_id=u.id)
 FROM app.users u JOIN app.reporting_timezones p ON p.owner_id=u.id WHERE u.id=$1`, f.id(102)).Scan(&enabled, &linked, &zone, &version, &attempts); err != nil {
			return err
		}
		if enabled || linked || zone != "Asia/Tokyo" || version != 1 || attempts != 1 {
			return fmt.Errorf("revoked identity/state changed: enabled=%v, linked=%v, %s/%d, receipts=%d", enabled, linked, zone, version, attempts)
		}
		return nil
	})
}
