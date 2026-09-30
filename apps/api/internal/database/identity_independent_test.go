//go:build integration

package database_test

import (
	"context"
	"errors"
	"fmt"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"os"
	"testing"
	"time"
)

// Each test owns its fixture and a one-connection runtime pool. Do not use
// t.Parallel: the database package also tests cluster-global login role state.
type identityFixture struct {
	ctx    context.Context
	admin  *pgx.Conn
	db     *database.DB
	id     func(int) string
	uid    func(int) pgtype.UUID
	exec   func(string)
	reject func(string)
}

func newIdentityFixture(t *testing.T) *identityFixture {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)
	admin, err := pgx.Connect(ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.Close(context.Background()) })
	db, err := database.Open(ctx, database.Config{URL: os.Getenv("TEST_DATABASE_URL"), MaxConns: 1, Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	id := func(n int) string { return fmt.Sprintf("75000000-0000-4000-8000-%012d", n) }
	uid := func(n int) pgtype.UUID { var v pgtype.UUID; _ = v.Scan(id(n)); return v }
	exec := func(sql string) {
		t.Helper()
		if _, e := admin.Exec(ctx, sql); e != nil {
			t.Fatal(e)
		}
	}
	seed, err := admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer seed.Rollback(context.Background())
	seedExec := func(query string, args ...any) {
		t.Helper()
		if _, err := seed.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	for n := 1; n <= 3; n++ {
		seedExec(`INSERT INTO auth.users(id,email) VALUES($1,$2)`, id(n), id(n)+"@example.invalid")
	}
	seedExec("SET LOCAL ROLE kami_migrator")
	for n := 1; n <= 3; n++ {
		seedExec(`INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES($1,$2,$2,$3)`, id(n), id(n), fmt.Sprintf("Actor %d", n))
	}
	seedExec(`INSERT INTO app.groups(id,name,owner_membership_id) VALUES($1,$2,$3)`, id(11), "G", id(21))
	seedExec(`INSERT INTO app.groups(id,name,owner_membership_id) VALUES($1,$2,$3)`, id(12), "H", id(24))
	seedExec(`INSERT INTO app.memberships(id,group_id,user_id,active) VALUES($1,$2,$3,$4)`, id(21), id(11), id(1), true)
	seedExec(`INSERT INTO app.memberships(id,group_id,user_id,active) VALUES($1,$2,$3,$4)`, id(22), id(11), id(2), true)
	seedExec(`INSERT INTO app.memberships(id,group_id,user_id,active) VALUES($1,$2,$3,$4)`, id(23), id(11), id(3), false)
	seedExec(`INSERT INTO app.memberships(id,group_id,user_id,active) VALUES($1,$2,$3,$4)`, id(24), id(12), id(3), true)
	seedExec(`INSERT INTO app.installation(household_group_id,group_creator_user_id) VALUES($1,$2)`, id(11), id(2))
	if err := seed.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, e := admin.Exec(context.Background(), fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; DELETE FROM app.installation WHERE household_group_id='%s'; DELETE FROM app.memberships WHERE group_id IN ('%s','%s'); DELETE FROM app.groups WHERE id IN ('%s','%s'); DELETE FROM app.users WHERE id IN ('%s','%s','%s'); COMMIT; DELETE FROM auth.users WHERE id IN ('%s','%s','%s');`, id(11), id(11), id(12), id(11), id(12), id(1), id(2), id(3), id(1), id(2), id(3)))
		if e != nil {
			t.Errorf("cleanup: %v", e)
		}
	})
	reject := func(sql string) {
		t.Helper()
		tx, e := admin.Begin(ctx)
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback(context.Background())
		defer tx.Rollback(context.Background())
		if _, e = tx.Exec(ctx, "SET LOCAL ROLE kami_migrator"); e != nil {
			t.Fatal(e)
		}
		_, e = tx.Exec(ctx, sql)
		if e == nil {
			e = tx.Commit(ctx)
		}
		if e == nil {
			t.Fatalf("accepted %s", sql)
		}
	}
	return &identityFixture{ctx: ctx, admin: admin, db: db, id: id, uid: uid, exec: exec, reject: reject}
}

func TestIdentityConstraints(t *testing.T) {
	f := newIdentityFixture(t)
	id := f.id
	reject := f.reject
	for _, sql := range []string{
		fmt.Sprintf(`INSERT INTO app.groups(id,name,owner_membership_id) VALUES ('%s','ownerless','%s')`, id(99), id(21)),
		fmt.Sprintf(`UPDATE app.groups SET owner_membership_id='%s' WHERE id='%s'`, id(24), id(11)),
		fmt.Sprintf(`UPDATE app.groups SET owner_membership_id='%s' WHERE id='%s'`, id(23), id(11)),
		fmt.Sprintf(`UPDATE app.memberships SET active=false WHERE id='%s'`, id(21)),
		fmt.Sprintf(`INSERT INTO app.memberships(id,group_id,user_id) VALUES ('%s','%s','%s')`, id(99), id(11), id(3)),
		fmt.Sprintf(`INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES ('%s','%s','%s','duplicate')`, id(99), id(1), id(1)),
		fmt.Sprintf(`UPDATE app.users SET auth_subject='%s' WHERE id='%s'`, id(2), id(1)),
		fmt.Sprintf(`UPDATE app.users SET created_at=created_at+interval '1 second' WHERE id='%s'`, id(1)),
		fmt.Sprintf(`UPDATE app.memberships SET user_id='%s' WHERE id='%s'`, id(1), id(23)),
		fmt.Sprintf(`UPDATE app.memberships SET group_id='%s' WHERE id='%s'`, id(12), id(23)),
		fmt.Sprintf(`UPDATE app.memberships SET created_at=created_at+interval '1 second' WHERE id='%s'`, id(23)),
	} {
		reject(sql)
	}
}

func TestIdentityProjectionsAndRealRoleDenial(t *testing.T) {
	f := newIdentityFixture(t)
	ctx := f.ctx
	admin := f.admin
	db := f.db
	id := f.id
	uid := f.uid
	for _, n := range []int{1, 2, 3} {
		if e := db.WithIdentity(ctx, id(n), func(tx pgx.Tx) error {
			v, e := database.ReadViewer(ctx, tx)
			if e != nil {
				return e
			}
			if v.ID != uid(n) || v.CanCreateGroups != (n == 2) {
				return fmt.Errorf("wrong viewer %+v", v)
			}
			gs, e := database.ListGroups(ctx, tx)
			if e != nil {
				return e
			}
			if len(gs) != 1 {
				return errors.New("group disclosure")
			}
			g := 11
			if n == 3 {
				g = 12
			}
			got, e := database.ReadGroup(ctx, tx, uid(g))
			if e != nil {
				return e
			}
			if n != 3 {
				if len(got.Members) != 3 {
					return errors.New("missing retained history")
				}
				for _, m := range got.Members {
					if m.ID == uid(23) && (m.Status != "INACTIVE" || m.CanParticipate || m.Role != "MEMBER") {
						return errors.New("wrong inactive profile")
					}
				}
			}
			return nil
		}); e != nil {
			t.Fatal(e)
		}
	}
	for _, sql := range []string{`SELECT * FROM app.users`, `SELECT * FROM app.installation`, `SELECT user_id FROM app.memberships`, `SELECT created_at FROM app.groups`, `SELECT * FROM auth.users`, `SET ROLE kami_migrator`, `CREATE TABLE app.denied75(id int)`, `UPDATE app.memberships SET active=false`, `DELETE FROM app.groups`, `TRUNCATE app.memberships`, `SELECT app.preserve_user_identity()`, `SELECT app.verified_subject()`} {
		if _, e := db.Pool.Exec(ctx, sql); e == nil {
			t.Fatalf("runtime allowed %s", sql)
		}
	}
	for _, s := range []string{"", "malformed", id(99), id(3)} {
		tx, e := db.Pool.Begin(ctx)
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback(context.Background())
		_, e = tx.Exec(ctx, `SELECT set_config('app.verified_sub',$1,true)`, s)
		if e != nil {
			t.Fatal(e)
		}
		var allowed bool
		e = tx.QueryRow(ctx, `SELECT app.can_read_group($1)`, id(11)).Scan(&allowed)
		if e != nil || allowed {
			t.Fatalf("context %q allowed=%v err=%v", s, allowed, e)
		}
		tx.Rollback(ctx)
	}
	for _, role := range []string{"anon", "authenticated", "service_role"} {
		for _, sql := range []string{`SELECT id FROM app.groups`, `SELECT * FROM app.viewer_identity()`} {
			tx, e := admin.Begin(ctx)
			if e != nil {
				t.Fatal(e)
			}
			defer tx.Rollback(context.Background())
			if _, e = tx.Exec(ctx, "SET LOCAL ROLE "+role); e != nil {
				t.Fatal(e)
			}
			if _, e = tx.Exec(ctx, sql); e == nil {
				t.Fatalf("%s allowed %s", role, sql)
			}
			tx.Rollback(ctx)
		}
	}
}

func TestIdentityAclOwnershipAndHostileSearchPath(t *testing.T) {
	f := newIdentityFixture(t)
	ctx := f.ctx
	admin := f.admin
	db := f.db
	id := f.id
	uid := f.uid
	for _, sql := range []string{
		`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r' AND (c.relowner<>'kami_migrator'::regrole OR NOT c.relrowsecurity)`,
		`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND (p.proowner<>'kami_migrator'::regrole OR NOT ('search_path=pg_catalog, pg_temp'=ANY(p.proconfig)))`,
		`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) r(role) WHERE n.nspname='app' AND has_function_privilege(r.role,p.oid,'EXECUTE')`,
		`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='app' AND a.grantee=0 AND a.privilege_type='EXECUTE'`,
	} {
		var n int
		if e := admin.QueryRow(ctx, sql).Scan(&n); e != nil || n != 0 {
			t.Fatalf("ACL query count=%d err=%v query=%s", n, e, sql)
		}
	}
	for _, role := range []string{"kami_api", "kami_migrator"} {
		var usage, refs bool
		if e := admin.QueryRow(ctx, `SELECT has_schema_privilege($1,'auth','USAGE'),has_table_privilege($1,'auth.users','REFERENCES')`, role).Scan(&usage, &refs); e != nil || usage || refs {
			t.Fatalf("Auth grants role=%s usage=%v refs=%v err=%v", role, usage, refs, e)
		}
	}
	if e := db.WithIdentity(ctx, id(1), func(tx pgx.Tx) error {
		if _, e := tx.Exec(ctx, `CREATE TEMP TABLE users(id uuid,enabled boolean); CREATE TEMP TABLE memberships(group_id uuid,active boolean); SET LOCAL search_path=pg_temp,public`); e != nil {
			return e
		}
		v, e := database.ReadViewer(ctx, tx)
		if e == nil && v.ID != uid(1) {
			return errors.New("shadowed viewer")
		}
		if e != nil {
			return e
		}
		_, e = database.ReadGroup(ctx, tx, uid(11))
		return e
	}); e != nil {
		t.Fatal(e)
	}
}

func TestIdentityContextCommitRollbackCancel(t *testing.T) {
	f := newIdentityFixture(t)
	ctx := f.ctx
	db := f.db
	id := f.id
	uid := f.uid
	for _, mode := range []string{"commit", "rollback", "cancel"} {
		local, stop := context.WithCancel(ctx)
		e := db.WithIdentity(local, id(1), func(tx pgx.Tx) error {
			v, e := database.ReadViewer(local, tx)
			if e != nil {
				return e
			}
			if v.ID != uid(1) {
				return errors.New("wrong identity")
			}
			switch mode {
			case "rollback":
				return errors.New("test rollback")
			case "cancel":
				stop()
				_, e = tx.Exec(local, `SELECT pg_sleep(1)`)
				return e
			}
			return nil
		})
		stop()
		if (e == nil) != (mode == "commit") {
			t.Fatalf("%s: %v", mode, e)
		}
		var allowed bool
		e = db.Pool.QueryRow(ctx, `SELECT app.can_read_group($1)`, id(11)).Scan(&allowed)
		if e != nil || allowed {
			t.Fatalf("context leaked after %s: %v %v", mode, allowed, e)
		}
		// Reuse the one-connection runtime pool after every completion path.
		// Actor 2 lacks group H; actor 3 has only inactive membership in G.
		for _, denied := range []struct{ actor, group int }{{2, 12}, {3, 11}} {
			err := db.WithIdentity(ctx, id(denied.actor), func(tx pgx.Tx) error {
				_, err := database.ReadGroup(ctx, tx, uid(denied.group))
				return err
			})
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
				t.Fatalf("%s: actor %d group %d should be denied: %v", mode, denied.actor, denied.group, err)
			}
		}
		if e = db.WithIdentity(ctx, id(2), func(tx pgx.Tx) error {
			v, e := database.ReadViewer(ctx, tx)
			if e == nil && v.ID != uid(2) {
				return errors.New("prior actor leaked")
			}
			return e
		}); e != nil {
			t.Fatal(e)
		}
	}
}

func TestIdentityReadmissionSameIdentityOrdinaryRole(t *testing.T) {
	f := newIdentityFixture(t)
	ctx := f.ctx
	db := f.db
	id := f.id
	uid := f.uid
	exec := f.exec
	exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.memberships SET active=true WHERE id='%s'; RESET ROLE`, id(23)))
	defer exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.memberships SET active=false WHERE id='%s'; RESET ROLE`, id(23)))
	if e := db.WithIdentity(ctx, id(3), func(tx pgx.Tx) error {
		g, e := database.ReadGroup(ctx, tx, uid(11))
		if e != nil {
			return e
		}
		for _, m := range g.Members {
			if m.ID == uid(23) && m.Role == "MEMBER" && m.CanParticipate {
				return nil
			}
		}
		return errors.New("readmission identity")
	}); e != nil {
		t.Fatal(e)
	}
}

func TestIdentityMembershipRevocationWaitFreshSnapshot(t *testing.T) {
	f := newIdentityFixture(t)
	ctx := f.ctx
	admin := f.admin
	db := f.db
	id := f.id
	uid := f.uid
	exec := f.exec
	for _, write := range []bool{false, true} {
		tx, e := admin.Begin(ctx)
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback(context.Background())
		_, e = tx.Exec(ctx, fmt.Sprintf(`SET LOCAL ROLE kami_migrator; SELECT id FROM app.groups WHERE id='%s' FOR UPDATE; UPDATE app.memberships SET active=false WHERE id='%s'`, id(11), id(22)))
		if e != nil {
			t.Fatal(e)
		}
		started := make(chan struct{})
		done := make(chan error, 1)
		go func() {
			done <- db.WithIdentity(ctx, id(2), func(rt pgx.Tx) error {
				close(started)
				if write {
					return database.LockGroupWrite(ctx, rt, uid(11), []pgtype.UUID{})
				}
				_, e := database.ReadGroup(ctx, rt, uid(11))
				return e
			})
		}()
		<-started
		select {
		case e := <-done:
			t.Fatalf("no lock wait: %v", e)
		case <-time.After(75 * time.Millisecond):
		}
		if e = tx.Commit(ctx); e != nil {
			t.Fatal(e)
		}
		if e = <-done; e == nil {
			t.Fatal("revoked waiting caller allowed")
		}
		exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.memberships SET active=true WHERE id='%s'; RESET ROLE`, id(22)))
	}
}

func TestIdentityReadLocksBlockRevocation(t *testing.T) {
	f := newIdentityFixture(t)
	ctx := f.ctx
	admin := f.admin
	db := f.db
	id := f.id
	uid := f.uid
	for _, disable := range []bool{false, true} {
		rt, e := db.Pool.Begin(ctx)
		if e != nil {
			t.Fatal(e)
		}
		defer rt.Rollback(context.Background())
		_, e = rt.Exec(ctx, `SELECT set_config('app.verified_sub',$1,true)`, id(2))
		if e != nil {
			t.Fatal(e)
		}
		if _, e = database.ReadGroup(ctx, rt, uid(11)); e != nil {
			t.Fatal(e)
		}
		done := make(chan error, 1)
		go func() {
			tx, e := admin.Begin(ctx)
			if e != nil {
				done <- e
				return
			}
			defer tx.Rollback(context.Background())
			sql := fmt.Sprintf(`SET LOCAL ROLE kami_migrator; SELECT id FROM app.groups WHERE id='%s' FOR UPDATE; UPDATE app.memberships SET active=false WHERE id='%s'`, id(11), id(22))
			if disable {
				sql = fmt.Sprintf(`SET LOCAL ROLE kami_migrator; UPDATE app.users SET enabled=false WHERE id='%s'`, id(2))
			}
			_, e = tx.Exec(ctx, sql)
			if e == nil {
				e = tx.Rollback(ctx)
			}
			done <- e
		}()
		select {
		case e := <-done:
			t.Fatalf("revocation did not wait: %v", e)
		case <-time.After(75 * time.Millisecond):
		}
		if e = rt.Commit(ctx); e != nil {
			t.Fatal(e)
		}
		if e = <-done; e != nil {
			t.Fatal(e)
		}
	}
}

func TestIdentityOwnerTransferAndTargetInactivationSerialize(t *testing.T) {
	f := newIdentityFixture(t)
	ctx := f.ctx
	admin := f.admin
	id := f.id
	exec := f.exec
	// Privileged fixture operations exercise constraints, not a transfer service.
	for _, transferFirst := range []bool{false, true} {
		tx, e := admin.Begin(ctx)
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback(context.Background())
		first := fmt.Sprintf(`SET LOCAL ROLE kami_migrator; UPDATE app.memberships SET active=false WHERE id='%s'`, id(22))
		second := fmt.Sprintf(`SET LOCAL ROLE kami_migrator; UPDATE app.groups SET owner_membership_id='%s' WHERE id='%s'; SET CONSTRAINTS ALL IMMEDIATE`, id(22), id(11))
		if transferFirst {
			first, second = second, first+`; SET CONSTRAINTS ALL IMMEDIATE`
		}
		if _, e = tx.Exec(ctx, first); e != nil {
			t.Fatal(e)
		}
		done := make(chan error, 1)
		go func() {
			other, e := pgx.Connect(ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
			if e != nil {
				done <- e
				return
			}
			defer other.Close(context.Background())
			ot, e := other.Begin(ctx)
			if e != nil {
				done <- e
				return
			}
			defer ot.Rollback(context.Background())
			_, e = ot.Exec(ctx, second)
			if e == nil {
				e = ot.Commit(ctx)
			}
			done <- e
		}()
		select {
		case e := <-done:
			t.Fatalf("competing owner change did not wait: %v", e)
		case <-time.After(75 * time.Millisecond):
		}
		if e = tx.Commit(ctx); e != nil {
			t.Fatal(e)
		}
		if e = <-done; e == nil {
			t.Fatal("incompatible owner changes both committed")
		}
		var owners int
		if e = admin.QueryRow(ctx, `SELECT count(*) FROM app.groups g JOIN app.memberships m ON m.id=g.owner_membership_id AND m.group_id=g.id AND m.active WHERE g.id=$1`, id(11)).Scan(&owners); e != nil || owners != 1 {
			t.Fatalf("owner invariant %d %v", owners, e)
		}
		exec(fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; UPDATE app.memberships SET active=true WHERE id='%s'; UPDATE app.groups SET owner_membership_id='%s' WHERE id='%s'; COMMIT`, id(22), id(21), id(11)))
	}
}

func TestIdentityDisableCommitsBeforeWaitingAuthorization(t *testing.T) {
	f := newIdentityFixture(t)
	ctx := f.ctx
	admin := f.admin
	db := f.db
	id := f.id
	uid := f.uid
	exec := f.exec
	// Both actor and participant eligibility must be rechecked after user locks.
	exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.memberships SET active=true WHERE id='%s'; RESET ROLE`, id(23)))
	for _, participant := range []bool{true, false} {
		victim := 1
		actor := 1
		members := []pgtype.UUID{}
		if participant {
			victim = 3
			actor = 2
			members = []pgtype.UUID{uid(23)}
		}
		tx, e := admin.Begin(ctx)
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback(context.Background())
		if _, e = tx.Exec(ctx, fmt.Sprintf(`SET LOCAL ROLE kami_migrator; UPDATE app.users SET enabled=false WHERE id='%s'`, id(victim))); e != nil {
			t.Fatal(e)
		}
		started := make(chan struct{})
		done := make(chan error, 1)
		go func() {
			done <- db.WithIdentity(ctx, id(actor), func(rt pgx.Tx) error { close(started); return database.LockGroupWrite(ctx, rt, uid(11), members) })
		}()
		<-started
		select {
		case e := <-done:
			t.Fatalf("did not wait on disable: %v", e)
		case <-time.After(75 * time.Millisecond):
		}
		if e = tx.Commit(ctx); e != nil {
			t.Fatal(e)
		}
		if e = <-done; e == nil {
			t.Fatal("disabled eligibility accepted")
		}
	}
}

func TestIdentityManagedAuthDeletionNoRelink(t *testing.T) {
	f := newIdentityFixture(t)
	ctx := f.ctx
	admin := f.admin
	db := f.db
	id := f.id
	exec := f.exec
	reject := f.reject
	if _, e := admin.Exec(ctx, `DELETE FROM auth.users WHERE id='`+id(2)+`'`); e == nil {
		t.Fatal("enabled Auth deletion accepted")
	}
	exec(`SET ROLE kami_migrator; UPDATE app.users SET enabled=false WHERE id='` + id(2) + `'; RESET ROLE; DELETE FROM auth.users WHERE id='` + id(2) + `'`)
	var retained bool
	if e := admin.QueryRow(ctx, `SELECT live_auth_id IS NULL AND EXISTS(SELECT FROM app.memberships WHERE user_id=app.users.id) FROM app.users WHERE id=$1`, id(2)).Scan(&retained); e != nil || !retained {
		t.Fatalf("history lost: %v %v", retained, e)
	}
	exec(`INSERT INTO auth.users(id,email) VALUES ('` + id(2) + `','b75@example.invalid')`)
	reject(`UPDATE app.users SET live_auth_id='` + id(2) + `' WHERE id='` + id(2) + `'`)
	reject(`UPDATE app.users SET enabled=true WHERE id='` + id(2) + `'`)
	if e := db.WithIdentity(ctx, id(2), func(tx pgx.Tx) error {
		v, e := database.ReadViewer(ctx, tx)
		if e != nil {
			return e
		}
		if v.Status != "DISABLED" || v.ID.Valid || v.DisplayName.Valid || v.CanCreateGroups {
			return errors.New("disabled viewer leak")
		}
		var ok bool
		e = tx.QueryRow(ctx, `SELECT app.can_read_group($1)`, id(11)).Scan(&ok)
		if ok {
			return errors.New("disabled access")
		}
		return e
	}); e != nil {
		t.Fatal(e)
	}
}
