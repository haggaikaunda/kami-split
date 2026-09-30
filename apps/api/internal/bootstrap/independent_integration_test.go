//go:build integration

package bootstrap

import (
	"context"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type fixture struct {
	t      *testing.T
	ctx    context.Context
	db     *pgx.Conn
	target Target
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	conn, err := pgx.Connect(ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	if _, err := conn.Exec(ctx, "SET ROLE kami_migrator"); err != nil {
		t.Fatal(err)
	}
	f := &fixture{t: t, ctx: ctx, db: conn, target: Target{AuthUserID: uuid.NewString(), UserID: uuid.NewString(), GroupID: uuid.NewString(), MembershipID: uuid.NewString(), DisplayName: "Synthetic operator"}}
	f.exec(`INSERT INTO auth.users(id,email) VALUES($1,$2)`, f.target.AuthUserID, f.target.AuthUserID+"@example.invalid")
	t.Cleanup(func() {
		tx, e := conn.Begin(context.Background())
		if e != nil {
			t.Error(e)
			return
		}
		defer tx.Rollback(context.Background())
		for _, q := range []string{`DELETE FROM app.installation WHERE household_group_id=$1`, `DELETE FROM app.memberships WHERE group_id=$1`, `DELETE FROM app.groups WHERE id=$1`} {
			if _, e = tx.Exec(context.Background(), q, f.target.GroupID); e != nil {
				t.Error(e)
				return
			}
		}
		if _, e = tx.Exec(context.Background(), `DELETE FROM app.users WHERE id=$1`, f.target.UserID); e != nil {
			t.Error(e)
			return
		}
		if _, e = tx.Exec(context.Background(), "RESET ROLE"); e != nil {
			t.Error(e)
			return
		}
		if _, e = tx.Exec(context.Background(), `DELETE FROM auth.users WHERE id=$1`, f.target.AuthUserID); e != nil {
			t.Error(e)
			return
		}
		if e = tx.Commit(context.Background()); e != nil {
			t.Error(e)
		}
	})
	return f
}
func (f *fixture) exec(q string, args ...any) {
	f.t.Helper()
	if strings.Contains(q, "auth.users") {
		if _, e := f.db.Exec(f.ctx, "RESET ROLE"); e != nil {
			f.t.Fatal(e)
		}
		defer func() {
			if _, e := f.db.Exec(f.ctx, "SET ROLE kami_migrator"); e != nil {
				f.t.Error(e)
			}
		}()
	}
	if _, e := f.db.Exec(f.ctx, q, args...); e != nil {
		f.t.Fatal(e)
	}
}
func (f *fixture) provision() {
	f.t.Helper()
	if _, e := Provision(f.ctx, f.db, f.target); e != nil {
		f.t.Fatal(e)
	}
}
func (f *fixture) absent() {
	f.t.Helper()
	var n int
	if e := f.db.QueryRow(f.ctx, `SELECT (SELECT count(*) FROM app.users WHERE id=$1)+(SELECT count(*) FROM app.groups WHERE id=$2)+(SELECT count(*) FROM app.memberships WHERE id=$3)`, f.target.UserID, f.target.GroupID, f.target.MembershipID).Scan(&n); e != nil || n != 0 {
		f.t.Fatalf("partial application setup: count=%d err=%v", n, e)
	}
}
func (f *fixture) exact() {
	f.t.Helper()
	var n int
	e := f.db.QueryRow(f.ctx, `SELECT count(*) FROM app.users u JOIN app.memberships m ON m.user_id=u.id JOIN app.groups g ON g.id=m.group_id JOIN app.installation i ON i.household_group_id=g.id WHERE u.id=$1 AND u.auth_subject=$2 AND u.live_auth_id=$2 AND u.enabled AND m.id=$3 AND m.active AND g.id=$4 AND g.owner_membership_id=m.id AND g.name='Household' AND g.currency='USD' AND i.group_creator_user_id=u.id AND (SELECT count(*) FROM app.memberships WHERE group_id=g.id)=1 AND NOT EXISTS(SELECT FROM app.expenses WHERE group_id=g.id)`, f.target.UserID, f.target.AuthUserID, f.target.MembershipID, f.target.GroupID).Scan(&n)
	if e != nil || n != 1 {
		f.t.Fatalf("unexpected bootstrap result count=%d err=%v", n, e)
	}
}

func TestIndependentBootstrapConcurrentAndRepeat(t *testing.T) {
	f := newFixture(t)
	var wg sync.WaitGroup
	results := make(chan error, 6)
	outcomes := make(chan Result, 6)
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c, e := pgx.Connect(f.ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
			if e == nil {
				defer c.Close(f.ctx)
				var result Result
				result, e = Provision(f.ctx, c, f.target)
				outcomes <- result
			}
			results <- e
		}()
	}
	wg.Wait()
	close(results)
	for e := range results {
		if e != nil {
			t.Fatal(e)
		}
	}
	close(outcomes)
	created := 0
	existing := 0
	for outcome := range outcomes {
		if outcome == Created {
			created++
		}
		if outcome == Existing {
			existing++
		}
	}
	if created != 1 || existing != 5 {
		t.Fatalf("concurrent outcomes created=%d existing=%d", created, existing)
	}
	f.provision()
	f.exact()
}
func TestIndependentBootstrapRollbackAndResume(t *testing.T) {
	f := newFixture(t)
	// A rejecting trigger forces failure after application user and group inserts,
	// proving the transaction does not leave either behind.
	f.exec(`CREATE FUNCTION app.bootstrap_test_reject() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''synthetic failure''; END'`)
	f.exec(`CREATE TRIGGER bootstrap_test_reject BEFORE INSERT ON app.memberships FOR EACH ROW EXECUTE FUNCTION app.bootstrap_test_reject()`)
	t.Cleanup(func() {
		f.exec(`DROP TRIGGER IF EXISTS bootstrap_test_reject ON app.memberships; DROP FUNCTION IF EXISTS app.bootstrap_test_reject()`)
	})
	if _, e := Provision(f.ctx, f.db, f.target); e == nil {
		t.Fatal("injected transaction failure accepted")
	}
	f.absent()
	f.exec(`DROP TRIGGER bootstrap_test_reject ON app.memberships; DROP FUNCTION app.bootstrap_test_reject()`)
	f.provision()
	f.exact()
}
func TestIndependentBootstrapMalformedAndMissingTarget(t *testing.T) {
	f := newFixture(t)
	for _, bad := range []string{"", "not-a-uuid", "00000000-0000-0000-0000-000000000000", uuid.NewString()} {
		target := f.target
		target.AuthUserID = bad
		if _, e := Provision(f.ctx, f.db, target); e == nil {
			t.Fatalf("accepted missing or malformed identity %q", bad)
		}
		f.absent()
	}
}
func TestIndependentBootstrapRuntimeDenied(t *testing.T) {
	f := newFixture(t)
	c, e := pgx.Connect(f.ctx, os.Getenv("TEST_DATABASE_URL"))
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close(f.ctx)
	if _, e = Provision(f.ctx, c, f.target); e == nil {
		t.Fatal("runtime may bootstrap")
	}
	f.absent()
}
func TestIndependentBootstrapDisabledNeverRestored(t *testing.T) {
	f := newFixture(t)
	f.provision()
	f.exec(`UPDATE app.users SET enabled=false WHERE id=$1`, f.target.UserID)
	if _, e := Provision(f.ctx, f.db, f.target); e == nil {
		t.Fatal("disabled identity accepted")
	}
	var enabled bool
	if e := f.db.QueryRow(f.ctx, `SELECT enabled FROM app.users WHERE id=$1`, f.target.UserID).Scan(&enabled); e != nil || enabled {
		t.Fatal("disabled identity restored", e)
	}
}
func TestIndependentBootstrapOwnershipAndDepartureNeverRestored(t *testing.T) {
	f := newFixture(t)
	f.provision()
	otherUser, otherAuth, otherMember := uuid.NewString(), uuid.NewString(), uuid.NewString()
	f.exec(`INSERT INTO auth.users(id,email) VALUES($1,$2)`, otherAuth, otherAuth+"@example.invalid")
	f.exec(`INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES($1,$2,$2,'Other synthetic')`, otherUser, otherAuth)
	t.Cleanup(func() {
		f.exec(`DELETE FROM app.installation WHERE household_group_id=$1`, f.target.GroupID)
		f.exec(`BEGIN; DELETE FROM app.memberships WHERE group_id='` + f.target.GroupID + `'; DELETE FROM app.groups WHERE id='` + f.target.GroupID + `'; COMMIT`)
		f.exec(`DELETE FROM app.users WHERE id=$1`, otherUser)
		f.exec(`DELETE FROM auth.users WHERE id=$1`, otherAuth)
	})
	f.exec(`INSERT INTO app.memberships(id,group_id,user_id) VALUES($1,$2,$3)`, otherMember, f.target.GroupID, otherUser)
	// Household transitions require the lifecycle lock in the same transaction.
	// Keep ownership transfer and departure separate so both bootstrap rejections
	// still exercise their original independently committed states.
	transition := func(query string, args ...any) {
		t.Helper()
		tx, err := f.db.Begin(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(f.ctx)
		if _, err = tx.Exec(f.ctx, `SELECT app.household_lifecycle_lock(ARRAY[$1::uuid,$2::uuid])`, f.target.UserID, otherUser); err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec(f.ctx, query, args...); err != nil {
			t.Fatal(err)
		}
		if err = tx.Commit(f.ctx); err != nil {
			t.Fatal(err)
		}
	}
	transition(`UPDATE app.groups SET owner_membership_id=$1 WHERE id=$2`, otherMember, f.target.GroupID)
	if _, e := Provision(f.ctx, f.db, f.target); e == nil {
		t.Fatal("ownership transfer accepted as original setup")
	}
	transition(`UPDATE app.memberships SET active=false WHERE id=$1`, f.target.MembershipID)
	if _, e := Provision(f.ctx, f.db, f.target); e == nil {
		t.Fatal("historical membership accepted")
	}
	var active bool
	var owner string
	if e := f.db.QueryRow(f.ctx, `SELECT m.active,g.owner_membership_id::text FROM app.memberships m JOIN app.groups g ON g.id=m.group_id WHERE m.id=$1`, f.target.MembershipID).Scan(&active, &owner); e != nil || active || owner != otherMember {
		t.Fatal("bootstrap restored old privileges", e)
	}
}
func TestIndependentBootstrapConflictingAuthLink(t *testing.T) {
	f := newFixture(t)
	f.exec(`INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES($1,$2,$2,'Existing')`, f.target.UserID, f.target.AuthUserID)
	alternate := f.target
	alternate.UserID = uuid.NewString()
	if _, e := Provision(f.ctx, f.db, alternate); e == nil {
		t.Fatal("conflicting stable identity accepted")
	}
	f.provision()
	f.exact()
}

func TestIndependentBootstrapConflictingConcurrentPlans(t *testing.T) {
	f := newFixture(t)
	other := f.target
	other.UserID = uuid.NewString()
	other.GroupID = uuid.NewString()
	other.MembershipID = uuid.NewString()
	// Register both possible winners for cleanup without deleting unrelated data.
	t.Cleanup(func() {
		tx, e := f.db.Begin(context.Background())
		if e != nil {
			t.Error(e)
			return
		}
		defer tx.Rollback(context.Background())
		for _, q := range []string{`DELETE FROM app.installation WHERE household_group_id=$1`, `DELETE FROM app.memberships WHERE group_id=$1`, `DELETE FROM app.groups WHERE id=$1`} {
			if _, e = tx.Exec(context.Background(), q, other.GroupID); e != nil {
				t.Error(e)
				return
			}
		}
		if _, e = tx.Exec(context.Background(), `DELETE FROM app.users WHERE id=$1`, other.UserID); e != nil {
			t.Error(e)
			return
		}
		if e = tx.Commit(context.Background()); e != nil {
			t.Error(e)
		}
	})
	var wg sync.WaitGroup
	results := make(chan error, 2)
	start := make(chan struct{})
	for _, plan := range []Target{f.target, other} {
		wg.Add(1)
		go func(plan Target) {
			defer wg.Done()
			c, e := pgx.Connect(f.ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
			if e != nil {
				results <- e
				return
			}
			defer c.Close(f.ctx)
			<-start
			_, e = Provision(f.ctx, c, plan)
			results <- e
		}(plan)
	}
	close(start)
	wg.Wait()
	close(results)
	success := 0
	for e := range results {
		if e == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatalf("conflicting plans produced %d successful outcomes", success)
	}
	var users, groups, members int
	e := f.db.QueryRow(f.ctx, `SELECT (SELECT count(*) FROM app.users WHERE id IN ($1,$2)),(SELECT count(*) FROM app.groups WHERE id IN ($3,$4)),(SELECT count(*) FROM app.memberships WHERE id IN ($5,$6))`, f.target.UserID, other.UserID, f.target.GroupID, other.GroupID, f.target.MembershipID, other.MembershipID).Scan(&users, &groups, &members)
	if e != nil || users != 1 || groups != 1 || members != 1 {
		t.Fatalf("conflicting plans left partial state: %d/%d/%d err=%v", users, groups, members, e)
	}
}

func TestIndependentBootstrapMissingInstallationDoesNotRepairHistory(t *testing.T) {
	f := newFixture(t)
	f.provision()
	f.exec(`DELETE FROM app.installation WHERE household_group_id=$1`, f.target.GroupID)
	if _, e := Provision(f.ctx, f.db, f.target); e == nil {
		t.Fatal("missing installation silently repaired historical setup")
	}
	alternate := f.target
	alternate.GroupID = uuid.NewString()
	alternate.MembershipID = uuid.NewString()
	if _, e := Provision(f.ctx, f.db, alternate); e == nil {
		t.Fatal("existing membership history allowed a fresh household")
	}

	var n int
	if e := f.db.QueryRow(f.ctx, `SELECT count(*) FROM app.installation WHERE household_group_id=$1`, f.target.GroupID).Scan(&n); e != nil || n != 0 {
		t.Fatal("installation restored", e)
	}
}

func TestIndependentBootstrapRetryPreservesRenamedData(t *testing.T) {
	f := newFixture(t)
	f.provision()
	f.exec(`UPDATE app.groups SET name='Renamed household' WHERE id=$1`, f.target.GroupID)
	f.exec(`UPDATE app.users SET display_name='Updated profile' WHERE id=$1`, f.target.UserID)
	f.provision()
	var groupName, userName string
	e := f.db.QueryRow(f.ctx, `SELECT g.name,u.display_name FROM app.groups g,app.users u WHERE g.id=$1 AND u.id=$2`, f.target.GroupID, f.target.UserID).Scan(&groupName, &userName)
	if e != nil || groupName != "Renamed household" || userName != "Updated profile" {
		t.Fatal("retry overwrote mutable data", e)
	}
}

func TestIndependentBootstrapDisabledOrTombstonedBeforeInstallation(t *testing.T) {
	for _, tombstone := range []bool{false, true} {
		t.Run(map[bool]string{false: "disabled", true: "tombstoned"}[tombstone], func(t *testing.T) {
			f := newFixture(t)
			f.exec(`INSERT INTO app.users(id,auth_subject,live_auth_id,display_name,enabled) VALUES($1,$2,$2,'Disabled synthetic',false)`, f.target.UserID, f.target.AuthUserID)
			if tombstone {
				f.exec(`UPDATE app.users SET live_auth_id=NULL WHERE id=$1`, f.target.UserID)
			}
			if _, e := Provision(f.ctx, f.db, f.target); e == nil {
				t.Fatal("disabled preexisting identity provisioned")
			}
			var n int
			var enabled bool
			var live bool
			e := f.db.QueryRow(f.ctx, `SELECT enabled,live_auth_id IS NOT NULL,(SELECT count(*) FROM app.groups WHERE id=$2) FROM app.users WHERE id=$1`, f.target.UserID, f.target.GroupID).Scan(&enabled, &live, &n)
			if e != nil || enabled || live == tombstone || n != 0 {
				t.Fatal("disabled/tombstoned identity changed", e)
			}
		})
	}
}
