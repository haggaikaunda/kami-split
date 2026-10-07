//go:build integration

package expense_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/jackc/pgx/v5"
)

// A zero-share saved member may depart now, but an edit can reopen their net.
func independentZeroShareExpense(t *testing.T, f *expenseFixture) ledger.EditInput {
	t.Helper()
	in := editInput(f)
	in.PayerID = f.public("Membership", 301)
	in.ParticipantIDs = []string{f.public("Membership", 301), f.public("Membership", 302)}
	in.Split = "EXACT"
	in.ExactAllocations = []ledger.Allocation{{ParticipantID: f.public("Membership", 301), Amount: 1000}, {ParticipantID: f.public("Membership", 302), Amount: 0}}
	if out := performEdit(t, f, 1, in); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	in.Key = uuid.NewString()
	in.ExpectedVersion = 2
	in.Split = "EQUAL"
	in.ExactAllocations = nil
	return in
}

func independentEligibilityChange(ctx context.Context, tx pgx.Tx, f *expenseFixture, kind string) error {
	if _, err := tx.Exec(ctx, "SET LOCAL ROLE kami_migrator"); err != nil {
		return err
	}
	if kind == "account" {
		_, err := tx.Exec(ctx, `UPDATE app.users SET enabled=false WHERE id=$1`, f.id(102))
		return err
	}
	if kind == "unlink" {
		_, err := tx.Exec(ctx, `UPDATE app.users SET live_auth_id=NULL WHERE id=$1`, f.id(102))
		return err
	}
	if _, err := tx.Exec(ctx, `SELECT id FROM app.users WHERE id=$1 FOR UPDATE`, f.id(102)); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `SELECT id FROM app.groups WHERE id=$1 FOR UPDATE`, f.id(201)); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE app.memberships SET active=false WHERE id=$1`, f.id(302))
	return err
}

func independentWaitForLock(t *testing.T, f *expenseFixture, query string, args ...any) {
	t.Helper()
	deadline := time.Now().Add(4 * time.Second)
	for {
		var waiting bool
		if err := f.admin.QueryRow(f.ctx, query, args...).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("expected PostgreSQL lock wait was not observed")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestIndependentEditEligibilityTransitionWins(t *testing.T) {
	for _, kind := range []string{"membership", "account", "unlink"} {
		t.Run(kind, func(t *testing.T) {
			f := newExpenseFixture(t)
			in := independentZeroShareExpense(t, f)
			changer, err := pgx.Connect(f.ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
			if err != nil {
				t.Fatal(err)
			}
			defer changer.Close(context.Background())
			held, err := changer.Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer held.Rollback(context.Background())
			if err = independentEligibilityChange(f.ctx, held, f, kind); err != nil {
				t.Fatal(err)
			}
			done := make(chan expense.Outcome, 1)
			go func() { done <- performEdit(t, f, 1, in) }()
			independentWaitForLock(t, f, `SELECT EXISTS(SELECT FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))`, changer.PgConn().PID())
			if err = held.Commit(f.ctx); err != nil {
				t.Fatal(err)
			}
			out := <-done
			expected := "INELIGIBLE_MEMBER"
			if kind == "membership" {
				expected = "FORMER_MEMBER"
			}
			if out.Kind != "LOCKED" || out.LockReason != expected {
				t.Fatalf("transition winner allowed edit: %+v", out)
			}
			read := readEdited(t, f)
			if read.Records[0].Version != 2 || read.Records[0].CanEdit || !read.Balance.Settled {
				t.Fatalf("reopened departed/ineligible position: %+v", read)
			}
		})
	}
}

func TestIndependentEditWinsEligibilityTransition(t *testing.T) {
	for _, kind := range []string{"membership", "account", "unlink"} {
		t.Run(kind, func(t *testing.T) {
			f := newExpenseFixture(t)
			in := independentZeroShareExpense(t, f)
			lockKey := time.Now().UnixNano()
			fn := "test_pause_independent_edit"
			f.exec(fmt.Sprintf(`SET ROLE kami_migrator; CREATE FUNCTION app.%s() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(%d); RETURN NEW; END $$; CREATE TRIGGER %s BEFORE UPDATE ON app.expenses FOR EACH ROW EXECUTE FUNCTION app.%s(); RESET ROLE`, fn, lockKey, fn, fn))
			t.Cleanup(func() {
				if _, err := f.admin.Exec(context.Background(), fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; DROP TRIGGER IF EXISTS %s ON app.expenses; DROP FUNCTION IF EXISTS app.%s(); COMMIT`, fn, fn)); err != nil {
					t.Error(err)
				}
			})
			if _, err := f.admin.Exec(f.ctx, `SELECT pg_advisory_lock($1)`, lockKey); err != nil {
				t.Fatal(err)
			}
			defer f.admin.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, lockKey)
			written := make(chan expense.Outcome, 1)
			go func() { written <- performEdit(t, f, 1, in) }()
			independentWaitForLock(t, f, `SELECT EXISTS(SELECT FROM pg_locks WHERE locktype='advisory' AND NOT granted)`)
			changer, err := pgx.Connect(f.ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
			if err != nil {
				t.Fatal(err)
			}
			defer changer.Close(context.Background())
			changed := make(chan error, 1)
			go func() {
				tx, e := changer.Begin(f.ctx)
				if e != nil {
					changed <- e
					return
				}
				defer tx.Rollback(context.Background())
				e = independentEligibilityChange(f.ctx, tx, f, kind)
				if e == nil {
					e = tx.Commit(f.ctx)
				}
				changed <- e
			}()
			independentWaitForLock(t, f, `SELECT EXISTS(SELECT FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock')`, changer.PgConn().PID())
			if _, err = f.admin.Exec(f.ctx, `SELECT pg_advisory_unlock($1)`, lockKey); err != nil {
				t.Fatal(err)
			}
			if out := <-written; out.Kind != "COMMITTED" || out.Record.Version != 3 {
				t.Fatalf("edit winner: %+v", out)
			}
			err = <-changed
			if kind == "membership" && err == nil {
				t.Fatal("departure ignored newly reopened balance")
			}
			if kind != "membership" && err != nil {
				t.Fatal(err)
			}
			read := readEdited(t, f)
			if read.Balance.Settled {
				t.Fatal("edit did not reopen balance")
			}
			if kind != "membership" && read.Records[0].CanEdit {
				t.Fatal("account transition did not lock saved expense")
			}
			if out := performEdit(t, f, 1, in); out.Kind != "COMMITTED" || out.Record.Version != 3 {
				t.Fatalf("immutable winner recovery: %+v", out)
			}
		})
	}
}

func TestIndependentEditCreatorOnlyDepartureDoesNotLock(t *testing.T) {
	f := newExpenseFixture(t)
	in := editInput(f)
	// The original creator retains historical attribution but has no current
	// financial involvement. A different member owns the group before departure.
	in.PayerID = f.public("Membership", 302)
	in.ParticipantIDs = []string{f.public("Membership", 302)}
	if out := performEdit(t, f, 2, in); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	f.exec(fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; SELECT app.household_lifecycle_lock(ARRAY['%s','%s']::uuid[]); UPDATE app.groups SET owner_membership_id='%s' WHERE id='%s'; UPDATE app.memberships SET active=false WHERE id='%s'; UPDATE app.memberships SET active=false WHERE id='%s'; COMMIT`, f.id(101), f.id(102), f.id(302), f.id(201), f.id(301), f.id(303)))
	in.Key = uuid.NewString()
	in.ExpectedVersion = 2
	in.Note = "Creator and unrelated member have left"
	out := performEdit(t, f, 2, in)
	if out.Kind != "COMMITTED" || out.Record.CreatorMembershipID != f.public("Membership", 301) || out.Record.Version != 3 {
		t.Fatalf("creator-only or unrelated departure locked eligible expense: %+v", out)
	}
}

func TestIndependentEditRecoveryRetainsEarlierVersionAfterLaterEdit(t *testing.T) {
	f := newExpenseFixture(t)
	first := editInput(f)
	first.Total = 800
	committed := performEdit(t, f, 2, first)
	if committed.Kind != "COMMITTED" {
		t.Fatal(committed)
	}
	second := first
	second.Key = uuid.NewString()
	second.ExpectedVersion = 2
	second.Total = 600
	second.Note = "later note"
	if out := performEdit(t, f, 1, second); out.Kind != "COMMITTED" || out.Record.Version != 3 {
		t.Fatal(out)
	}
	verifiedEditCall(t, f, 2, func(ctx context.Context) {
		out, err := expense.New(f.db).RecoverEdit(ctx, first.GroupID, first.Key)
		if err != nil || out.Kind != "COMMITTED" || out.Record.Version != 2 || out.Record.TotalMinor != 800 || out.Record.Note != "" {
			t.Fatalf("recovery replaced immutable receipt with current values: %+v %v", out, err)
		}
	})
	if out := performEdit(t, f, 2, first); out.Kind != "COMMITTED" || out.Record.Version != 2 || out.Record.TotalMinor != 800 {
		t.Fatalf("retry rejected/reapplied older attempt: %+v", out)
	}
	verifiedEditCall(t, f, 1, func(ctx context.Context) {
		out, err := expense.New(f.db).Recover(ctx, f.input.GroupID, f.input.Key)
		if err != nil || out.Kind != "COMMITTED" || out.Record.TotalMinor != 1000 || out.Record.Description != "Dinner" {
			t.Fatalf("creation receipt changed: %+v %v", out, err)
		}
	})
	var versions int
	if err := f.admin.QueryRow(f.ctx, `SELECT count(*) FROM app.expense_revisions WHERE id=$1`, mustRaw(t, first.ExpenseID, "Expense")).Scan(&versions); err != nil {
		t.Fatal(err)
	}
	if versions != 3 {
		t.Fatalf("recovery wrote extra revisions: %d", versions)
	}
}

func TestIndependentEditHouseholdAnchorsAndMonthFilterMoves(t *testing.T) {
	f := independentViewDataset(t)
	first := independentViewRead(t, f, 1, 1, "", nil, "", "ExpenseView")
	full := independentViewRead(t, f, 1, 100, "", nil, "", "ExpenseView")
	target := ""
	for _, item := range full["edges"].([]any) {
		edge := item.(map[string]any)
		node := edge["node"].(map[string]any)
		if node["totalMinor"] == "400" {
			target = node["id"].(string)
		}
	}
	if target == "" {
		t.Fatal("missing Trip expense fixture")
	}
	filter := map[string]any{"category": "DINING"}
	filtered := independentViewRead(t, f, 1, 1, "", filter, "", "ExpenseView")
	in := editInput(f)
	in.ExpenseID = target
	in.GroupID = f.public("Group", 202)
	in.PayerID = f.public("Membership", 305)
	in.ParticipantIDs = []string{f.public("Membership", 306)}
	in.Total = 450
	in.Category = "OTHER"
	in.EffectiveDate = "2026-11-01"
	if out := performEdit(t, f, 1, in); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	fresh := independentViewRead(t, f, 1, 100, "", nil, "", "ExpenseView")
	independentViewSummary(t, fresh, "1050", "4", map[string][2]string{"2026-11": {"450", "1"}, "2026-10": {"100", "1"}, "2026-09": {"500", "2"}})
	continuation := independentViewRead(t, f, 1, 100, first["pageInfo"].(map[string]any)["endCursor"].(string), nil, "", "ExpenseView")
	independentViewSummary(t, continuation, "1000", "4", map[string][2]string{"2026-10": {"100", "1"}, "2026-09": {"900", "3"}})
	seen := map[string]bool{}
	for _, item := range append(first["edges"].([]any), continuation["edges"].([]any)...) {
		node := item.(map[string]any)["node"].(map[string]any)
		id := node["id"].(string)
		if seen[id] {
			t.Fatal("duplicate anchored expense", id)
		}
		seen[id] = true
		if id == target && (node["totalMinor"] != "400" || node["effectiveDate"] != "2026-09-30" || node["category"] != "DINING") {
			t.Fatal("anchored row mutated", node)
		}
	}
	if len(seen) != 4 || !seen[target] {
		t.Fatal("anchored expense skipped", seen)
	}
	filteredContinuation := independentViewRead(t, f, 1, 100, filtered["pageInfo"].(map[string]any)["endCursor"].(string), filter, "", "ExpenseView")
	independentViewSummary(t, filteredContinuation, "600", "2", map[string][2]string{"2026-09": {"600", "2"}})
	independentViewSummary(t, independentViewRead(t, f, 1, 100, "", filter, "", "ExpenseView"), "200", "1", map[string][2]string{"2026-09": {"200", "1"}})
	independentViewSummary(t, independentViewRead(t, f, 1, 100, "", map[string]any{"from": "2026-11-01", "to": "2026-11-01"}, "", "ExpenseView"), "450", "1", map[string][2]string{"2026-11": {"450", "1"}})
}
