//go:build integration

package banking

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/jackc/pgx/v5"
)

type fakeLifecycleProvider struct {
	mu    sync.Mutex
	calls int
	fail  bool
	block chan struct{}
	item  string
}

func (p *fakeLifecycleProvider) Remove(ctx context.Context, _ string, c Credential) (RemovalResult, error) {
	p.mu.Lock()
	p.calls++
	failed := p.fail
	p.mu.Unlock()
	if len(c.Bytes()) == 0 {
		return RemovalResult{}, errors.New("missing synthetic token")
	}
	if p.block != nil {
		select {
		case <-ctx.Done():
			return RemovalResult{}, ctx.Err()
		case <-p.block:
		}
	}
	if failed {
		return RemovalResult{RetryAfter: 2 * time.Minute}, &RemovalError{Uncertain: true, Retryable: true}
	}
	return RemovalResult{Confirmed: true}, nil
}
func (p *fakeLifecycleProvider) Observe(context.Context, string, Credential) (Observation, error) {
	return Observation{ItemID: p.item, Healthy: true}, nil
}
func workerFixture(t *testing.T) (*fixture, *database.WorkerDB, *fakeLifecycleProvider, *Worker) {
	t.Helper()
	f := newFixture(t)
	// Tests in this package are sequential. Isolate transport state in the unique
	// disposable database; prior financial/private fixtures remain intact.
	f.exec(`DELETE FROM app.banking_work`)
	f.exec(`SELECT pgmq.purge_queue('banking_lifecycle')`)
	db, err := database.OpenWorker(context.Background(), database.Config{URL: os.Getenv("TEST_WORKER_DATABASE_URL"), MaxConns: 5, Timeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	provider := &fakeLifecycleProvider{}
	worker, err := NewWorker(db, f.service.protector, provider)
	if err != nil {
		t.Fatal(err)
	}
	return f, db, provider, worker
}
func queryInt(t *testing.T, f *fixture, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := f.admin.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
func releaseDue(t *testing.T, f *fixture, id uuid.UUID) {
	t.Helper()
	f.exec(`UPDATE app.banking_work SET due_at=clock_timestamp(),lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`, id)
	f.exec(`SELECT pgmq.set_vt('banking_lifecycle',message_id,0) FROM app.banking_work WHERE id=$1`, id)
}
func requireWork(t *testing.T, db *database.WorkerDB) database.BankingWork {
	t.Helper()
	w, err := db.ClaimBankingWork(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return w
}
func TestDurableQueueRollbackRestartLeasesAndResume(t *testing.T) {
	f, db, provider, worker := workerFixture(t)
	ctx := context.Background()
	connection := f.connection(f.owner, "durable-worker")
	// Intent and queue acceptance roll back together, including pgmq.send.
	tx, err := database.IntegrationPool(f.db).Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `SELECT set_config('app.verified_sub',$1,true)`, f.owner.String()); err != nil {
		t.Fatal(err)
	}
	var code string
	if err = tx.QueryRow(ctx, `SELECT app.banking_fence($1,1,false)`, connection).Scan(&code); err != nil || code != "READY" {
		t.Fatal(err, code)
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE connection_id=$1`, connection) != 0 || queryInt(t, f, `SELECT count(*) FROM pgmq.q_banking_lifecycle`) != 0 {
		t.Fatal("rollback orphan work")
	}
	requireCode(t, f.service.Stop(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}), "READY")
	job := requireWork(t, db)
	if job.Attempts != 1 || job.Kind != "teardown" {
		t.Fatal("wrong durable claim")
	}
	// A competing worker cannot claim while the message is invisible.
	if _, err = db.ClaimBankingWork(ctx); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatal("duplicate claim", err)
	}
	if ok, err := db.RenewBankingWork(ctx, job); err != nil || !ok {
		t.Fatal("lease renewal", err)
	}
	// Simulate crash/restart by expiring persisted time, with a fresh DB handle.
	releaseDue(t, f, job.ID)
	restartedDB, err := database.OpenWorker(ctx, database.Config{URL: os.Getenv("TEST_WORKER_DATABASE_URL"), MaxConns: 2, Timeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer restartedDB.Close()
	replacement := requireWork(t, restartedDB)
	if replacement.ID != job.ID || replacement.Token == job.Token || replacement.Attempts != 2 {
		t.Fatal("restart lost intent or lease token")
	}
	if ok, err := db.FinishBankingWork(ctx, job, true, 60); err != nil || ok {
		t.Fatal("stale lease committed", err)
	}
	// Exhaust attempts without waiting on wall time; transport and durable times
	// are both advanced, preserving the actual claim/finish persistence protocol.
	if ok, err := db.FinishBankingWork(ctx, replacement, false, 120); err != nil || !ok {
		t.Fatal(err)
	}
	for n := 3; n <= 10; n++ {
		releaseDue(t, f, job.ID)
		next := requireWork(t, db)
		if next.Attempts != n {
			t.Fatal("attempt count")
		}
		if ok, err := db.FinishBankingWork(ctx, next, false, 60); err != nil || !ok {
			t.Fatal(err)
		}
	}
	var state string
	if err = f.admin.QueryRow(ctx, `SELECT state FROM app.banking_work WHERE id=$1`, job.ID).Scan(&state); err != nil || state != "needs_attention" {
		t.Fatal("exhaustion lost", state, err)
	}
	// Runtime cannot reset its own attempt budget or acquire raw provider secrets.
	for _, sql := range []string{`SELECT app.banking_resume($1)`, `SELECT * FROM app.banking_credentials WHERE connection_id=$1`, `SELECT app.banking_create_connection($1,'sandbox','x','v','x'::bytea)`} {
		conn, err := pgx.Connect(ctx, os.Getenv("TEST_WORKER_DATABASE_URL"))
		if err != nil {
			t.Fatal(err)
		}
		_, err = conn.Exec(ctx, sql, job.ID)
		conn.Close(ctx)
		if err == nil {
			t.Fatal("worker privilege widened")
		}
	}
	var resumed bool
	if err = f.admin.QueryRow(ctx, `SELECT app.banking_resume($1)`, job.ID).Scan(&resumed); err != nil || !resumed {
		t.Fatal("operator resume", err)
	}
	restarted, _ := NewWorker(restartedDB, f.service.protector, provider)
	if worked, err := restarted.ProcessOne(ctx); err != nil || !worked {
		t.Fatal("actual resumed consumer", err)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='complete'`, job.ID) != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_credentials WHERE connection_id=$1`, connection) != 0 {
		t.Fatal("teardown not durable")
	}
	if worked, err := worker.ProcessOne(ctx); err != nil || worked {
		t.Fatal("redelivery duplicate effect", err)
	}
}
func TestPurgeAcrossBindingsIsBoundedHiddenAndPreservesSiblings(t *testing.T) {
	f, db, _, worker := workerFixture(t)
	ctx := f.actor(f.owner)
	old := f.connection(f.owner, "purge-old")
	newConnection := f.connection(f.owner, "purge-new")
	emptyPeer := f.connection(f.owner, "purge-empty-peer")
	other := f.connection(f.other, "purge-other")
	account, binding := f.binding(f.owner, old, "logical")
	siblingAccount, sibling := f.binding(f.owner, newConnection, "sibling")
	_, otherBinding := f.binding(f.other, other, "other")
	replacement := uuid.New()
	f.exec(`INSERT INTO app.banking_bindings(id,owner_id,connection_id,account_id,provider_account_id) VALUES($1,$2,$3,$4,'replacement')`, replacement, f.owner, newConnection, account)
	f.exec(`INSERT INTO app.banking_bindings(id,owner_id,connection_id,account_id,provider_account_id) VALUES($1,$2,$3,$4,'old-empty')`, uuid.New(), f.owner, emptyPeer, account)
	first := f.service.RecordSource(ctx, sourceInput(binding))
	requireCode(t, first, "READY")
	repl := f.service.RecordSource(ctx, sourceInput(replacement))
	requireCode(t, repl, "READY")
	surviving := f.service.RecordSource(ctx, sourceInput(sibling))
	requireCode(t, surviving, "READY")
	otherSource := f.service.RecordSource(f.actor(f.other), sourceInput(otherBinding))
	requireCode(t, otherSource, "READY")
	plan, archive := uuid.New(), uuid.New()
	f.exec(`INSERT INTO app.banking_plans(id,owner_id,account_id,revision) VALUES($1,$2,$3,1)`, plan, f.owner, account)
	f.exec(`INSERT INTO app.banking_plan_intervals(plan_id,owner_id,binding_id) VALUES($1,$2,$3)`, plan, f.owner, binding)
	f.exec(`INSERT INTO app.banking_archives(id,owner_id,plan_id,boundary_date) VALUES($1,$2,$3,'2026-01-01')`, archive, f.owner, plan)
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,note) VALUES($1,$2,1,1,'private note to purge')`, first.ID, f.owner)
	f.exec(`INSERT INTO app.banking_captures(archive_id,owner_id,source_id,source_revision,annotation_revision) VALUES($1,$2,$3,1,1)`, archive, f.owner, first.ID)
	f.exec(`INSERT INTO app.banking_plan_sources(plan_id,owner_id,source_id,source_revision) VALUES($1,$2,$3,1)`, plan, f.owner, first.ID)
	// More than one batch of staged versions on the same source proves deletion
	// does not hide an unbounded cascade behind a source-count limit.
	f.exec(`INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,amount_minor,currency,bank_date,processing_state,mapping_version,stage,batch_id) SELECT $1,$2,n,9000,'USD','2026-01-01','posted','fixture','staged',gen_random_uuid() FROM generate_series(2,260) n`, first.ID, f.owner)
	requireCode(t, f.service.DeleteHistory(ctx, FenceInput{AttemptID: uuid.New(), ConnectionID: old, ExpectedGeneration: 1}), "READY")
	for _, id := range []uuid.UUID{first.ID, repl.ID} {
		_, result := f.service.ReadSource(ctx, id)
		requireCode(t, result, "NOT_FOUND")
	}
	late := sourceInput(replacement)
	late.ExpectedRevision = 1
	requireCode(t, f.service.RecordSource(ctx, late), "CONFLICT")
	if err := f.db.WithIdentity(context.Background(), f.owner.String(), func(tx pgx.Tx) error {
		var count int
		if err := tx.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_archives WHERE id=$1`, archive).Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			t.Fatal("archive exposed after fence")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	job := requireWork(t, db)
	if job.Kind != "purge" {
		t.Fatal("expected first purge intent")
	}
	if ok, err := db.FinishBankingWork(context.Background(), job, true, 60); err != nil || ok {
		t.Fatal("unfinished purge claimed complete", err)
	}
	if n, err := db.PurgeBankingBatch(context.Background(), job); err != nil || n <= 0 || n > 1100 {
		t.Fatal("bounded batch", n, err)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_source_revisions WHERE source_id=$1`, first.ID) == 0 {
		t.Fatal("single batch deleted all staged versions")
	}
	// Losing the process after its local commit must retain progress, not restore
	// snapshots or let a stale lease finish the operation.
	releaseDue(t, f, job.ID)
	if worked, err := worker.ProcessOne(context.Background()); err != nil || !worked {
		t.Fatal("resumed purge", err)
	}
	for n := 0; n < 4; n++ {
		worked, err := worker.ProcessOne(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if !worked {
			break
		}
	}
	for _, table := range []string{"sources", "source_revisions", "annotations", "captures", "plan_sources"} {
		var count int
		sql := `SELECT count(*) FROM app.banking_` + table + ` WHERE `
		if table == "sources" {
			sql += `id=ANY($1)`
		} else {
			sql += `source_id=ANY($1)`
		}
		if err := f.admin.QueryRow(context.Background(), sql, []uuid.UUID{first.ID, repl.ID}).Scan(&count); err != nil || count != 0 {
			t.Fatal("remaining private data", table, count, err)
		}
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_accounts WHERE id=$1`, account) != 0 || queryInt(t, f, `SELECT count(*) FROM app.banking_plans WHERE account_id=$1`, account) != 0 {
		t.Fatal("account/plan payload retained")
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_deletion_barriers WHERE connection_id=$1 AND cleanup_state='complete'`, old) != 1 {
		t.Fatal("purge completion missing")
	}
	for _, id := range []uuid.UUID{surviving.ID} {
		_, result := f.service.ReadSource(ctx, id)
		requireCode(t, result, "READY")
	}
	_, result := f.service.ReadSource(f.actor(f.other), otherSource.ID)
	requireCode(t, result, "READY")
	if queryInt(t, f, `SELECT count(*) FROM app.banking_credentials WHERE connection_id=$1`, emptyPeer) != 0 || queryInt(t, f, `SELECT count(*) FROM app.banking_connections WHERE id=$1 AND state='stopped' AND provider_removed`, emptyPeer) != 1 {
		t.Fatal("unused historical Item orphaned")
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_accounts WHERE id=$1`, siblingAccount) != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_credentials WHERE connection_id=$1`, newConnection) != 1 {
		t.Fatal("sibling metadata/credential erased")
	}
}
func TestConsumerUncertainRemovalMissingCredentialAndDisabledOwner(t *testing.T) {
	f, db, provider, worker := workerFixture(t)
	ctx := context.Background()
	connection := f.connection(f.owner, "uncertain-worker")
	requireCode(t, f.service.Stop(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}), "READY")
	provider.fail = true
	if worked, err := worker.ProcessOne(ctx); err != nil || !worked {
		t.Fatal(err)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_credentials WHERE connection_id=$1`, connection) != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE connection_id=$1 AND state='pending' AND due_at>clock_timestamp()+interval '1 minute'`, connection) != 1 {
		t.Fatal("timeout claimed removal or lost provider backoff")
	}
	var id uuid.UUID
	if err := f.admin.QueryRow(ctx, `SELECT id FROM app.banking_work WHERE connection_id=$1`, connection).Scan(&id); err != nil {
		t.Fatal(err)
	}
	provider.fail = false
	releaseDue(t, f, id)
	f.exec(`UPDATE app.users SET enabled=false WHERE id=$1`, f.owner)
	if worked, err := worker.ProcessOne(ctx); err != nil || !worked {
		t.Fatal("disabled owner cleanup", err)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_credentials WHERE connection_id=$1`, connection) != 0 {
		t.Fatal("disabled owner credential retained after teardown")
	}
	// Credential absence is not confirmation unless a durable prior removal says so.
	missing := f.connection(f.other, "missing-token")
	f.exec(`DELETE FROM app.banking_credentials WHERE connection_id=$1`, missing)
	requireCode(t, f.service.Stop(f.actor(f.other), FenceInput{AttemptID: uuid.New(), ConnectionID: missing, ExpectedGeneration: 1}), "READY")
	if worked, err := worker.ProcessOne(ctx); err != nil || !worked {
		t.Fatal(err)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE connection_id=$1 AND state='needs_attention'`, missing) != 1 {
		t.Fatal("missing credential guessed success")
	}
	// Actual consumer shutdown during a provider call leaves durable leased intent.
	shutdown := f.connection(f.other, "shutdown")
	requireCode(t, f.service.Stop(f.actor(f.other), FenceInput{AttemptID: uuid.New(), ConnectionID: shutdown, ExpectedGeneration: 1}), "READY")
	provider.block = make(chan struct{})
	cancelCtx, cancel := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() { _, err := worker.ProcessOne(cancelCtx); done <- err }()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		statuses, err := db.BankingStatus(ctx)
		if err != nil {
			t.Fatal(err)
		}
		running := false
		for _, s := range statuses {
			running = running || s.State == "running"
		}
		if running {
			break
		}
		time.Sleep(time.Millisecond * 5)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("worker did not stop")
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE connection_id=$1 AND state='running'`, shutdown) != 1 {
		t.Fatal("shutdown lost leased intent")
	}
}
func TestVerifiedDurableReceiptsAndRealReconciliationAuthority(t *testing.T) {
	f, db, provider, worker := workerFixture(t)
	ctx := context.Background()
	connection := f.connection(f.owner, "webhook-reconcile")
	_, binding := f.binding(f.owner, connection, "selected")
	f.exec(`UPDATE app.banking_connections SET permission_state='granted' WHERE id=$1`, connection)
	f.exec(`UPDATE app.banking_accounts SET selected=true WHERE id IN(SELECT account_id FROM app.banking_bindings WHERE id=$1)`, binding)
	correlation := uuid.New()
	f.exec(`INSERT INTO app.banking_webhook_correlations VALUES($1,$2,1)`, correlation, connection)
	event := VerifiedWebhook{Environment: "sandbox", ItemID: "webhook-reconcile", WebhookType: "ITEM", WebhookCode: "ERROR", BodySHA256: sha256.Sum256([]byte("signed synthetic payload"))}
	for n := 0; n < 2; n++ {
		if err := f.service.AcceptWebhook(ctx, correlation, event); err != nil {
			t.Fatal(err)
		}
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_receipts WHERE correlation_id=$1`, correlation) != 1 {
		t.Fatal("duplicate receipt")
	}
	bad := event
	bad.ItemID = "unrelated"
	if !errors.Is(f.service.AcceptWebhook(ctx, correlation, bad), ErrWebhookMismatch) {
		t.Fatal("mismatched Item accepted")
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_receipts WHERE correlation_id=$1`, correlation) != 1 {
		t.Fatal("mismatch wrote")
	}
	provider.item = "webhook-reconcile"
	if err := db.ReconcileBanking(ctx); err != nil {
		t.Fatal(err)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_reconciliation WHERE binding_id=$1`, binding) != 0 {
		t.Fatal("scheduler claimed provider observation")
	}
	for n := 0; n < 100; n++ {
		worked, err := worker.ProcessOne(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if queryInt(t, f, `SELECT count(*) FROM app.banking_reconciliation WHERE binding_id=$1 AND state='healthy'`, binding) == 1 {
			break
		}
		if !worked {
			t.Fatal("target reconciliation was not consumed")
		}
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_reconciliation WHERE binding_id=$1 AND state='healthy'`, binding) != 1 {
		t.Fatal("verified observation not durable")
	}
	// Lost transport is rebuilt from durable intent. Reconciliation doesn't reset
	// failed attempts or turn stopped bindings back on.
	requireCode(t, f.service.Stop(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}), "READY")
	f.exec(`SELECT pgmq.purge_queue('banking_lifecycle')`)
	if err := db.ReconcileBanking(ctx); err != nil {
		t.Fatal(err)
	}
	if queryInt(t, f, `SELECT count(*) FROM pgmq.q_banking_lifecycle`) != 1 {
		t.Fatal("lost transport not repaired")
	}
	event.BodySHA256 = sha256.Sum256([]byte("late signed event"))
	if err := f.service.AcceptWebhook(ctx, correlation, event); err != nil {
		t.Fatal(err)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_receipts WHERE correlation_id=$1 AND state='terminal'`, correlation) != 1 {
		t.Fatal("terminal callback not fenced")
	}
	if worked, err := worker.ProcessOne(ctx); err != nil || !worked {
		t.Fatal(err)
	}
	if err := db.ReconcileBanking(ctx); err != nil {
		t.Fatal(err)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_connections WHERE id=$1 AND state='active'`, connection) != 0 {
		t.Fatal("reconciliation restarted stopped Item")
	}
	var queueText string
	if err := f.admin.QueryRow(ctx, `SELECT coalesce(string_agg(message::text,''),'') FROM pgmq.q_banking_lifecycle`).Scan(&queueText); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(queueText, "token") || strings.Contains(queueText, "amount") || strings.Contains(queueText, "webhook-reconcile") {
		t.Fatal("queue private payload")
	}
}

func TestLifecycleWorkerCrashHelper(t *testing.T) {
	if os.Getenv("KAMI_WORKER_CRASH_HELPER") != "1" {
		t.Skip("child process only")
	}
	db, err := database.OpenWorker(context.Background(), database.Config{URL: os.Getenv("TEST_WORKER_DATABASE_URL"), MaxConns: 2, Timeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	p, err := NewProtector("one", map[string][]byte{"one": bytes.Repeat([]byte{1}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	worker, _ := NewWorker(db, p, &fakeLifecycleProvider{block: make(chan struct{})})
	_, err = worker.ProcessOne(context.Background())
	if err != nil {
		t.Fatal(err)
	}
}
func TestRealProcessKillAndRestartKeepsCleanupIntent(t *testing.T) {
	f, _, _, worker := workerFixture(t)
	ctx := context.Background()
	connection := f.connection(f.owner, "process-crash")
	requireCode(t, f.service.Stop(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}), "READY")
	command := exec.Command(os.Args[0], "-test.run=^TestLifecycleWorkerCrashHelper$")
	command.Env = append(os.Environ(), "KAMI_WORKER_CRASH_HELPER=1")
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	killed := false
	defer func() {
		if !killed {
			command.Process.Kill()
			command.Wait()
		}
	}()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE connection_id=$1 AND state='running'`, connection) == 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE connection_id=$1 AND state='running'`, connection) != 1 {
		t.Fatal("child did not claim")
	}
	if err := command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = command.Wait()
	killed = true
	var id uuid.UUID
	if err := f.admin.QueryRow(ctx, `SELECT id FROM app.banking_work WHERE connection_id=$1`, connection).Scan(&id); err != nil {
		t.Fatal(err)
	}
	releaseDue(t, f, id)
	if worked, err := worker.ProcessOne(ctx); err != nil || !worked {
		t.Fatal("fresh process consumer recovery", err)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='complete' AND attempts=2`, id) != 1 {
		t.Fatal("crash/restart lost intent or attempt accounting")
	}
}
func TestSignedHTTPIngressAcknowledgesOnlyCommittedDatabaseReceipt(t *testing.T) {
	f, _, _, _ := workerFixture(t)
	connection := f.connection(f.owner, "http-item")
	correlation := uuid.New()
	f.exec(`INSERT INTO app.banking_webhook_correlations VALUES($1,$2,1)`, correlation, connection)
	signed := newWebhookFixture(t)
	handler, err := NewWebhookHandler(signed.verifier, f.service)
	if err != nil {
		t.Fatal(err)
	}
	var operations []string
	send := func(body []byte, signature string) int {
		operations = nil
		r := httptest.NewRequest(http.MethodPost, "/banking/webhooks/"+correlation.String(), bytes.NewReader(body))
		r.Header.Set("Plaid-Verification", signature)
		r = r.WithContext(diagnostic.WithReporter(r.Context(), func(operation string) {
			operations = append(operations, operation)
		}))
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w.Code
	}
	body := webhookBody("sandbox", "http-item")
	signature := signed.sign(t, body, signed.now, nil)
	// Verification fails before the real acceptor can write, and its transport
	// owns one static diagnostic. A later healthy lookup recovers normally.
	signed.status = http.StatusServiceUnavailable
	if code := send(body, signature); code != 503 || len(operations) != 1 || operations[0] != "banking.webhook_verify" {
		t.Fatal("verifier failure diagnostic ownership", code, operations)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_receipts WHERE correlation_id=$1`, correlation) != 0 {
		t.Fatal("verification outage persisted a receipt")
	}
	signed.status = http.StatusOK
	signed.now = signed.now.Add(time.Minute)
	signature = signed.sign(t, body, signed.now, nil)
	if code := send(append(append([]byte{}, body...), ' '), signature); code != 400 || len(operations) != 0 {
		t.Fatal("tampered body", code)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_receipts WHERE correlation_id=$1`, correlation) != 0 {
		t.Fatal("unverified write")
	}
	f.exec(`CREATE FUNCTION app.banking_receipt_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END $$`)
	f.exec(`CREATE TRIGGER banking_receipt_test_fail BEFORE INSERT ON app.banking_webhook_receipts FOR EACH ROW EXECUTE FUNCTION app.banking_receipt_test_fail()`)
	if code := send(body, signature); code != 503 || len(operations) != 1 || operations[0] != "banking.webhook_accept" {
		t.Fatal("storage failure acknowledged or diagnostic repeated", code, operations)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_receipts WHERE correlation_id=$1`, correlation) != 0 {
		t.Fatal("rollback receipt survived")
	}
	f.exec(`DROP TRIGGER banking_receipt_test_fail ON app.banking_webhook_receipts`)
	f.exec(`DROP FUNCTION app.banking_receipt_test_fail()`)
	for n := 0; n < 2; n++ {
		if code := send(body, signature); code != 204 || len(operations) != 0 {
			t.Fatal("durable delivery rejected", code)
		}
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_receipts WHERE correlation_id=$1 AND event_type='ITEM' AND event_code='USER_PERMISSION_REVOKED'`, correlation) != 1 {
		t.Fatal("receipt routing not durable/deduplicated")
	}
}

func TestReconciliationPreparesLegacyPendingDeletionBeforeExecution(t *testing.T) {
	f, db, _, worker := workerFixture(t)
	ctx := f.actor(f.owner)
	old := f.connection(f.owner, "legacy-delete")
	replacement := f.connection(f.owner, "legacy-replacement")
	account, _ := f.binding(f.owner, old, "legacy-account")
	_, sibling := f.binding(f.owner, replacement, "sibling")
	binding := uuid.New()
	f.exec(`INSERT INTO app.banking_bindings(id,owner_id,connection_id,account_id,provider_account_id) VALUES($1,$2,$3,$4,'legacy-replacement')`, binding, f.owner, replacement, account)
	source := f.service.RecordSource(ctx, sourceInput(binding))
	requireCode(t, source, "READY")
	siblingSource := f.service.RecordSource(ctx, sourceInput(sibling))
	requireCode(t, siblingSource, "READY")
	// This is the exact pre-worker storage shape, with no worker/account mapping.
	f.exec(`UPDATE app.banking_connections SET state='deleted',generation=2,deletion_generation=1 WHERE id=$1`, old)
	f.exec(`INSERT INTO app.banking_deletion_barriers(connection_id,owner_id,generation) VALUES($1,$2,1)`, old, f.owner)
	if err := db.ReconcileBanking(context.Background()); err != nil {
		t.Fatal(err)
	}
	_, result := f.service.ReadSource(ctx, source.ID)
	requireCode(t, result, "NOT_FOUND")
	for n := 0; n < 100; n++ {
		worked, err := worker.ProcessOne(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE connection_id=$1 AND kind='purge' AND state='complete'`, old) == 1 {
			break
		}
		if !worked {
			t.Fatal("legacy purge was not consumed")
		}
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_sources WHERE id=$1`, source.ID) != 0 {
		t.Fatal("legacy purge falsely completed with an empty scope")
	}
	_, result = f.service.ReadSource(ctx, siblingSource.ID)
	requireCode(t, result, "READY")
}
