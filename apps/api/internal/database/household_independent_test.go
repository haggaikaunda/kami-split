//go:build integration

package database_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/jackc/pgx/v5"
)

type householdResult struct {
	State   string `json:"state"`
	Version int64  `json:"version"`
}

func householdFixture(t *testing.T) *identityFixture {
	t.Helper()
	f := groupFixture(t)
	householdLifecycle(t, f, fmt.Sprintf(`UPDATE app.memberships SET active=true WHERE id='%s'`, f.id(23)))
	t.Cleanup(func() {
		f.exec(`SET ROLE kami_migrator; DELETE FROM app.household_designation_audit; UPDATE app.household_designation_guard SET version=0,state='EMPTY',first_user_id=NULL,second_user_id=NULL,proposer_user_id=NULL,first_consented=false,second_consented=false; RESET ROLE`)
	})
	return f
}

func householdCall(f *identityFixture, actor int, action string, version int64, first, second int) (householdResult, error) {
	var result householdResult
	var a, b any
	if first != 0 {
		a = f.id(first)
	}
	if second != 0 {
		b = f.id(second)
	}
	err := f.db.WithIdentity(f.ctx, f.id(actor), func(tx pgx.Tx) error {
		var data []byte
		if err := tx.QueryRow(f.ctx, `SELECT app.household_designation($1,$2,$3,$4)`, action, version, a, b).Scan(&data); err != nil {
			return err
		}
		return json.Unmarshal(data, &result)
	})
	return result, err
}
func householdWant(t *testing.T, f *identityFixture, actor int, action string, version int64, first, second int, state string) householdResult {
	t.Helper()
	got, err := householdCall(f, actor, action, version, first, second)
	if err != nil || got.State != state {
		t.Fatalf("actor %d %s: %+v %v; want %s", actor, action, got, err, state)
	}
	return got
}
func householdActive(t *testing.T, f *identityFixture) int64 {
	t.Helper()
	r := householdWant(t, f, 1, "PROPOSE", 0, 2, 3, "PENDING")
	householdWant(t, f, 2, "CONSENT", r.Version, 2, 3, "PENDING")
	householdWant(t, f, 3, "CONSENT", r.Version, 2, 3, "ACTIVE")
	return r.Version
}
func householdLifecycle(t *testing.T, f *identityFixture, sql string) {
	t.Helper()
	f.exec(fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; SELECT app.household_lifecycle_lock(ARRAY['%s','%s','%s']::uuid[]); %s; COMMIT`, f.id(1), f.id(2), f.id(3), sql))
}
func householdAuditCount(t *testing.T, f *identityFixture) int {
	t.Helper()
	var n int
	f.exec(`SET ROLE kami_migrator`)
	if err := f.admin.QueryRow(f.ctx, `SELECT count(*) FROM app.household_designation_audit`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	f.exec(`RESET ROLE`)
	return n
}

func TestHouseholdIndependentExactConsentAndReplacement(t *testing.T) {
	f := householdFixture(t)
	initial := householdWant(t, f, 1, "READ", 0, 0, 0, "EMPTY")
	if initial.Version != 0 {
		t.Fatal(initial)
	}
	householdWant(t, f, 2, "PROPOSE", 0, 1, 2, "NOT_FOUND") // creator is not owner
	householdWant(t, f, 1, "PROPOSE", 0, 2, 2, "NOT_FOUND")
	householdWant(t, f, 1, "PROPOSE", 0, 2, 99, "NOT_FOUND")
	r := householdWant(t, f, 1, "PROPOSE", 0, 2, 3, "PENDING")
	householdWant(t, f, 2, "CONSENT", r.Version, 1, 2, "CONFLICT")
	householdWant(t, f, 2, "CONSENT", r.Version, 2, 3, "PENDING")
	count := householdAuditCount(t, f)
	householdWant(t, f, 2, "CONSENT", r.Version, 2, 3, "PENDING")
	if householdAuditCount(t, f) != count {
		t.Fatal("duplicate consent recorded another effect")
	}
	next := householdWant(t, f, 1, "PROPOSE", r.Version, 1, 2, "PENDING")
	if next.Version <= r.Version {
		t.Fatal("replacement did not advance version")
	}
	householdWant(t, f, 2, "CONSENT", r.Version, 2, 3, "CONFLICT")
	householdWant(t, f, 2, "CONSENT", next.Version, 1, 2, "PENDING")
	householdWant(t, f, 1, "CONSENT", next.Version, 1, 2, "ACTIVE")
	var members int
	f.exec(`SET ROLE kami_migrator`)
	if err := f.admin.QueryRow(f.ctx, `SELECT count(*) FROM app.memberships WHERE group_id=$1`, f.id(11)).Scan(&members); err != nil || members != 3 {
		t.Fatal("pair changed membership", members, err)
	}
	f.exec(`RESET ROLE`)
}

func TestHouseholdIndependentThreeMembersAndTermination(t *testing.T) {
	f := householdFixture(t)
	version := householdActive(t, f)
	householdWant(t, f, 1, "END", version, 0, 0, "NOT_FOUND")
	householdWant(t, f, 1, "PROPOSE", version, 1, 2, "CONFLICT")
	householdWant(t, f, 1, "CANCEL", version, 0, 0, "CONFLICT")
	if err := f.db.WithIdentity(f.ctx, f.id(1), func(tx pgx.Tx) error {
		_, err := tx.Exec(f.ctx, `SELECT app.lock_group_read($1)`, f.id(11))
		return err
	}); err != nil {
		t.Fatal("nonpartner owner's ledger access lost", err)
	}
	householdWant(t, f, 2, "END", version, 0, 0, "ENDED")
	count := householdAuditCount(t, f)
	householdWant(t, f, 2, "END", version, 0, 0, "ENDED")
	if householdAuditCount(t, f) != count {
		t.Fatal("duplicate end added audit")
	}
}

func TestHouseholdIndependentCancelAuthority(t *testing.T) {
	for _, actor := range []int{1, 2, 3} {
		t.Run(fmt.Sprint(actor), func(t *testing.T) {
			f := householdFixture(t)
			r := householdWant(t, f, 1, "PROPOSE", 0, 2, 3, "PENDING")
			householdWant(t, f, actor, "CANCEL", r.Version, 0, 0, "CANCELLED")
			householdWant(t, f, 2, "CONSENT", r.Version, 2, 3, "CONFLICT")
		})
	}
}

func TestHouseholdIndependentOwnershipTransfer(t *testing.T) {
	for _, active := range []bool{false, true} {
		t.Run(fmt.Sprint(active), func(t *testing.T) {
			f := householdFixture(t)
			r := householdWant(t, f, 1, "PROPOSE", 0, 2, 3, "PENDING")
			householdWant(t, f, 2, "CONSENT", r.Version, 2, 3, "PENDING")
			if active {
				householdWant(t, f, 3, "CONSENT", r.Version, 2, 3, "ACTIVE")
			}
			householdLifecycle(t, f, fmt.Sprintf(`UPDATE app.groups SET owner_membership_id='%s' WHERE id='%s'`, f.id(22), f.id(11)))
			want := "CANCELLED"
			if active {
				want = "ACTIVE"
			}
			state := householdWant(t, f, 2, "READ", 0, 0, 0, want)
			if active && state.Version != r.Version {
				t.Fatal("finalized pair changed on ownership transfer")
			}
			if !active {
				householdWant(t, f, 3, "CONSENT", r.Version, 2, 3, "CONFLICT")
			}
		})
	}
}

func TestHouseholdIndependentDepartureReadmissionFreshConsent(t *testing.T) {
	f := householdFixture(t)
	version := householdActive(t, f)
	f.reject(fmt.Sprintf(`UPDATE app.memberships SET active=false WHERE id='%s'`, f.id(23)))
	householdLifecycle(t, f, fmt.Sprintf(`UPDATE app.memberships SET active=false WHERE id='%s'`, f.id(23)))
	suspended := householdWant(t, f, 2, "READ", 0, 0, 0, "SUSPENDED")
	if suspended.Version <= version {
		t.Fatal("eligibility loss retained consent version")
	}
	householdWant(t, f, 3, "READ", 0, 0, 0, "NOT_FOUND")
	householdWant(t, f, 2, "CONSENT", suspended.Version, 2, 3, "NOT_FOUND")
	householdLifecycle(t, f, fmt.Sprintf(`UPDATE app.memberships SET active=true WHERE id='%s'`, f.id(23)))
	householdWant(t, f, 2, "READ", 0, 0, 0, "SUSPENDED")
	householdWant(t, f, 2, "CONSENT", version, 2, 3, "CONFLICT")
	householdWant(t, f, 2, "CONSENT", suspended.Version, 2, 3, "SUSPENDED")
	householdWant(t, f, 3, "CONSENT", suspended.Version, 2, 3, "ACTIVE")
}

func TestHouseholdIndependentAccountLossAndRestrictedStorage(t *testing.T) {
	for _, mode := range []string{"disable", "unlink", "delete"} {
		t.Run(mode, func(t *testing.T) {
			f := householdFixture(t)
			version := householdActive(t, f)
			for _, sql := range []string{`SELECT * FROM app.household_designation_guard`, `SELECT * FROM app.household_designation_audit`, `SELECT app.household_lifecycle_lock('{}'::uuid[])`} {
				if err := f.db.WithIdentity(f.ctx, f.id(2), func(tx pgx.Tx) error { _, err := tx.Exec(f.ctx, sql); return err }); err == nil {
					t.Fatal("runtime accessed restricted storage/helper", sql)
				}
			}
			f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.users SET enabled=false WHERE id='%s'; RESET ROLE`, f.id(3)))
			if mode == "unlink" {
				f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.users SET live_auth_id=NULL WHERE id='%s'; RESET ROLE`, f.id(3)))
			}
			if mode == "delete" {
				f.exec(fmt.Sprintf(`DELETE FROM auth.users WHERE id='%s'`, f.id(3)))
			}
			state := householdWant(t, f, 2, "READ", 0, 0, 0, "SUSPENDED")
			if state.Version <= version {
				t.Fatal("account loss retained consent")
			}
			householdWant(t, f, 3, "READ", 0, 0, 0, "NOT_FOUND")
			householdWant(t, f, 2, "END", state.Version, 0, 0, "ENDED")
		})
	}
}

func TestHouseholdIndependentFirstProposalAndConsentRaces(t *testing.T) {
	f := householdFixture(t)
	type answer struct {
		r householdResult
		e error
	}
	done := make(chan answer, 2)
	for _, pair := range [][2]int{{1, 2}, {2, 3}} {
		go func(pair [2]int) {
			out, e := f.db.HouseholdDesignation(f.ctx, f.id(1), database.HouseholdDesignationInput{Action: "PROPOSE", Version: 0, FirstUserID: f.id(pair[0]), SecondUserID: f.id(pair[1])})
			r := householdResult{State: out.State, Version: out.Version}
			done <- answer{r, e}
		}(pair)
	}
	a, b := <-done, <-done
	if a.e != nil || b.e != nil || !((a.r.State == "PENDING" && b.r.State == "CONFLICT") || (b.r.State == "PENDING" && a.r.State == "CONFLICT")) {
		t.Fatalf("first designation race: %+v %+v", a, b)
	}
	next := householdWant(t, f, 1, "PROPOSE", 1, 2, 3, "PENDING")
	for _, actor := range []int{2, 3} {
		go func(actor int) { r, e := householdCall(f, actor, "CONSENT", next.Version, 2, 3); done <- answer{r, e} }(actor)
	}
	a, b = <-done, <-done
	if a.e != nil || b.e != nil || !((a.r.State == "PENDING" && b.r.State == "ACTIVE") || (b.r.State == "PENDING" && a.r.State == "ACTIVE")) {
		t.Fatalf("consent race: %+v %+v", a, b)
	}
	householdWant(t, f, 2, "READ", 0, 0, 0, "ACTIVE")
}

func TestHouseholdIndependentAccountLossWaitRevalidates(t *testing.T) {
	for _, mode := range []string{"disable", "unlink", "delete"} {
		t.Run(mode, func(t *testing.T) {
			f := householdFixture(t)
			version := householdActive(t, f)
			tx, err := f.admin.Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(context.Background())
			if _, err = tx.Exec(f.ctx, fmt.Sprintf(`SET LOCAL ROLE kami_migrator; UPDATE app.users SET enabled=false WHERE id='%s'`, f.id(3))); err != nil {
				t.Fatal(err)
			}
			if mode == "unlink" {
				if _, err := tx.Exec(f.ctx, `UPDATE app.users SET live_auth_id=NULL WHERE id=$1`, f.id(3)); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "delete" {
				if _, err := tx.Exec(f.ctx, `RESET ROLE`); err != nil {
					t.Fatal(err)
				}
				if _, err := tx.Exec(f.ctx, `DELETE FROM auth.users WHERE id=$1`, f.id(3)); err != nil {
					t.Fatal(err)
				}
			}
			type answer struct {
				r householdResult
				e error
			}
			done := make(chan answer, 1)
			go func() { r, e := householdCall(f, 2, "CONSENT", version, 2, 3); done <- answer{r, e} }()
			select {
			case got := <-done:
				t.Fatalf("consent did not serialize with disable: %+v", got)
			case <-time.After(100 * time.Millisecond):
			}
			if err := tx.Commit(f.ctx); err != nil {
				t.Fatal(err)
			}
			got := <-done
			if got.e != nil || got.r.State != "CONFLICT" {
				t.Fatalf("stale consent after disable: %+v", got)
			}
			householdWant(t, f, 2, "READ", 0, 0, 0, "SUSPENDED")

		})
	}
}

func TestHouseholdIndependentCancellationAndTerminationRaces(t *testing.T) {
	for _, action := range []string{"CANCEL", "END"} {
		t.Run(action, func(t *testing.T) {
			f := householdFixture(t)
			r := householdWant(t, f, 1, "PROPOSE", 0, 2, 3, "PENDING")
			householdWant(t, f, 2, "CONSENT", r.Version, 2, 3, "PENDING")
			if action == "END" {
				householdWant(t, f, 3, "CONSENT", r.Version, 2, 3, "ACTIVE")
			}
			type answer struct {
				r householdResult
				e error
			}
			done := make(chan answer, 2)
			go func() { r, e := householdCall(f, 2, action, r.Version, 0, 0); done <- answer{r, e} }()
			go func() { r, e := householdCall(f, 3, "CONSENT", r.Version, 2, 3); done <- answer{r, e} }()
			a, b := <-done, <-done
			if a.e != nil || b.e != nil {
				t.Fatalf("transition race errors %+v %+v", a, b)
			}
			state, err := householdCall(f, 2, "READ", 0, 0, 0)
			if err != nil {
				t.Fatal(err)
			}
			if action == "END" {
				if state.State != "ENDED" {
					t.Fatal(state)
				}
			} else {
				if state.State != "CANCELLED" && state.State != "ACTIVE" {
					t.Fatal(state)
				}
				if state.State == "ACTIVE" && a.r.State != "CONFLICT" && b.r.State != "CONFLICT" {
					t.Fatal("finalization won but cancellation did not conflict", a, b)
				}
			}
		})
	}
}

func TestHouseholdIndependentRemovalReadmissionRaceKeepsInvalidation(t *testing.T) {
	f := householdFixture(t)
	version := householdActive(t, f)
	tx, err := f.admin.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(f.ctx, `SET LOCAL ROLE kami_migrator`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(f.ctx, `SELECT app.household_lifecycle_lock(ARRAY[$1::uuid])`, f.id(3)); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(f.ctx, `UPDATE app.memberships SET active=false WHERE id=$1`, f.id(23)); err != nil {
		t.Fatal(err)
	}
	// Even leave/rejoin in one transaction must not restore old consent.
	if _, err := tx.Exec(f.ctx, `UPDATE app.memberships SET active=true WHERE id=$1`, f.id(23)); err != nil {
		t.Fatal(err)
	}
	type answer struct {
		r householdResult
		e error
	}
	done := make(chan answer, 1)
	go func() { r, e := householdCall(f, 2, "CONSENT", version, 2, 3); done <- answer{r, e} }()
	select {
	case got := <-done:
		t.Fatalf("consent bypassed lifecycle lock: %+v", got)
	case <-time.After(100 * time.Millisecond):
	}
	if err := tx.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	got := <-done
	if got.e != nil || got.r.State != "CONFLICT" {
		t.Fatalf("leave/rejoin retained old consent: %+v", got)
	}
	householdWant(t, f, 2, "READ", 0, 0, 0, "SUSPENDED")
}

func TestHouseholdIndependentCanonicalUserLockOrder(t *testing.T) {
	for _, operation := range []string{"proposal", "bulk_disable"} {
		t.Run(operation, func(t *testing.T) {
			f := householdFixture(t)
			held, err := f.admin.Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer held.Rollback(context.Background())
			if _, err := held.Exec(f.ctx, `SET LOCAL ROLE kami_migrator`); err != nil {
				t.Fatal(err)
			}
			if _, err := held.Exec(f.ctx, `SELECT id FROM app.users WHERE id=$1 FOR UPDATE`, f.id(1)); err != nil {
				t.Fatal(err)
			}
			writer, err := pgx.Connect(f.ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
			if err != nil {
				t.Fatal(err)
			}
			defer writer.Close(context.Background())
			done := make(chan error, 1)
			go func() {
				if operation == "proposal" {
					_, err := householdCall(f, 1, "PROPOSE", 0, 2, 3)
					done <- err
					return
				}
				_, err := writer.Exec(f.ctx, `SET ROLE kami_migrator; UPDATE app.users SET enabled=false WHERE id IN ('75000000-0000-4000-8000-000000000003','75000000-0000-4000-8000-000000000001')`)
				done <- err
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
			if _, err := check.Exec(f.ctx, `SET LOCAL ROLE kami_migrator`); err != nil {
				t.Fatal(err)
			}
			if _, err := check.Exec(f.ctx, `SELECT id FROM app.users WHERE id=$1 FOR UPDATE NOWAIT`, f.id(3)); err != nil {
				t.Fatal("later user acquired before earlier user", err)
			}
			if err := check.Rollback(f.ctx); err != nil {
				t.Fatal(err)
			}
			if err := held.Commit(f.ctx); err != nil {
				t.Fatal(err)
			}
			if err := <-done; err != nil {
				t.Fatal(err)
			}
		})
	}
}
