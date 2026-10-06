//go:build integration

package database_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func householdFixture(t *testing.T) *identityFixture {
	t.Helper()
	f := groupFixture(t)
	householdLifecycle(t, f, fmt.Sprintf(`UPDATE app.memberships SET active=true WHERE id='%s'`, f.id(23)))
	t.Cleanup(func() {
		f.exec(`SET ROLE kami_migrator; DELETE FROM app.household_designation_audit; UPDATE app.household_designation_guard SET version=0,state='EMPTY',first_user_id=NULL,second_user_id=NULL,proposer_user_id=NULL,first_consented=false,second_consented=false; RESET ROLE`)
	})
	return f
}
func householdLifecycle(t *testing.T, f *identityFixture, sql string) {
	t.Helper()
	f.exec(fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; SELECT app.household_lifecycle_lock(ARRAY['%s','%s','%s']::uuid[]); %s; COMMIT`, f.id(1), f.id(2), f.id(3), sql))
}
func householdHistory(t *testing.T, f *identityFixture) string {
	t.Helper()
	var history string
	f.exec(`SET ROLE kami_migrator`)
	err := f.admin.QueryRow(f.ctx, `SELECT jsonb_build_array((SELECT to_jsonb(d) FROM app.household_designation_guard d),(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM app.household_designation_audit a))::text`).Scan(&history)
	f.exec(`RESET ROLE`)
	if err != nil {
		t.Fatal(err)
	}
	return history
}

func TestHouseholdRetiredDesignationCannotAuthorizeOrMutate(t *testing.T) {
	for _, state := range []string{"EMPTY", "PENDING", "ACTIVE", "SUSPENDED", "ENDED"} {
		t.Run(state, func(t *testing.T) {
			f := householdFixture(t)
			if state != "EMPTY" {
				f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.household_designation_guard SET version=7,state='%s',first_user_id='%s',second_user_id='%s',proposer_user_id='%s',first_consented=%t,second_consented=%t; RESET ROLE`, state, f.id(2), f.id(3), f.id(1), state == "ACTIVE", state == "ACTIVE"))
			}
			before := householdHistory(t, f)
			f.exec(`RESET ROLE`)
			probes := []struct{ query, runtimeCode string }{
				{`SELECT * FROM app.household_designation_guard`, "42501"},
				{`SELECT * FROM app.household_designation_audit`, "42501"},
				{`UPDATE app.household_designation_guard SET version=version+1`, "42501"},
				{`SELECT app.household_lifecycle_lock('{}'::uuid[])`, "42501"},
				{`SELECT app.household_designation('CONSENT',7,NULL,NULL)`, "42883"},
			}
			for _, role := range []string{"kami_api", "anon", "authenticated", "service_role"} {
				for _, probe := range probes {
					var err error
					if role == "kami_api" {
						// The migration login deliberately cannot assume the API
						// role. Exercise its real authenticated connection instead.
						err = f.db.WithIdentity(f.ctx, f.id(2), func(tx pgx.Tx) error {
							_, err := tx.Exec(f.ctx, probe.query)
							return err
						})
					} else {
						err = func() error {
							tx, err := f.admin.Begin(f.ctx)
							if err != nil {
								t.Fatal(err)
							}
							defer tx.Rollback(context.Background())
							if _, err = tx.Exec(f.ctx, `SET LOCAL ROLE `+role); err != nil {
								t.Fatal(err)
							}
							_, err = tx.Exec(f.ctx, probe.query)
							return err
						}()
					}
					expected := "42501" // Browser/service roles cannot resolve app objects.
					if role == "kami_api" {
						expected = probe.runtimeCode
					}
					var pgError *pgconn.PgError
					if !errors.As(err, &pgError) || pgError.Code != expected {
						t.Fatalf("%s probe %s: wanted SQLSTATE %s, got %v", role, probe.query, expected, err)
					}
				}
			}
			var retired int
			f.exec(`SET ROLE kami_migrator`)
			err := f.admin.QueryRow(f.ctx, `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN ('household_designation','household_invalidate','household_audit')`).Scan(&retired)
			f.exec(`RESET ROLE`)
			if err != nil || retired != 0 {
				t.Fatalf("retired operations remain: %d %v", retired, err)
			}
			err = f.db.WithIdentity(f.ctx, f.id(3), func(tx pgx.Tx) error {
				var visible bool
				var state string
				if err := tx.QueryRow(f.ctx, `SELECT app.can_read_group($1),app.household_dashboard_lock()->>'state'`, f.id(11)).Scan(&visible, &state); err != nil {
					return err
				}
				if !visible || state != "COMPLETE" {
					t.Fatalf("historical relation affected current membership: %t %s", visible, state)
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			if householdHistory(t, f) != before {
				t.Fatal("read or denied command mutated historical rows")
			}
		})
	}
}

func TestHouseholdLifecyclePreservesHistoricalRowsAndPreparation(t *testing.T) {
	f := householdFixture(t)
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.household_designation_guard SET version=7,state='PENDING',first_user_id='%s',second_user_id='%s',proposer_user_id='%s'; RESET ROLE`, f.id(2), f.id(3), f.id(1)))
	before := householdHistory(t, f)
	f.reject(fmt.Sprintf(`UPDATE app.memberships SET active=false WHERE id='%s'`, f.id(23)))
	f.reject(fmt.Sprintf(`UPDATE app.groups SET owner_membership_id='%s' WHERE id='%s'`, f.id(22), f.id(11)))
	f.reject(fmt.Sprintf(`UPDATE app.installation SET household_group_id='%s'`, f.id(12)))
	householdLifecycle(t, f, fmt.Sprintf(`UPDATE app.memberships SET active=false WHERE id='%s'; UPDATE app.memberships SET active=true WHERE id='%s'; UPDATE app.groups SET owner_membership_id='%s' WHERE id='%s'`, f.id(23), f.id(23), f.id(22), f.id(11)))
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.users SET enabled=false WHERE id='%s'; UPDATE app.users SET live_auth_id=NULL WHERE id='%s'; RESET ROLE`, f.id(3), f.id(3)))
	f.exec(fmt.Sprintf(`DELETE FROM auth.users WHERE id='%s'`, f.id(3)))
	if householdHistory(t, f) != before {
		t.Fatal("membership, ownership or account lifecycle rewrote pair history")
	}
}

func TestHouseholdAccountTransitionRejectsUndiscoveredUser(t *testing.T) {
	f := householdFixture(t)
	tx, err := f.admin.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	// The first statement owns the canonical user set for this transaction. An
	// inserted identity was not locked by that statement and must force restart.
	if _, err = tx.Exec(f.ctx, fmt.Sprintf(`SET LOCAL ROLE kami_migrator; UPDATE app.users SET enabled=enabled WHERE id='%s'; RESET ROLE; INSERT INTO auth.users(id,email) VALUES('%s','undiscovered@example.invalid'); SET LOCAL ROLE kami_migrator; INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES('%s','%s','%s','Inserted'); UPDATE app.users SET enabled=false WHERE id='%s'`, f.id(1), f.id(99), f.id(99), f.id(99), f.id(99), f.id(99))); err == nil {
		t.Fatal("new user bypassed canonical account discovery")
	}
	var pgError *pgconn.PgError
	if !errors.As(err, &pgError) || pgError.Code != "40001" {
		t.Fatalf("wanted restart, got %v", err)
	}
}

func TestHouseholdCanonicalLifecycleAndAccountUserLocks(t *testing.T) {
	for _, operation := range []string{"lifecycle", "bulk_disable"} {
		t.Run(operation, func(t *testing.T) {
			f := householdFixture(t)
			held, err := f.admin.Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer held.Rollback(context.Background())
			if _, err = held.Exec(f.ctx, `SET LOCAL ROLE kami_migrator`); err != nil {
				t.Fatal(err)
			}
			if _, err = held.Exec(f.ctx, `SELECT id FROM app.users WHERE id=$1 FOR UPDATE`, f.id(1)); err != nil {
				t.Fatal(err)
			}
			writer, err := pgx.Connect(f.ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
			if err != nil {
				t.Fatal(err)
			}
			defer writer.Close(context.Background())
			done := make(chan error, 1)
			go func() {
				query := `BEGIN; SET LOCAL ROLE kami_migrator; SELECT app.household_lifecycle_lock('{}'::uuid[]); COMMIT`
				if operation == "bulk_disable" {
					query = fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.users SET enabled=false WHERE id IN ('%s','%s')`, f.id(3), f.id(1))
				}
				_, e := writer.Exec(f.ctx, query)
				done <- e
			}()
			select {
			case err := <-done:
				t.Fatalf("operation skipped first user lock: %v", err)
			case <-time.After(100 * time.Millisecond):
			}
			probe, err := pgx.Connect(f.ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
			if err != nil {
				t.Fatal(err)
			}
			defer probe.Close(context.Background())
			check, err := probe.Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer check.Rollback(context.Background())
			if _, err = check.Exec(f.ctx, `SET LOCAL ROLE kami_migrator`); err != nil {
				t.Fatal(err)
			}
			if _, err = check.Exec(f.ctx, `SELECT id FROM app.users WHERE id=$1 FOR UPDATE NOWAIT`, f.id(3)); err != nil {
				t.Fatal("later user acquired before earlier user", err)
			}
			if err = check.Rollback(f.ctx); err != nil {
				t.Fatal(err)
			}
			if err = held.Commit(f.ctx); err != nil {
				t.Fatal(err)
			}
			if err = <-done; err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestHouseholdLifecycleIsolationAndAccountOrder(t *testing.T) {
	f := householdFixture(t)
	for _, operation := range []string{"lifecycle", "account"} {
		t.Run(operation, func(t *testing.T) {
			tx, err := f.admin.BeginTx(f.ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(context.Background())
			if _, err = tx.Exec(f.ctx, `SET LOCAL ROLE kami_migrator`); err != nil {
				t.Fatal(err)
			}
			query := `SELECT app.household_lifecycle_lock('{}'::uuid[])`
			if operation == "account" {
				query = fmt.Sprintf(`UPDATE app.users SET enabled=false WHERE id='%s'`, f.id(3))
			}
			_, err = tx.Exec(f.ctx, query)
			var pgError *pgconn.PgError
			if !errors.As(err, &pgError) || pgError.Code != "25000" {
				t.Fatalf("wanted READ COMMITTED enforcement, got %v", err)
			}
		})
	}
	tx, err := f.admin.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(f.ctx, `SET LOCAL ROLE kami_migrator; SELECT app.household_lifecycle_lock('{}'::uuid[])`); err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(f.ctx, `UPDATE app.users SET enabled=false WHERE id=$1`, f.id(3))
	var pgError *pgconn.PgError
	if !errors.As(err, &pgError) || pgError.Code != "55000" {
		t.Fatalf("account transition followed group locking: %v", err)
	}
}

func TestHouseholdAccountLossWaitRevalidatesCurrentMembership(t *testing.T) {
	for _, mode := range []string{"disable", "unlink", "delete"} {
		t.Run(mode, func(t *testing.T) {
			f := householdFixture(t)
			tx, err := f.admin.Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(context.Background())
			if _, err = tx.Exec(f.ctx, `SET LOCAL ROLE kami_migrator`); err != nil {
				t.Fatal(err)
			}
			if _, err = tx.Exec(f.ctx, `UPDATE app.users SET enabled=false WHERE id=$1`, f.id(3)); err != nil {
				t.Fatal(err)
			}
			if mode == "unlink" {
				if _, err = tx.Exec(f.ctx, `UPDATE app.users SET live_auth_id=NULL WHERE id=$1`, f.id(3)); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "delete" {
				if _, err = tx.Exec(f.ctx, `RESET ROLE`); err != nil {
					t.Fatal(err)
				}
				if _, err = tx.Exec(f.ctx, `DELETE FROM auth.users WHERE id=$1`, f.id(3)); err != nil {
					t.Fatal(err)
				}
			}
			done := make(chan error, 1)
			go func() {
				done <- f.db.WithIdentity(f.ctx, f.id(2), func(read pgx.Tx) error {
					var state string
					var access bool
					if err := read.QueryRow(f.ctx, `SELECT app.household_dashboard_lock()->>'state',app.can_read_group($1)`, f.id(11)).Scan(&state, &access); err != nil {
						return err
					}
					if state != "COMPLETE" || !access {
						return fmt.Errorf("remaining member lost ledger access: %s %t", state, access)
					}
					return nil
				})
			}()
			select {
			case got := <-done:
				t.Fatalf("read bypassed current account locks: %v", got)
			case <-time.After(100 * time.Millisecond):
			}
			if err = tx.Commit(f.ctx); err != nil {
				t.Fatal(err)
			}
			if err = <-done; err != nil {
				t.Fatal(err)
			}
			err = f.db.WithIdentity(f.ctx, f.id(3), func(read pgx.Tx) error {
				var state string
				if err := read.QueryRow(f.ctx, `SELECT app.household_dashboard_lock()->>'state'`).Scan(&state); err != nil {
					return err
				}
				if state != "NOT_FOUND" {
					return fmt.Errorf("disabled or unlinked account retained access: %s", state)
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}
