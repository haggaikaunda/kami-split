//go:build integration

package banking

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func replacementConnection(t *testing.T, f *replacementFixture, binding uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := f.admin.QueryRow(context.Background(), `SELECT connection_id FROM app.banking_bindings WHERE id=$1`, binding).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func replacementCounts(t *testing.T, f *replacementFixture) [4]int {
	t.Helper()
	var n [4]int
	if err := f.admin.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM app.banking_plans WHERE account_id=$1),(SELECT count(*) FROM app.banking_archives a JOIN app.banking_plans p ON p.id=a.plan_id WHERE p.account_id=$1),(SELECT count(*) FROM app.banking_captures c JOIN app.banking_archives a ON a.id=c.archive_id JOIN app.banking_plans p ON p.id=a.plan_id WHERE p.account_id=$1),(SELECT count(*) FROM app.banking_bindings WHERE account_id=$1 AND reporting_state='retired')`, f.account).Scan(&n[0], &n[1], &n[2], &n[3]); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestIndependentReplacementPublicationRollbackAndRestart(t *testing.T) {
	f := newReplacementFixture(t)
	f.row(f.oldBinding, "2026-09-20", "10000", "posted", true)
	b := f.stage()
	f.usable(b)
	f.row(b, "2026-10-02", "5000", "posted", false)
	p := f.preview(b, "2026-09-30", "ACTIVATE")
	before := replacementCounts(t, f)
	command := ReplacementConfirmation{AttemptID: uuid.New(), Request: p.Request, Expected: p.Revisions}
	// Capture insertion happens after both plans, their intervals and source
	// references were written. Reject it to exercise rollback after those writes.
	f.exec(`CREATE FUNCTION app.independent_replacement_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic publication failure'; END $$`)
	f.exec(`CREATE TRIGGER independent_replacement_fail BEFORE INSERT ON app.banking_captures FOR EACH ROW EXECUTE FUNCTION app.independent_replacement_fail()`)
	t.Cleanup(func() {
		f.exec(`DROP TRIGGER IF EXISTS independent_replacement_fail ON app.banking_captures`)
		f.exec(`DROP FUNCTION IF EXISTS app.independent_replacement_fail()`)
	})
	if result := f.service.ConfirmReplacement(f.actor(f.owner), command); result.Code != "UNAVAILABLE" {
		t.Fatal("fault acknowledged publication", result.Code)
	}
	if after := replacementCounts(t, f); after != before {
		t.Fatal("partial plans/manifest/retirement survived rollback", after)
	}
	fresh := f.preview(b, "2026-09-30", "ACTIVATE")
	if fresh.Revisions != p.Revisions || fresh.ReportingRevision != p.ReportingRevision {
		t.Fatal("failed publication changed reporting state")
	}
	if result := f.service.OperationStatus(f.actor(f.owner), command.AttemptID); result.Code != "PENDING" {
		t.Fatal("failed publication lost recoverable intent", result.Code)
	}
	f.exec(`DROP TRIGGER independent_replacement_fail ON app.banking_captures`)
	restarted, err := New(f.db, f.service.protector)
	if err != nil {
		t.Fatal(err)
	}
	result := restarted.ConfirmReplacement(f.actor(f.owner), command)
	requireCode(t, result, "READY")
	if status := restarted.OperationStatus(f.actor(f.owner), command.AttemptID); status != result {
		t.Fatal("restart lost original receipt")
	}
	if counts := replacementCounts(t, f); counts != [4]int{2, 1, 2, 1} {
		t.Fatal("retry duplicated or omitted publication", counts)
	}
}

func TestIndependentReplacementExactBoundaryPendingAndProvenance(t *testing.T) {
	f := newReplacementFixture(t)
	june := f.row(f.oldBinding, "2026-06-12", "2000", "posted", false)
	excluded := f.row(f.oldBinding, "2026-09-20", "10000", "posted", true)
	f.row(f.oldBinding, "2026-09-30", "300", "posted", false)
	oldAfter := f.row(f.oldBinding, "2026-10-01", "900", "posted", false)
	f.row(f.oldBinding, "2026-09-30", "2500", "pending", false)
	b := f.stage()
	f.usable(b)
	f.row(b, "2026-09-30", "400", "posted", false)
	oct1 := f.row(b, "2026-10-01", "5000", "posted", false)
	f.row(b, "2026-10-02", "2700", "pending", false)
	p := f.preview(b, "2026-09-30", "ACTIVATE")
	if p.Prior.SpendingMinor != "3200" || p.Proposed.SpendingMinor != "7300" || p.Proposed.PendingCount != 1 || p.Archived.PendingCount != 1 || p.OldAfterBoundary.Count != 1 || p.Overlap.Count != 1 || p.Coverage != "unknown" {
		t.Fatal("D/D+1 or pending ownership incorrect")
	}
	f.confirm(p)
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,activity,note,excluded) VALUES($1,$4,2,1,'purchase','latest still-current edit',true),($2,$4,2,1,'purchase','latest archive-only edit',true),($3,$4,2,1,'purchase','June remains current',false)`, excluded, oldAfter, june, f.owner)
	r := f.preview(uuid.Nil, "", "RESTORE_PREDECESSOR")
	if r.ReportingRevision <= p.ReportingRevision || r.Prior.SpendingMinor != "7300" || r.Proposed.SpendingMinor != "2300" || r.Proposed.PendingCount != 0 {
		t.Fatal("archive edit affected current total or was not restored")
	}
	var captured, latest int64
	if err := f.admin.QueryRow(context.Background(), `SELECT (SELECT annotation_revision FROM app.banking_captures WHERE source_id=$1 LIMIT 1),(SELECT max(revision) FROM app.banking_annotations WHERE source_id=$1)`, excluded).Scan(&captured, &latest); err != nil || captured != 1 || latest != 2 {
		t.Fatal("immutable snapshot or one latest annotation identity lost", err)
	}
	var copied int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND note='latest still-current edit'`, oct1).Scan(&copied); err != nil || copied != 0 {
		t.Fatal("heuristic annotation transfer", err)
	}
	// A sibling's live Item survives; reporting recovery must leave the retired
	// source noncollecting even when its connection remains healthy.
	f.confirm(r)
	var state string
	var stopped bool
	if err := f.admin.QueryRow(context.Background(), `SELECT reporting_state,collection_stopped FROM app.banking_bindings WHERE id=$1`, f.oldBinding).Scan(&state, &stopped); err != nil || state != "retired" || !stopped {
		t.Fatal("restoration restarted old stream", err)
	}
}

func TestIndependentReplacementMissingCapturedFactBlocksRestoration(t *testing.T) {
	f := newReplacementFixture(t)
	source := f.row(f.oldBinding, "2026-10-02", "10000", "posted", false)
	b := f.stage()
	f.usable(b)
	f.row(b, "2026-10-02", "5000", "posted", false)
	f.confirm(f.preview(b, "2026-09-30", "ACTIVATE"))
	// Ordinary deletion is fenced and cannot violate provenance FKs. Deliberately
	// model unavailable/corrupt retained storage in this test-owned database only;
	// no schema/ACL change and no production writer bypass is introduced.
	f.exec(`RESET ROLE`)
	t.Cleanup(func() { f.exec(`SET ROLE kami_migrator`) })
	tx, err := f.admin.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), `SET LOCAL session_replication_role=replica`); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(context.Background(), `SET LOCAL ROLE kami_migrator`); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(context.Background(), `DELETE FROM app.banking_source_revisions WHERE source_id=$1`, source); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	f.exec(`SET ROLE kami_migrator`)
	request := ReplacementRequest{AccountID: f.account, Action: "RESTORE_PREDECESSOR"}
	p := f.service.PreviewReplacement(f.actor(f.owner), request)
	if p.Code != "DATA_UNAVAILABLE" {
		t.Fatal("missing captured facts offered exact restoration", p.Code)
	}
	before := replacementCounts(t, f)
	result := f.service.ConfirmReplacement(f.actor(f.owner), ReplacementConfirmation{AttemptID: uuid.New(), Request: request, Expected: p.Revisions})
	requireCode(t, result, "DATA_UNAVAILABLE")
	if replacementCounts(t, f) != before {
		t.Fatal("blocked restoration wrote a plan")
	}
}

func TestIndependentReplacementConcurrentLifecycleCannotResurrect(t *testing.T) {
	for _, recovery := range []bool{false, true} {
		for _, mode := range []string{"disconnect", "delete", "revocation", "repair"} {
			name := mode
			if recovery {
				name = "restore/" + name
			} else {
				name = "activate/" + name
			}
			t.Run(name, func(t *testing.T) {
				f := newReplacementFixture(t)
				f.row(f.oldBinding, "2026-09-20", "100", "posted", false)
				b := f.stage()
				f.usable(b)
				f.row(b, "2026-10-02", "200", "posted", false)
				p := f.preview(b, "2026-09-30", "ACTIVATE")
				if recovery {
					f.confirm(p)
					p = f.preview(uuid.Nil, "", "RESTORE_PREDECESSOR")
				}
				connection := replacementConnection(t, f, b)
				actor := f.actor(f.owner)
				life, status := f.service.ReadLifecycle(actor, connection)
				requireCode(t, status, "READY")
				var enrollment uuid.UUID
				if err := f.admin.QueryRow(context.Background(), `SELECT id FROM app.banking_enrollments WHERE connection_id=$1`, connection).Scan(&enrollment); err != nil {
					t.Fatal(err)
				}
				var event VerifiedWebhook
				if mode == "revocation" {
					body, _ := json.Marshal(map[string]string{"environment": "sandbox", "item_id": "item-public-" + enrollment.String(), "webhook_type": "ITEM", "webhook_code": "USER_PERMISSION_REVOKED"})
					signed := newWebhookFixture(t)
					var err error
					event, err = signed.verifier.Verify(context.Background(), signed.sign(t, body, signed.now, nil), body)
					if err != nil {
						t.Fatal(err)
					}
				}
				start := make(chan struct{})
				published := make(chan Result, 1)
				changed := make(chan Result, 1)
				go func() {
					<-start
					published <- f.service.ConfirmReplacement(actor, ReplacementConfirmation{AttemptID: uuid.New(), Request: p.Request, Expected: p.Revisions})
				}()
				go func() {
					<-start
					switch mode {
					case "disconnect":
						changed <- f.service.Stop(actor, FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: life.Generation})
					case "delete":
						changed <- f.service.DeleteHistory(actor, FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: life.Generation})
					case "revocation":
						if err := f.service.AcceptWebhook(context.Background(), enrollment, event); err != nil {
							changed <- Result{Code: "ERROR"}
						} else {
							changed <- Result{Code: "READY"}
						}
					case "repair":
						id := uuid.New()
						r := f.enrollment.StartRepair(actor, RepairInput{AttemptID: id, ConnectionID: connection, ExpectedGeneration: life.Generation})
						if r.Code != "PREPARED" {
							changed <- Result{Code: r.Code}
							return
						}
						r = f.enrollment.FinishRepair(actor, FinishRepairInput{AttemptID: id, AccountIDs: []string{"checking"}})
						changed <- Result{Code: r.Code}
					}
				}()
				close(start)
				var publication, mutation Result
				select {
				case publication = <-published:
				case <-time.After(10 * time.Second):
					t.Fatal("publication race did not finish")
				}
				select {
				case mutation = <-changed:
				case <-time.After(10 * time.Second):
					t.Fatal("lifecycle race did not finish")
				}
				if publication.Code != "READY" && publication.Code != "CONFLICT" && publication.Code != "NOT_FOUND" {
					t.Fatal("unexpected publication outcome", publication.Code)
				}
				if mode == "repair" {
					if mutation.Code != "READY" && mutation.Code != "REPLACEMENT_REQUIRED" && mutation.Code != "CONFLICT" {
						t.Fatal("repair race failed", mutation.Code)
					}
				} else {
					requireCode(t, mutation, "READY")
				}
				after, status := f.service.ReadLifecycle(actor, connection)
				requireCode(t, status, "READY")
				if mode == "delete" {
					if after.State != "deleted" || f.service.PreviewReplacement(actor, p.Request).Code != "NOT_FOUND" {
						t.Fatal("deleted history resurrected")
					}
				} else if mode != "repair" && after.State != "stopped" {
					t.Fatal("publication restarted stopped connection")
				}
				var sibling int
				if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_bindings b JOIN app.banking_accounts a ON a.id=b.account_id WHERE b.connection_id=$1 AND b.provider_account_id='savings' AND a.selected`, f.oldConnection).Scan(&sibling); err != nil || sibling != 1 {
					t.Fatal("race changed sibling", err)
				}
			})
		}
	}
}

func TestIndependentReplacementAnnotationLockConflict(t *testing.T) {
	f := newReplacementFixture(t)
	source := f.row(f.oldBinding, "2026-09-20", "100", "posted", false)
	b := f.stage()
	f.usable(b)
	f.row(b, "2026-10-02", "200", "posted", false)
	p := f.preview(b, "2026-09-30", "ACTIVATE")
	tx, err := f.admin.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), `INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,activity,excluded) VALUES($1,$2,2,1,'purchase',true)`, source, f.owner); err != nil {
		t.Fatal(err)
	}
	var pid int
	if err = tx.QueryRow(context.Background(), `SELECT pg_backend_pid()`).Scan(&pid); err != nil {
		t.Fatal(err)
	}
	observer, err := pgx.Connect(context.Background(), os.Getenv("TEST_DATABASE_ADMIN_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer observer.Close(context.Background())
	actor := f.actor(f.owner)
	done := make(chan Result, 1)
	go func() {
		done <- f.service.ConfirmReplacement(actor, ReplacementConfirmation{AttemptID: uuid.New(), Request: p.Request, Expected: p.Revisions})
	}()
	blocked := false
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var n int
		if err = observer.QueryRow(context.Background(), `SELECT count(*) FROM pg_locks WHERE NOT granted AND $1=ANY(pg_blocking_pids(pid))`, pid).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			blocked = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !blocked {
		t.Fatal("confirmation never reached PostgreSQL annotation lock")
	}
	if err = tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	select {
	case r := <-done:
		requireCode(t, r, "CONFLICT")
	case <-time.After(5 * time.Second):
		t.Fatal("confirmation remained blocked")
	}
	if replacementCounts(t, f) != [4]int{} {
		t.Fatal("stale annotation partially published")
	}
}

func TestIndependentReplacementEmptyUsableImportPublishesEmptyPlan(t *testing.T) {
	f := newReplacementFixture(t)
	b := f.stage()
	f.usable(b)
	p := f.preview(b, "2026-09-30", "ACTIVATE")
	if p.Prior.Count != 0 || p.Proposed.Count != 0 || p.Coverage != "unknown" {
		t.Fatal("empty usable fixture has unexpected impact")
	}
	result := f.service.ConfirmReplacement(f.actor(f.owner), ReplacementConfirmation{AttemptID: uuid.New(), Request: p.Request, Expected: p.Revisions})
	if result.Code != "READY" {
		// Diagnose only this synthetic empty fixture through the same database
		// publication wrapper; the failed service transaction has already rolled back.
		tx, err := f.admin.Begin(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(context.Background())
		if _, err = tx.Exec(context.Background(), `SELECT set_config('app.verified_sub',$1,true)`, f.owner.String()); err != nil {
			t.Fatal(err)
		}
		snapshot, err := readReplacement(context.Background(), tx, f.account)
		if err != nil {
			t.Fatal(err)
		}
		_, proposal := prepareReplacement(snapshot, p.Request, time.Now())
		expected, _ := json.Marshal(p.Revisions)
		encoded, _ := json.Marshal(proposal)
		var id *uuid.UUID
		err = tx.QueryRow(context.Background(), `SELECT app.banking_replacement_publish($1,$2,$3)`, f.account, expected, encoded).Scan(&id)
		t.Fatalf("empty usable import did not publish: service=%s, database=%v", result.Code, err)
	}
	if result.ID == uuid.Nil {
		t.Fatal("empty publication omitted durable plan identity")
	}
}
