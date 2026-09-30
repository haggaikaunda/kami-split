//go:build integration

package database_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/jackc/pgx/v5"
)

func groupFixture(t *testing.T) *identityFixture {
	t.Helper()
	f := newIdentityFixture(t)
	db, err := database.Open(f.ctx, database.Config{URL: os.Getenv("TEST_DATABASE_URL"), MaxConns: 6, Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	f.db = db
	t.Cleanup(db.Close)
	t.Cleanup(func() {
		_, err := f.admin.Exec(context.Background(), `BEGIN; SET LOCAL ROLE kami_migrator;
   CREATE TEMP TABLE created_group_cleanup AS SELECT group_id FROM app.group_creation_attempts WHERE creator_user_id='75000000-0000-4000-8000-000000000002' AND group_id IS NOT NULL;
   DELETE FROM app.group_creation_attempts WHERE creator_user_id='75000000-0000-4000-8000-000000000002';
   DELETE FROM app.group_trip WHERE group_id IN (SELECT group_id FROM created_group_cleanup);
   DELETE FROM app.memberships WHERE group_id IN (SELECT group_id FROM created_group_cleanup);
   DELETE FROM app.groups WHERE id IN (SELECT group_id FROM created_group_cleanup);
   DROP TABLE created_group_cleanup; COMMIT;`)
		if err != nil {
			t.Errorf("group cleanup: %v", err)
		}
	})
	return f
}
func groupInput(f *identityFixture, n int) database.GroupCreationInput {
	return database.GroupCreationInput{OperationKey: f.id(100 + n), Name: "  Journey\t\r\n", Kind: "TRIP", Trip: &database.GroupTripInput{Destination: "  京都 🌏  ", StartDate: "2024-02-29", EndDate: "2024-02-29"}}
}
func requireCreation(t *testing.T, f *identityFixture, input database.GroupCreationInput, state string) database.GroupCreationResult {
	t.Helper()
	result, err := f.db.CreateGroup(f.ctx, f.id(2), input)
	if err != nil || result.State != state {
		t.Fatalf("creation=%+v err=%v want %s", result, err, state)
	}
	return result
}
func rawCreation(ctx context.Context, tx pgx.Tx, key, name, kind string, trip any) (database.GroupCreationResult, error) {
	var data []byte
	var result database.GroupCreationResult
	err := tx.QueryRow(ctx, `SELECT app.create_group($1,$2,$3,$4::jsonb)`, key, name, kind, trip).Scan(&data)
	if err == nil {
		err = json.Unmarshal(data, &result)
	}
	return result, err
}

func TestGroupCreationAtomicAndRecovery(t *testing.T) {
	f := groupFixture(t)
	input := groupInput(f, 1)
	first := requireCreation(t, f, input, "COMPLETED")
	if first.GroupID == "" || first.OwnerMembershipID == "" || first.CreatedAt.IsZero() {
		t.Fatal("missing receipt")
	}
	if err := f.db.WithIdentity(f.ctx, f.id(2), func(tx pgx.Tx) error {
		var total, revision, allocations int64
		if err := tx.QueryRow(f.ctx, `SELECT coalesce(sum(total_minor),0),coalesce(max(revision),0),(SELECT count(*) FROM app.allocations WHERE group_id=$1) FROM app.expenses WHERE group_id=$1`, first.GroupID).Scan(&total, &revision, &allocations); err != nil {
			return err
		}
		if total != 0 || revision != 0 || allocations != 0 {
			t.Errorf("new group has synthetic ledger: %d %d %d", total, revision, allocations)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	input.Name = "Journey"
	replay := requireCreation(t, f, input, "COMPLETED")
	if replay.GroupID != first.GroupID || replay.OwnerMembershipID != first.OwnerMembershipID || !replay.CreatedAt.Equal(first.CreatedAt) {
		t.Fatal("not original result")
	}
	input.Name = "changed"
	requireCreation(t, f, input, "OPERATION_CONFLICT")
	input.Name = "Journey"
	input.OperationKey = f.id(102)
	second := requireCreation(t, f, input, "COMPLETED")
	if second.GroupID == first.GroupID {
		t.Fatal("distinct key deduplicated same names")
	}
	var count int
	var destination, start, end, currency, name string
	err := f.admin.QueryRow(f.ctx, `SELECT g.name,g.currency,t.destination,t.start_date::text,t.end_date::text,(SELECT count(*) FROM app.memberships m WHERE m.group_id=g.id AND m.active) FROM app.groups g JOIN app.group_trip t ON t.group_id=g.id WHERE g.id=$1`, first.GroupID).Scan(&name, &currency, &destination, &start, &end, &count)
	if err != nil || count != 1 || name != "Journey" || currency != "USD" || destination != "  京都 🌏  " || start != "2024-02-29" || end != start {
		t.Fatalf("metadata count=%d %q %q %q %q %q err=%v", count, name, currency, destination, start, end, err)
	}
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.groups SET name='renamed' WHERE id='%s'; RESET ROLE`, first.GroupID))
	result, err := f.db.GroupCreationOperation(f.ctx, f.id(2), f.id(101))
	if err != nil || result.GroupID != first.GroupID {
		t.Fatalf("original receipt=%+v %v", result, err)
	}
	// Owner transfer/removal does not make the original receipt publicly recoverable.
	f.exec(fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; INSERT INTO app.memberships(id,group_id,user_id) VALUES('%s','%s','%s'); UPDATE app.groups SET owner_membership_id='%s' WHERE id='%s'; UPDATE app.memberships SET active=false WHERE id='%s'; COMMIT`, f.id(201), first.GroupID, f.id(1), f.id(201), first.GroupID, first.OwnerMembershipID))
	input.OperationKey = f.id(101)
	requireCreation(t, f, input, "NOT_FOUND")
	result, err = f.db.GroupCreationOperation(f.ctx, f.id(2), input.OperationKey)
	if err != nil || result.State != "NOT_FOUND" || result.GroupID != "" || result.OwnerMembershipID != "" {
		t.Fatalf("receipt disclosure=%+v %v", result, err)
	}
	// This probes the SQL helper directly, independently of wrapper masking.
	err = f.db.WithIdentity(f.ctx, f.id(2), func(tx pgx.Tx) error {
		got, e := rawCreation(f.ctx, tx, input.OperationKey, "Journey", "TRIP", `{"destination":"  京都 🌏  ","startDate":"2024-02-29","endDate":"2024-02-29"}`)
		if e == nil && (got.State != "NOT_FOUND" || got.GroupID != "") {
			t.Errorf("SQL leaked %+v", got)
		}
		return e
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestGroupCreationValidationAndCanonicalInput(t *testing.T) {
	f := groupFixture(t)
	cases := []struct {
		name   string
		change func(*database.GroupCreationInput)
		state  string
	}{
		{"ordinary", func(i *database.GroupCreationInput) { i.Kind = "ORDINARY"; i.Trip = nil }, "COMPLETED"},
		{"missing trip", func(i *database.GroupCreationInput) { i.Trip = nil }, "REJECTED"},
		{"ordinary metadata", func(i *database.GroupCreationInput) { i.Kind = "ORDINARY" }, "REJECTED"},
		{"empty name", func(i *database.GroupCreationInput) { i.Name = " \t\r\n" }, "REJECTED"},
		{"120 scalars", func(i *database.GroupCreationInput) { i.Name = strings.Repeat("🌏", 120) }, "COMPLETED"},
		{"121 scalars", func(i *database.GroupCreationInput) { i.Name = strings.Repeat("🌏", 121) }, "REJECTED"},
		{"200 scalars", func(i *database.GroupCreationInput) { i.Trip.Destination = strings.Repeat("🌏", 200) }, "COMPLETED"},
		{"201 scalars", func(i *database.GroupCreationInput) { i.Trip.Destination = strings.Repeat("🌏", 201) }, "REJECTED"},
		{"reverse dates", func(i *database.GroupCreationInput) { i.Trip.EndDate = "2024-02-28" }, "REJECTED"},
		{"date range", func(i *database.GroupCreationInput) { i.Trip.StartDate = "0001-01-01"; i.Trip.EndDate = "9999-12-31" }, "COMPLETED"},
	}
	for n, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := groupInput(f, 10+n)
			tc.change(&input)
			got := requireCreation(t, f, input, tc.state)
			replay := requireCreation(t, f, input, tc.state)
			if got.State == "REJECTED" {
				if len(got.FieldErrors) == 0 || len(replay.FieldErrors) != len(got.FieldErrors) {
					t.Fatal("missing durable rejection")
				}
				input.Name = "correction"
				requireCreation(t, f, input, "OPERATION_CONFLICT")
			}
		})
	}
	// Missing/null/empty destination are one canonical input, dates do not depend
	// on the database timezone or DateStyle.
	for _, trip := range []string{`{"startDate":"2026-01-01","endDate":"2026-01-01"}`, `{"destination":null,"startDate":"2026-01-01","endDate":"2026-01-01"}`, `{"destination":"","startDate":"2026-01-01","endDate":"2026-01-01"}`} {
		err := f.db.WithIdentity(f.ctx, f.id(2), func(tx pgx.Tx) error {
			if _, e := tx.Exec(f.ctx, `SET LOCAL TIME ZONE 'Pacific/Honolulu'; SET LOCAL DateStyle='SQL, DMY'`); e != nil {
				return e
			}
			got, e := rawCreation(f.ctx, tx, f.id(150), " dates ", "TRIP", trip)
			if e == nil && got.State != "COMPLETED" {
				t.Errorf("canonical result=%+v", got)
			}
			return e
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	for n, trip := range []string{`{"startDate":"2026-02-29","endDate":"2026-03-01"}`, `{"startDate":"0000-01-01","endDate":"2026-03-01"}`, `{"startDate":"2026-01-01","endDate":"2026-01-01","destination":22}`, `{"startDate":"2026-01-01","endDate":"2026-01-01","destination":"\ud800"}`, `{"startDate":"2026-01-01","endDate":"2026-01-01","destination":"\u0000"}`} {
		key := f.id(160 + n)
		err := f.db.WithIdentity(f.ctx, f.id(2), func(tx pgx.Tx) error { _, e := rawCreation(f.ctx, tx, key, "bad", "TRIP", trip); return e })
		if err == nil {
			t.Fatal("accepted malformed scalar")
		}
		got, err := f.db.GroupCreationOperation(f.ctx, f.id(2), key)
		if err != nil || got.State != "NOT_STARTED" {
			t.Fatalf("malformed reserved key %+v %v", got, err)
		}
	}
}

func TestGroupCreationAuthorityAndGrants(t *testing.T) {
	f := groupFixture(t)
	input := groupInput(f, 1)
	for _, actor := range []int{1, 3, 99} {
		if _, err := f.db.CreateGroup(f.ctx, f.id(actor), input); !errors.Is(err, database.ErrGroupCreationForbidden) {
			t.Fatalf("actor %d error %v", actor, err)
		}
		if _, err := f.db.GroupCreationOperation(f.ctx, f.id(actor), input.OperationKey); !errors.Is(err, database.ErrGroupCreationForbidden) {
			t.Fatalf("actor probe %d %v", actor, err)
		}
	}
	// Creator eligibility is independent of household membership and Auth email.
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator; SELECT app.household_lifecycle_lock(ARRAY(SELECT id FROM app.users ORDER BY id)); UPDATE app.memberships SET active=false WHERE id='%s'; RESET ROLE; UPDATE auth.users SET email='changed@example.invalid' WHERE id='%s'`, f.id(22), f.id(2)))
	result := requireCreation(t, f, input, "COMPLETED")
	for _, query := range []string{`INSERT INTO app.groups(id,name,owner_membership_id) VALUES(gen_random_uuid(),'denied',gen_random_uuid())`, `INSERT INTO app.memberships(id,group_id,user_id) VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid())`, `INSERT INTO app.group_trip VALUES(gen_random_uuid(),'x','2026-01-01','2026-01-01')`, `SELECT * FROM app.group_creation_attempts`, `SELECT app.group_creator_lock()`} {
		if _, err := database.IntegrationPool(f.db).Exec(f.ctx, query); err == nil {
			t.Fatalf("runtime allowed %s", query)
		}
	}
	for _, role := range []string{"anon", "authenticated", "service_role"} {
		tx, err := f.admin.Begin(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		_, err = tx.Exec(f.ctx, "SET LOCAL ROLE "+role)
		if err == nil {
			_, err = tx.Exec(f.ctx, `SELECT app.create_group($1,'x','ORDINARY',NULL)`, f.id(199))
		}
		_ = tx.Rollback(f.ctx)
		if err == nil {
			t.Fatalf("browser role %s allowed", role)
		}
	}
	f.reject(fmt.Sprintf(`INSERT INTO app.group_trip VALUES('%s','','2026-01-01','2026-01-01')`, f.id(11)))
	f.reject(fmt.Sprintf(`UPDATE app.installation SET household_group_id='%s'`, result.GroupID))
	var unsafe int
	if err := f.admin.QueryRow(f.ctx, `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN ('create_group','group_creation_operation','group_creator_lock','group_creation_result','trip_household_guard','household_trip_guard') AND NOT ('search_path=pg_catalog, pg_temp'=ANY(p.proconfig) OR 'search_path=pg_catalog,pg_temp'=ANY(p.proconfig))`).Scan(&unsafe); err != nil || unsafe != 0 {
		t.Fatalf("unsafe search path %d %v", unsafe, err)
	}
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.users SET enabled=false WHERE id='%s'; RESET ROLE`, f.id(2)))
	if _, err := f.db.GroupCreationOperation(f.ctx, f.id(2), input.OperationKey); !errors.Is(err, database.ErrGroupCreationForbidden) {
		t.Fatalf("disabled recovery %v", err)
	}
}

func TestGroupCreationRollbacks(t *testing.T) {
	f := groupFixture(t)
	f.exec(`SET ROLE kami_migrator; CREATE FUNCTION app.group_creation_test_fail() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN IF current_setting('app.test_group_failure',true)=TG_TABLE_NAME THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$; RESET ROLE`)
	t.Cleanup(func() {
		f.exec(`SET ROLE kami_migrator; DROP FUNCTION app.group_creation_test_fail() CASCADE; RESET ROLE`)
	})
	for _, table := range []string{"group_creation_attempts", "groups", "memberships", "group_trip"} {
		f.exec(`SET ROLE kami_migrator; CREATE TRIGGER group_creation_test_fail AFTER INSERT ON app.` + table + ` FOR EACH ROW EXECUTE FUNCTION app.group_creation_test_fail(); RESET ROLE`)
	}
	for n, table := range []string{"group_creation_attempts", "groups", "memberships", "group_trip"} {
		t.Run(table, func(t *testing.T) {
			err := f.db.WithIdentity(f.ctx, f.id(2), func(tx pgx.Tx) error {
				if _, e := tx.Exec(f.ctx, `SELECT set_config('app.test_group_failure',$1,true)`, table); e != nil {
					return e
				}
				_, e := rawCreation(f.ctx, tx, f.id(180+n), "rollback", "TRIP", `{"startDate":"2026-01-01","endDate":"2026-01-01"}`)
				return e
			})
			if err == nil {
				t.Fatal("injection did not fail")
			}
			got, err := f.db.GroupCreationOperation(f.ctx, f.id(2), f.id(180+n))
			if err != nil || got.State != "NOT_STARTED" {
				t.Fatalf("partial attempt %+v %v", got, err)
			}
			var groups int
			if err := f.admin.QueryRow(f.ctx, `SELECT count(*) FROM app.groups WHERE name='rollback'`).Scan(&groups); err != nil || groups != 0 {
				t.Fatalf("orphan groups %d %v", groups, err)
			}
		})
	}
}

func creationTx(t *testing.T, f *identityFixture) (pgx.Tx, int) {
	t.Helper()
	tx, err := database.IntegrationPool(f.db).BeginTx(f.ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	var pid int
	if err := tx.QueryRow(f.ctx, `SELECT pg_backend_pid() FROM (SELECT set_config('app.verified_sub',$1,true)) s`, f.id(2)).Scan(&pid); err != nil {
		t.Fatal(err)
	}
	return tx, pid
}
func waitCreationBlocked(t *testing.T, f *identityFixture, pid int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var blocked bool
		if err := f.admin.QueryRow(f.ctx, `SELECT cardinality(pg_blocking_pids($1))>0`, pid).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("operation did not reach expected database lock")
}
func TestGroupCreationConcurrentRetryAndLostResponse(t *testing.T) {
	f := groupFixture(t)
	first, _ := creationTx(t, f)
	original, err := rawCreation(f.ctx, first, f.id(101), "Together", "ORDINARY", nil)
	if err != nil {
		t.Fatal(err)
	}
	observation, err := f.db.GroupCreationOperation(f.ctx, f.id(2), f.id(101))
	if err != nil || observation.State != "NOT_STARTED" {
		t.Fatalf("in-flight lookup %+v %v", observation, err)
	}
	second, pid := creationTx(t, f)
	type answer struct {
		result database.GroupCreationResult
		err    error
	}
	done := make(chan answer, 1)
	go func() {
		result, err := rawCreation(f.ctx, second, f.id(101), "\t Together \r\n", "ORDINARY", nil)
		done <- answer{result, err}
	}()
	waitCreationBlocked(t, f, pid)
	if err := first.Commit(f.ctx); err != nil {
		t.Fatal(err)
	} // Treat the successful response as lost.
	got := <-done
	if got.err != nil || got.result.GroupID != original.GroupID {
		t.Fatalf("serialized replay %+v %v", got.result, got.err)
	}
	if err := second.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	input := database.GroupCreationInput{OperationKey: f.id(101), Name: "Together", Kind: "ORDINARY"}
	replay := requireCreation(t, f, input, "COMPLETED")
	if replay.GroupID != original.GroupID {
		t.Fatal("lost-response replay duplicated")
	}
	var count int
	if err := f.admin.QueryRow(f.ctx, `SELECT count(*) FROM app.groups WHERE name='Together'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("effects=%d %v", count, err)
	}
}
func TestGroupCreationAuthorizationRaces(t *testing.T) {
	changes := []struct{ name, sql string }{
		{"disable", `UPDATE app.users SET enabled=false WHERE id='75000000-0000-4000-8000-000000000002'`},
		{"designation", `UPDATE app.installation SET group_creator_user_id='75000000-0000-4000-8000-000000000003'`},
	}
	for _, change := range changes {
		t.Run(change.name+" wins", func(t *testing.T) {
			f := groupFixture(t)
			adminTx, err := f.admin.Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer adminTx.Rollback(context.Background())
			if _, err := adminTx.Exec(f.ctx, "SET LOCAL ROLE kami_migrator; "+change.sql); err != nil {
				t.Fatal(err)
			}
			tx, pid := creationTx(t, f)
			done := make(chan error, 1)
			go func() { _, err := rawCreation(f.ctx, tx, f.id(101), "denied", "ORDINARY", nil); done <- err }()
			waitCreationBlocked(t, f, pid)
			if err := adminTx.Commit(f.ctx); err != nil {
				t.Fatal(err)
			}
			if err := <-done; err == nil {
				t.Fatal("stale authority created group")
			}
			_ = tx.Rollback(f.ctx)
			var attempts int
			if err := f.admin.QueryRow(f.ctx, `SELECT count(*) FROM app.group_creation_attempts`).Scan(&attempts); err != nil || attempts != 0 {
				t.Fatalf("denied attempt retained %d %v", attempts, err)
			}
		})
		t.Run("creation precedes "+change.name, func(t *testing.T) {
			f := groupFixture(t)
			tx, _ := creationTx(t, f)
			result, err := rawCreation(f.ctx, tx, f.id(101), "committed", "ORDINARY", nil)
			if err != nil {
				t.Fatal(err)
			}
			operator, err := pgx.Connect(f.ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
			if err != nil {
				t.Fatal(err)
			}
			defer operator.Close(context.Background())
			var pid int
			if err := operator.QueryRow(f.ctx, `SELECT pg_backend_pid()`).Scan(&pid); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() {
				_, err := operator.Exec(f.ctx, "SET ROLE kami_migrator; "+change.sql+"; RESET ROLE")
				done <- err
			}()
			waitCreationBlocked(t, f, pid)
			if err := tx.Commit(f.ctx); err != nil {
				t.Fatal(err)
			}
			if err := <-done; err != nil {
				t.Fatal(err)
			}
			if _, err := f.db.GroupCreationOperation(f.ctx, f.id(2), f.id(101)); !errors.Is(err, database.ErrGroupCreationForbidden) {
				t.Fatalf("grant-loss recovery %v", err)
			}
			var exists bool
			if err := f.admin.QueryRow(f.ctx, `SELECT EXISTS(SELECT FROM app.groups WHERE id=$1)`, result.GroupID).Scan(&exists); err != nil || !exists {
				t.Fatalf("committed result missing %v", err)
			}
			if change.name == "designation" {
				got, err := f.db.GroupCreationOperation(f.ctx, f.id(3), f.id(101))
				if err != nil || got.State != "NOT_STARTED" || got.GroupID != "" {
					t.Fatalf("new designated actor probed old receipt %+v %v", got, err)
				}
			}
		})
	}
}
