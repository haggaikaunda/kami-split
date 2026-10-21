//go:build integration

package banking

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/jackc/pgx/v5"
)

type syncStoreFixture struct {
	*fixture
	worker                       *database.WorkerDB
	work                         database.BankingWork
	account, binding, connection uuid.UUID
}

func newSyncFixture(t *testing.T) *syncStoreFixture {
	t.Helper()
	f := newFixture(t)
	connection := f.connection(f.owner, uuid.NewString())
	account, binding := f.binding(f.owner, connection, "checking")
	f.exec(`UPDATE app.banking_connections SET permission_state='granted' WHERE id=$1`, connection)
	worker, err := database.OpenWorker(context.Background(), database.Config{URL: os.Getenv("TEST_WORKER_DATABASE_URL"), MaxConns: 5, Timeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(worker.Close)
	sf := &syncStoreFixture{fixture: f, worker: worker, account: account, binding: binding, connection: connection}
	sf.work = sf.lease(connection)
	t.Cleanup(func() {
		// Only this fixture's owners are removed. Other suites retain their own
		// dump/restore fixtures and queue state. No scheduler-visible test Items
		// may leak into the later lifecycle worker's exact transport assertions.
		f.exec(`DELETE FROM app.banking_sync_batches WHERE owner_id IN($1,$2)`, f.owner, f.other)
		f.exec(`INSERT INTO app.banking_account_barriers(account_id,owner_id,connection_id,generation) SELECT DISTINCT ON(b.account_id) b.account_id,b.owner_id,b.connection_id,1 FROM app.banking_bindings b WHERE b.owner_id IN($1,$2) ON CONFLICT DO NOTHING`, f.owner, f.other)
		f.exec(`UPDATE app.banking_sources SET revision=NULL WHERE owner_id IN($1,$2)`, f.owner, f.other)
		for _, table := range []string{"annotations", "source_revisions", "sources"} {
			f.exec(`DELETE FROM app.banking_`+table+` WHERE owner_id IN($1,$2)`, f.owner, f.other)
		}
		for _, table := range []string{"webhook_deliveries", "webhook_receipts"} {
			f.exec(`DELETE FROM app.banking_`+table+` WHERE correlation_id IN(SELECT id FROM app.banking_webhook_correlations WHERE connection_id IN(SELECT id FROM app.banking_connections WHERE owner_id IN($1,$2)))`, f.owner, f.other)
		}
		f.exec(`DELETE FROM app.banking_webhook_correlations WHERE connection_id IN(SELECT id FROM app.banking_connections WHERE owner_id IN($1,$2))`, f.owner, f.other)
		f.exec(`DELETE FROM app.banking_bindings WHERE owner_id IN($1,$2)`, f.owner, f.other)
		f.exec(`DELETE FROM app.banking_accounts WHERE owner_id IN($1,$2)`, f.owner, f.other)
		f.exec(`SELECT pgmq.delete('banking_lifecycle',message_id) FROM app.banking_work WHERE connection_id IN(SELECT id FROM app.banking_connections WHERE owner_id IN($1,$2)) AND message_id IS NOT NULL`, f.owner, f.other)
		f.exec(`DELETE FROM app.banking_work WHERE connection_id IN(SELECT id FROM app.banking_connections WHERE owner_id IN($1,$2))`, f.owner, f.other)
		f.exec(`DELETE FROM app.banking_credentials WHERE owner_id IN($1,$2)`, f.owner, f.other)
		f.exec(`DELETE FROM app.banking_connections WHERE owner_id IN($1,$2)`, f.owner, f.other)
	})
	return sf
}
func (f *syncStoreFixture) lease(connection uuid.UUID) database.BankingWork {
	f.t.Helper()
	work := database.BankingWork{ID: uuid.New(), Token: uuid.New(), ConnectionID: connection, Generation: 1, Kind: "reconcile"}
	if err := f.admin.QueryRow(context.Background(), `INSERT INTO app.banking_work(id,connection_id,generation,kind,state,lease_token,lease_until) SELECT $1,id,generation,'reconcile','running',$3,clock_timestamp()+interval '30 minutes' FROM app.banking_connections WHERE id=$2 ON CONFLICT(connection_id,generation,kind) DO UPDATE SET state='running',lease_token=$3,lease_until=clock_timestamp()+interval '30 minutes' RETURNING id,generation`, work.ID, connection, work.Token).Scan(&work.ID, &work.Generation); err != nil {
		f.t.Fatal(err)
	}
	return work
}
func (f *syncStoreFixture) begin() SyncBatch {
	f.t.Helper()
	return f.beginBinding(f.binding, f.work)
}
func (f *syncStoreFixture) beginBinding(binding uuid.UUID, work database.BankingWork) SyncBatch {
	f.t.Helper()
	batch, err := BeginSyncBatch(context.Background(), f.worker, work, binding, uuid.New())
	if err != nil {
		f.t.Fatal(err)
	}
	return batch
}
func syncFact(id, date string, amount int64) SyncTransaction {
	return SyncTransaction{TransactionID: id, AccountID: "checking", Date: date, AmountMinor: amount, Currency: "USD"}
}
func (f *syncStoreFixture) stage(batch SyncBatch, ordinal int, from SyncCursor, next string, more bool, added, modified []SyncTransaction, removed ...string) SyncCursor {
	f.t.Helper()
	cursor, err := NewSyncCursor(batch.binding, next)
	if err != nil {
		f.t.Fatal(err)
	}
	page := SyncPage{Binding: batch.binding, NextCursor: cursor, HasMore: more, Added: added, Modified: modified}
	for _, id := range removed {
		page.Removed = append(page.Removed, SyncRemoval{TransactionID: id})
	}
	code, err := StageSyncPage(context.Background(), f.worker, f.work, batch, ordinal, from, page)
	if err != nil || code != "READY" {
		f.t.Fatal("stage", code, err)
	}
	return cursor
}
func (f *syncStoreFixture) commit(batch SyncBatch, expected string) database.BankingSyncCommit {
	f.t.Helper()
	result, err := CommitSyncBatch(context.Background(), f.worker, f.work, batch)
	if err != nil || result.Code != expected {
		f.t.Fatal("commit", result.Code, err)
	}
	return result
}
func (f *syncStoreFixture) sourceID(id string) uuid.UUID {
	f.t.Helper()
	var source uuid.UUID
	if err := f.admin.QueryRow(context.Background(), `SELECT source_id FROM app.banking_source_identities WHERE binding_id=$1 AND provider_transaction_id=$2`, f.binding, id).Scan(&source); err != nil {
		f.t.Fatal(err)
	}
	return source
}
func (f *syncStoreFixture) assertStream(cursor string, count int) {
	f.t.Helper()
	var actual string
	var n int
	if err := f.admin.QueryRow(context.Background(), `SELECT coalesce(b.sync_cursor,''),(SELECT count(*) FROM app.banking_sources s WHERE s.binding_id=b.id) FROM app.banking_bindings b WHERE b.id=$1`, f.binding).Scan(&actual, &n); err != nil {
		f.t.Fatal(err)
	}
	if actual != cursor || n != count {
		f.t.Fatalf("source/checkpoint incoherence: count=%d expected=%d", n, count)
	}
}

func TestSyncBatchAtomicPagesPendingLinkAndAnnotations(t *testing.T) {
	f := newSyncFixture(t)
	pending := syncFact("pending", "2026-09-30", 2500)
	pending.Pending = true
	batch := f.begin()
	next := f.stage(batch, 0, batch.Cursor(), "page-1", true, []SyncTransaction{pending}, nil)
	f.assertStream("", 0)
	f.commit(batch, "CONFLICT")
	posted := syncFact("posted", "2026-10-01", 2700)
	posted.PendingTransactionID = &pending.TransactionID
	f.stage(batch, 1, next, "complete-1", false, []SyncTransaction{posted, syncFact("refund", "2026-10-02", -400)}, nil, "pending")
	f.assertStream("", 0)
	outcome := f.commit(batch, "READY")
	f.assertStream("complete-1", 2)
	if outcome.ImportRevision != 2 || outcome.DataRevision != 2 || outcome.ReportingRevision < 2 || outcome.CommittedAt == "" {
		t.Fatal("missing coherent local outcome")
	}
	if again := f.commit(batch, "READY"); again != outcome {
		t.Fatal("response-loss replay changed outcome")
	}
	source := f.sourceID("pending")
	if f.sourceID("posted") != source || queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_source_revisions WHERE source_id=$1`, source) != 2 {
		t.Fatal("explicit cross-page linkage lost stable ID or old version")
	}
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,category,activity,note,excluded,reviewed) VALUES($1,$2,1,2,'food','purchase','retained owner intent',true,true)`, source, f.owner)
	batch = f.begin()
	changed := posted
	name := "new merchant spelling"
	changed.Name = &name
	f.stage(batch, 0, batch.Cursor(), "complete-2", false, nil, []SyncTransaction{changed})
	f.commit(batch, "READY")
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND revision=2 AND note='retained owner intent' AND reviewed AND excluded AND NOT material_conflict AND material_source_revision=2 AND applies_to_source_revision=3`, source) != 1 {
		t.Fatal("nonmaterial change discarded valid annotation")
	}
	batch = f.begin()
	changed.AmountMinor = -2700
	f.stage(batch, 0, batch.Cursor(), "complete-3", false, nil, []SyncTransaction{changed})
	f.commit(batch, "READY")
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND revision=3 AND note='retained owner intent' AND activity='purchase' AND excluded AND NOT reviewed AND material_conflict AND material_source_revision=2 AND applies_to_source_revision=4`, source) != 1 {
		t.Fatal("material correction lost intent or remained reviewed")
	}
	batch = f.begin()
	f.stage(batch, 0, batch.Cursor(), "complete-4", false, nil, nil, "posted", "never-seen")
	f.commit(batch, "READY")
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_source_revisions r JOIN app.banking_sources s ON s.id=r.source_id AND s.revision=r.revision WHERE s.id=$1 AND r.processing_state='removed'`, source) != 1 || queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_sync_removals WHERE binding_id=$1`, f.binding) != 3 {
		t.Fatal("removed history missing")
	}
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.expenses e JOIN app.memberships m ON m.id=e.creator_id WHERE m.user_id=$1`, f.owner) != 0 {
		t.Fatal("bank sync mutated shared expenses")
	}
}

func TestSyncBatchInvalidCancelledRestartAndCompetingCommits(t *testing.T) {
	f := newSyncFixture(t)
	batch := f.begin()
	next := f.stage(batch, 0, batch.Cursor(), "page-1", true, []SyncTransaction{syncFact("one", "2026-10-01", 100)}, nil)
	// Same page can be redelivered; a changed ordinal cannot replace its facts.
	page := SyncPage{Binding: batch.binding, NextCursor: next, HasMore: true, Added: []SyncTransaction{syncFact("one", "2026-10-01", 100)}}
	if code, err := StageSyncPage(context.Background(), f.worker, f.work, batch, 0, batch.Cursor(), page); err != nil || code != "READY" {
		t.Fatal(code, err)
	}
	page.Added[0].AmountMinor = 101
	if code, err := StageSyncPage(context.Background(), f.worker, f.work, batch, 0, batch.Cursor(), page); err != nil || code != "INVALID_BATCH" {
		t.Fatal(code, err)
	}
	f.commit(batch, "CONFLICT")
	f.assertStream("", 0)
	batch = f.begin()
	f.stage(batch, 0, batch.Cursor(), "abandoned", false, []SyncTransaction{syncFact("abandoned", "2026-10-01", 1)}, nil)
	if ok, err := CancelSyncBatch(context.Background(), f.worker, f.work, batch); err != nil || !ok {
		t.Fatal(ok, err)
	}
	f.commit(batch, "CONFLICT")
	f.assertStream("", 0)
	first, second := f.begin(), f.begin()
	f.stage(first, 0, first.Cursor(), "winner-a", false, []SyncTransaction{syncFact("winner-a", "2026-10-01", 1)}, nil)
	f.stage(second, 0, second.Cursor(), "winner-b", false, []SyncTransaction{syncFact("winner-b", "2026-10-01", 2)}, nil)
	start := make(chan struct{})
	results := make(chan database.BankingSyncCommit, 2)
	errs := make(chan error, 2)
	for _, b := range []SyncBatch{first, second} {
		go func() {
			<-start
			r, e := CommitSyncBatch(context.Background(), f.worker, f.work, b)
			results <- r
			errs <- e
		}()
	}
	close(start)
	codes := map[string]int{}
	for range 2 {
		r := <-results
		if e := <-errs; e != nil {
			t.Fatal(e)
		}
		codes[r.Code]++
	}
	if codes["READY"] != 1 || codes["CONFLICT"] != 1 {
		t.Fatal("competing batches both won", codes)
	}
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_sources WHERE binding_id=$1`, f.binding) != 1 {
		t.Fatal("competing source effect")
	}
	// Startup after response loss reads the committed checkpoint, never a staged one.
	fresh := f.begin()
	if !strings.HasPrefix(fresh.Cursor().Opaque(), "winner-") {
		t.Fatal("restart lost trusted checkpoint")
	}
	f.exec(`UPDATE app.banking_sync_batches SET expires_at=clock_timestamp()-interval '1 second' WHERE owner_id=$1`, f.owner)
	if n, err := f.worker.CleanupBankingSync(context.Background()); err != nil || n < 4 {
		t.Fatal(n, err)
	}
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_sources WHERE binding_id=$1`, f.binding) != 1 {
		t.Fatal("staging expiry erased retained history")
	}
}

func TestSyncBatchRestrictedAuthorityAndDatabaseRollback(t *testing.T) {
	f := newSyncFixture(t)
	batch := f.begin()
	f.stage(batch, 0, batch.Cursor(), "final", false, []SyncTransaction{syncFact("a", "2026-10-01", 100), syncFact("z", "2026-10-02", 200)}, nil)
	// Fail after an earlier source has been inserted, proving SQL rollback covers
	// all changes and checkpoint rather than trusting application prevalidation.
	f.exec(`CREATE FUNCTION app.sync_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.amount_minor=200 THEN RAISE EXCEPTION 'synthetic import failure'; END IF; RETURN NEW; END $$`)
	f.exec(`CREATE TRIGGER sync_test_failure BEFORE INSERT ON app.banking_source_revisions FOR EACH ROW EXECUTE FUNCTION app.sync_test_failure()`)
	_, err := CommitSyncBatch(context.Background(), f.worker, f.work, batch)
	f.exec(`DROP TRIGGER sync_test_failure ON app.banking_source_revisions`)
	f.exec(`DROP FUNCTION app.sync_test_failure()`)
	if err == nil {
		t.Fatal("injected transactional failure was ignored")
	}
	f.assertStream("", 0)
	f.commit(batch, "READY")
	f.assertStream("final", 2)
	other := f.fixture.connection(f.other, uuid.NewString())
	_, binding := f.fixture.binding(f.other, other, "checking")
	if _, err := BeginSyncBatch(context.Background(), f.worker, f.work, binding, uuid.New()); err == nil {
		t.Fatal("lease crossed owner/Item boundary")
	}
	wrong := f.work
	wrong.Token = uuid.New()
	if result, err := CommitSyncBatch(context.Background(), f.worker, wrong, batch); err != nil || result.Code != "DENIED" {
		t.Fatal(result.Code, err)
	}
	// Test actual login roles, including helper execution and impersonation denial.
	for _, role := range []string{"kami_worker", "kami_api", "anon", "authenticated", "service_role"} {
		url := os.Getenv("TEST_DATABASE_ADMIN_URL")
		if role == "kami_worker" {
			url = os.Getenv("TEST_WORKER_DATABASE_URL")
		}
		if role == "kami_api" {
			url = os.Getenv("TEST_DATABASE_URL")
		}
		conn, err := pgx.Connect(context.Background(), url)
		if err != nil {
			t.Fatal(err)
		}
		if role != "kami_worker" && role != "kami_api" {
			if _, err = conn.Exec(context.Background(), `SET ROLE `+role); err != nil {
				t.Fatal(err)
			}
		}
		if role == "kami_worker" {
			if _, err = conn.Exec(context.Background(), `SET ROLE kami_api`); err == nil {
				t.Fatal("worker impersonated API")
			}
		}
		for _, sql := range []string{`SELECT * FROM app.banking_sync_pages`, `INSERT INTO app.banking_sources(id) VALUES(gen_random_uuid())`, `SELECT app.banking_sync_apply(NULL,NULL,'{}',false)`, `SELECT app.banking_sync_authorized(NULL,NULL,NULL)`} {
			if _, err = conn.Exec(context.Background(), sql); err == nil {
				t.Fatalf("role %s gained direct authority", role)
			}
		}
		if role != "kami_worker" {
			if _, err = conn.Exec(context.Background(), `SELECT app.banking_sync_begin(NULL,NULL,NULL,NULL)`); err == nil {
				t.Fatalf("role %s gained sync wrapper", role)
			}
		}
		if err = conn.Close(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSyncBatchLifecycleFencesWinActualBlockedWrites(t *testing.T) {
	for _, fence := range []string{"disconnect", "item_revocation", "account_revocation", "deselection", "disable", "user_delete", "history_delete"} {
		t.Run(fence, func(t *testing.T) {
			f := newSyncFixture(t)
			siblingAccount, sibling := f.fixture.binding(f.owner, f.connection, "savings")
			// Positive persisted provider metadata lets the existing selection wrapper
			// retain only the sibling while deselecting the target account.
			f.exec(`INSERT INTO app.banking_enrollment_accounts(binding_id,owner_id,environment,institution_id,stable_id,display_name,currency,requested_history_days) VALUES($1,$3,'sandbox','synthetic-bank','','Checking','USD',365),($2,$3,'sandbox','synthetic-bank','','Savings','USD',365)`, f.binding, sibling, f.owner)
			correlation := uuid.New()
			f.exec(`INSERT INTO app.banking_webhook_correlations(id,connection_id,generation) VALUES($1,$2,1)`, correlation, f.connection)
			batch := f.begin()
			f.stage(batch, 0, batch.Cursor(), "must-not-commit", false, []SyncTransaction{syncFact("late", "2026-10-01", 100)}, nil)
			lock, err := pgx.Connect(context.Background(), os.Getenv("TEST_DATABASE_ADMIN_URL"))
			if err != nil {
				t.Fatal(err)
			}
			defer lock.Close(context.Background())
			tx, err := lock.Begin(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(context.Background())
			if _, err = tx.Exec(context.Background(), `SET LOCAL ROLE kami_migrator`); err != nil {
				t.Fatal(err)
			}
			if _, err = tx.Exec(context.Background(), `SELECT set_config('app.verified_sub',$1,true)`, f.owner.String()); err != nil {
				t.Fatal(err)
			}
			// Acquire the real lifecycle mutation before starting the blocked commit.
			switch fence {
			case "disconnect", "history_delete":
				_, err = tx.Exec(context.Background(), `SELECT app.banking_fence($1,1,$2)`, f.connection, fence == "history_delete")
			case "item_revocation", "account_revocation":
				code := "USER_PERMISSION_REVOKED"
				if fence == "account_revocation" {
					code = "USER_ACCOUNT_REVOKED"
				}
				_, err = tx.Exec(context.Background(), `SELECT app.banking_accept_lifecycle_webhook($1,'sandbox',$2,sha256('sync-fence'::bytea),sha256('delivery'::bytea),'ITEM',$3,'checking',true)`, correlation, uuidItem(t, f), code)
			case "deselection":
				var selectionCode string
				err = tx.QueryRow(context.Background(), `SELECT app.banking_selection($1,1,'[{"ID":"savings","Kind":"checking","Currency":"USD","StableID":"","Name":"Savings"}]'::jsonb,'synthetic-bank',$2)`, f.connection, uuidItem(t, f)).Scan(&selectionCode)
				if err == nil && selectionCode != "READY" {
					t.Fatal("selection wrapper", selectionCode)
				}
			case "disable":
				_, err = tx.Exec(context.Background(), `UPDATE app.users SET enabled=false WHERE id=$1`, f.owner)
			case "user_delete":
				if _, err = tx.Exec(context.Background(), `UPDATE app.users SET enabled=false WHERE id=$1`, f.owner); err == nil {
					if _, err = tx.Exec(context.Background(), `RESET ROLE`); err == nil {
						_, err = tx.Exec(context.Background(), `DELETE FROM auth.users WHERE id=$1`, f.owner)
					}
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err = tx.Exec(context.Background(), `RESET ROLE`); err != nil {
				t.Fatal(err)
			}
			done := make(chan database.BankingSyncCommit, 1)
			fail := make(chan error, 1)
			go func() { r, e := CommitSyncBatch(context.Background(), f.worker, f.work, batch); done <- r; fail <- e }()
			// A committed fence must release its row locks before a valid write can finish.
			deadline := time.Now().Add(2 * time.Second)
			for {
				var waiting bool
				if err = tx.QueryRow(context.Background(), `SELECT EXISTS(SELECT FROM pg_stat_activity WHERE pg_backend_pid()=ANY(pg_blocking_pids(pid)))`).Scan(&waiting); err != nil {
					t.Fatal(err)
				}
				if waiting {
					break
				}
				select {
				case <-done:
					t.Fatal("commit bypassed uncommitted lifecycle fence")
				default:
				}
				if time.Now().After(deadline) {
					t.Fatal("source commit never overlapped lifecycle lock")
				}
				time.Sleep(5 * time.Millisecond)
			}
			if err = tx.Commit(context.Background()); err != nil {
				t.Fatal(err)
			}
			result := <-done
			if err = <-fail; err != nil || result.Code == "READY" {
				t.Fatal(result.Code, err)
			}
			f.assertStream("", 0)
			if fence == "account_revocation" || fence == "deselection" {
				if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_accounts a JOIN app.banking_bindings b ON b.account_id=a.id WHERE a.id=$1 AND a.selected AND b.id=$2 AND NOT b.collection_stopped`, siblingAccount, sibling) != 1 {
					t.Fatal("account fence stopped sibling")
				}
				f.work = f.lease(f.connection)
				good := f.beginBinding(sibling, f.work)
				// The sibling still has independent collection authority, even though its
				// provider account differs from the revoked binding.
				cursor, _ := NewSyncCursor(good.binding, "sibling-ok")
				code, err := StageSyncPage(context.Background(), f.worker, f.work, good, 0, good.Cursor(), SyncPage{Binding: good.binding, NextCursor: cursor})
				if err != nil || code != "READY" {
					t.Fatal(code, err)
				}
				f.commit(good, "READY")
			}
		})
	}
}
func uuidItem(t *testing.T, f *syncStoreFixture) string {
	t.Helper()
	var item string
	if err := f.admin.QueryRow(context.Background(), `SELECT provider_item_id FROM app.banking_connections WHERE id=$1`, f.connection).Scan(&item); err != nil {
		t.Fatal(err)
	}
	return item
}

func TestSyncBatchAnnotationAndReplacementRevisionFences(t *testing.T) {
	f := newSyncFixture(t)
	batch := f.begin()
	f.stage(batch, 0, batch.Cursor(), "initial", false, []SyncTransaction{syncFact("initial", "2026-10-01", 100)}, nil)
	f.commit(batch, "READY")
	source := f.sourceID("initial")
	batch = f.begin()
	f.stage(batch, 0, batch.Cursor(), "stale", false, nil, []SyncTransaction{syncFact("initial", "2026-10-01", 200)})
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,note) VALUES($1,$2,1,1,'concurrent note')`, source, f.owner)
	f.commit(batch, "CONFLICT")
	f.assertStream("initial", 1)
	batch = f.begin()
	f.stage(batch, 0, batch.Cursor(), "fresh", false, nil, []SyncTransaction{syncFact("initial", "2026-10-01", 200)})
	f.commit(batch, "READY")
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND note='concurrent note'`, source) != 2 {
		t.Fatal("concurrent note discarded")
	}
}

func TestSyncBatchPendingIdentityRequiresExactUnchangedLinks(t *testing.T) {
	f := newSyncFixture(t)
	batch := f.begin()
	pending := syncFact("pending-a", "2026-10-01", 100)
	pending.Pending = true
	other := syncFact("pending-b", "2026-10-01", 100)
	other.Pending = true
	f.stage(batch, 0, batch.Cursor(), "identities-1", false, []SyncTransaction{pending, other}, nil)
	f.commit(batch, "READY")
	original := f.sourceID("pending-a")
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,note,reviewed) VALUES($1,$2,1,1,'belongs only to explicit source',true)`, original, f.owner)
	batch = f.begin()
	unlinked := syncFact("unlinked-posted", "2026-10-01", 100)
	f.stage(batch, 0, batch.Cursor(), "identities-2", false, []SyncTransaction{unlinked}, nil, "pending-a")
	f.commit(batch, "READY")
	if f.sourceID("unlinked-posted") == original || queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1`, f.sourceID("unlinked-posted")) != 0 {
		t.Fatal("missing link caused fuzzy merge or note transfer")
	}
	batch = f.begin()
	posted := syncFact("explicit-posted", "2026-10-02", 100)
	posted.PendingTransactionID = &pending.TransactionID
	f.stage(batch, 0, batch.Cursor(), "identities-3", false, []SyncTransaction{posted}, nil)
	f.commit(batch, "READY")
	if f.sourceID("explicit-posted") != original {
		t.Fatal("explicit link lost previously removed pending provenance")
	}
	batch = f.begin()
	posted.PendingTransactionID = &other.TransactionID
	f.stage(batch, 0, batch.Cursor(), "identities-invalid", false, nil, []SyncTransaction{posted})
	if _, err := CommitSyncBatch(context.Background(), f.worker, f.work, batch); err == nil {
		t.Fatal("changed explicit link merged two source histories")
	}
	f.assertStream("identities-3", 3)
	// Already stale review is not acknowledged by a later nonmaterial bank change.
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,applies_to_source_revision,note,reviewed) VALUES($1,$2,4,1,3,'stale draft',true)`, original, f.owner)
	batch = f.begin()
	posted.PendingTransactionID = &pending.TransactionID
	name := "description only"
	posted.Name = &name
	f.stage(batch, 0, batch.Cursor(), "identities-4", false, nil, []SyncTransaction{posted})
	f.commit(batch, "READY")
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND revision=5 AND note='stale draft' AND material_source_revision=1 AND NOT reviewed`, original) != 1 {
		t.Fatal("nonmaterial update re-acknowledged stale review")
	}
}

func TestSyncBatchRealImportReplacementBoundariesRecoveryAndPurge(t *testing.T) {
	rf := newReplacementFixture(t)
	db, err := database.OpenWorker(context.Background(), database.Config{URL: os.Getenv("TEST_WORKER_DATABASE_URL"), MaxConns: 5, Timeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	f := &syncStoreFixture{fixture: rf.fixture, worker: db, account: rf.account, binding: rf.oldBinding, connection: rf.oldConnection}
	t.Cleanup(func() { f.exec(`DELETE FROM app.banking_sync_batches WHERE owner_id=$1`, f.owner) })
	f.work = f.lease(f.connection)
	batch := f.begin()
	oldPending := syncFact("old-pending", "2026-09-30", 2500)
	oldPending.Pending = true
	f.stage(batch, 0, batch.Cursor(), "old-import", false, []SyncTransaction{syncFact("june", "2026-06-12", 2000), syncFact("excluded", "2026-09-20", 10000), syncFact("on-D", "2026-09-30", 300), oldPending}, nil)
	f.commit(batch, "READY")
	june, excluded, onD, oldPendingID := f.sourceID("june"), f.sourceID("excluded"), f.sourceID("on-D"), f.sourceID("old-pending")
	for _, source := range []uuid.UUID{june, excluded, onD} {
		f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,activity,note,excluded,reviewed) VALUES($1,$2,1,1,'purchase','retained original note',$3,true)`, source, f.owner, source == excluded)
	}
	replacement := rf.stage()
	f.binding = replacement
	if err := f.admin.QueryRow(context.Background(), `SELECT connection_id FROM app.banking_bindings WHERE id=$1`, replacement).Scan(&f.connection); err != nil {
		t.Fatal(err)
	}
	f.work = f.lease(f.connection)
	batch = f.begin()
	f.stage(batch, 0, batch.Cursor(), "new-initial", false, []SyncTransaction{syncFact("overlap", "2026-09-20", 10000), syncFact("new-on-D", "2026-09-30", 400), syncFact("october", "2026-10-02", 5000)}, nil)
	f.commit(batch, "READY")
	overlap, newOnD, october := f.sourceID("overlap"), f.sourceID("new-on-D"), f.sourceID("october")
	for _, source := range []uuid.UUID{overlap, newOnD, october} {
		f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,activity,reviewed) VALUES($1,$2,1,1,'purchase',true)`, source, f.owner)
	}
	preview := rf.preview(replacement, "2026-09-30", "ACTIVATE")
	if preview.Prior.SpendingMinor != "2300" || preview.Proposed.SpendingMinor != "7300" || preview.Overlap.Count != 2 || queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_sources WHERE binding_id=$1 AND discrepancy<>'none'`, replacement) != 0 {
		t.Fatal("D-inclusive ownership or initial overlap classification", preview.Prior.SpendingMinor, preview.Proposed.SpendingMinor)
	}
	// A commit invalidates an already captured activation preview.
	batch = f.begin()
	f.stage(batch, 0, batch.Cursor(), "new-second", false, []SyncTransaction{syncFact("later-history", "2026-09-29", 100)}, nil)
	f.commit(batch, "READY")
	if result := f.service.ConfirmReplacement(f.actor(f.owner), ReplacementConfirmation{AttemptID: uuid.New(), Request: preview.Request, Expected: preview.Revisions}); result.Code != "CONFLICT" {
		t.Fatal("activation ignored new import revision", result.Code)
	}
	// Initial overlap was accepted. Once ownership exists, later pre-D changes
	// must be inspectable historical discrepancies rather than contributions.
	preview = rf.preview(replacement, "2026-09-30", "ACTIVATE")
	staleBatch := f.begin()
	f.stage(staleBatch, 0, staleBatch.Cursor(), "activation-race", false, []SyncTransaction{syncFact("racing", "2026-10-03", 1)}, nil)
	rf.confirm(preview)
	f.commit(staleBatch, "CONFLICT")
	if _, err := BeginSyncBatch(context.Background(), db, f.lease(rf.oldConnection), rf.oldBinding, uuid.New()); err == nil {
		t.Fatal("retired stream regained collection")
	}
	batch = f.begin()
	f.stage(batch, 0, batch.Cursor(), "historical", false, []SyncTransaction{syncFact("new-late-history", "2026-09-29", 200)}, []SyncTransaction{syncFact("overlap", "2026-09-20", 9000)}, "new-on-D")
	f.commit(batch, "READY")
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_sources WHERE binding_id=$1 AND discrepancy='historical_discrepancy'`, replacement) != 3 {
		t.Fatal("later added/modified/removed pre-D facts lost discrepancy")
	}
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_sources WHERE id IN($1,$2,$3) AND revision=1`, june, excluded, onD) != 3 || queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND note='retained original note' AND excluded AND reviewed`, excluded) != 1 {
		t.Fatal("replacement changed prior source IDs/annotations")
	}
	previousRevision := int64(0)
	for i, date := range []string{"2026-09-29", "2026-10-03"} {
		batch = f.begin()
		f.stage(batch, 0, batch.Cursor(), fmt.Sprintf("cross-%d", i), false, nil, []SyncTransaction{syncFact("october", date, 5000)})
		result := f.commit(batch, "READY")
		if result.DataRevision <= previousRevision {
			t.Fatal("cross-boundary correction did not invalidate data")
		}
		previousRevision = result.DataRevision
		if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_sources WHERE id=$1 AND discrepancy='cross_boundary_change'`, october) != 1 {
			t.Fatal("date correction did not flag possible gap/duplicate")
		}
	}
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_plan_sources p JOIN app.banking_source_revisions r ON r.source_id=p.source_id AND r.revision=p.source_revision WHERE p.source_id=$1 AND r.bank_date='2026-10-02'`, october) != 1 {
		t.Fatal("cross-boundary update rewrote captured fact")
	}
	recovery := rf.preview(uuid.Nil, "", "RESTORE_PREDECESSOR")
	if recovery.DiscrepancyCount < 4 || recovery.Prior.PendingCount != 0 {
		t.Fatal("discrepancy notices/retired pending semantics lost")
	}
	// Annotation edits invalidate recovery; fresh recovery preserves latest notes.
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,activity,note,reviewed) VALUES($1,$2,2,1,'purchase','new retained note',true)`, june, f.owner)
	if r := f.service.ConfirmReplacement(f.actor(f.owner), ReplacementConfirmation{AttemptID: uuid.New(), Request: recovery.Request, Expected: recovery.Revisions}); r.Code != "CONFLICT" {
		t.Fatal("recovery ignored annotation revision", r.Code)
	}
	rf.confirm(rf.preview(uuid.Nil, "", "RESTORE_PREDECESSOR"))
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND note='new retained note'`, june) != 1 || queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_source_revisions WHERE source_id=$1 AND processing_state='pending'`, oldPendingID) != 1 {
		t.Fatal("recovery lost history or edits")
	}
	// Explicit deletion through the replacement Item erases the logical account
	// across both Items while its predecessor Item's unrelated savings survives.
	requireCode(t, f.service.DeleteHistory(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: f.connection, ExpectedGeneration: 1}), "READY")
	var purge database.BankingWork
	if err := f.admin.QueryRow(context.Background(), `UPDATE app.banking_work SET state='running',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes' WHERE connection_id=$1 AND kind='purge' RETURNING id,connection_id,generation,lease_token`, f.connection).Scan(&purge.ID, &purge.ConnectionID, &purge.Generation, &purge.Token); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 30; i++ {
		n, err := db.PurgeBankingBatch(context.Background(), purge)
		if err != nil || n < 0 {
			t.Fatal(n, err)
		}
		if n == 0 {
			break
		}
		if i == 29 {
			t.Fatal("purge did not converge")
		}
	}
	for _, table := range []string{"sync_batches", "sources", "source_revisions", "annotations", "plans", "archives"} {
		if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_`+table+` WHERE owner_id=$1`, f.owner) != 0 {
			t.Fatal("private import payload survived purge", table)
		}
	}
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_sync_removals WHERE binding_id=$1`, replacement) != 0 || queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_source_identities WHERE binding_id=$1`, replacement) != 0 {
		t.Fatal("identity/removal payload survived deletion")
	}
	if result, err := CommitSyncBatch(context.Background(), db, f.work, staleBatch); err != nil || result.Code != "DENIED" {
		t.Fatal("old batch resurrected erased data", result.Code, err)
	}
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_bindings b JOIN app.banking_accounts a ON a.id=b.account_id WHERE b.connection_id=$1 AND b.provider_account_id='savings' AND a.selected`, rf.oldConnection) != 1 {
		t.Fatal("replacement deletion harmed sibling account")
	}
}

func TestSyncBatchRawWrapperRejectsInvalidFactsAtomically(t *testing.T) {
	f := newSyncFixture(t)
	for _, invalid := range []string{"fractional", "overflow", "currency", "date", "sibling", "missing", "continuation"} {
		t.Run(invalid, func(t *testing.T) {
			batch := f.begin()
			next, _ := NewSyncCursor(batch.binding, "complete")
			raw, err := encodeSyncPage(batch, batch.Cursor(), SyncPage{Binding: batch.binding, NextCursor: next, Added: []SyncTransaction{syncFact("valid-before-invalid", "2026-10-01", 100), syncFact("invalid", "2026-10-02", 200)}})
			if err != nil {
				t.Fatal(err)
			}
			var payload map[string]any
			if err = json.Unmarshal(raw, &payload); err != nil {
				t.Fatal(err)
			}
			fact := payload["changes"].([]any)[1].(map[string]any)
			switch invalid {
			case "fractional":
				fact["amount_minor"] = "1.25"
			case "overflow":
				fact["amount_minor"] = "9223372036854775808"
			case "currency":
				fact["currency"] = "EUR"
			case "date":
				fact["date"] = "2026-02-30"
			case "sibling":
				fact["account_id"] = "sibling"
			case "missing":
				delete(fact, "amount_minor")
			case "continuation":
				payload["from_cursor"] = "untrusted"
			}
			raw, err = json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			if code, err := f.worker.StageBankingSync(context.Background(), f.work, batch.id, 0, raw); err != nil || code != "INVALID_BATCH" {
				t.Fatal(code, err)
			}
			f.commit(batch, "CONFLICT")
			f.assertStream("", 0)
		})
	}
}
