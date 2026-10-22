//go:build integration

package graph_test

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/banking"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/jackc/pgx/v5"
)

const bankingImportSelection = `{code connection{id state generation deletionGeneration permission health snapshotRevision accounts{id streamId selected requestedHistoryDays importStatus{operation importState usable recovery collection reportingState freshness coverage historyAvailability requestedAfter requestedThrough coverageAfter coverageThrough historicalUpdate providerUpdateStatus historicalUpdateAt lastLocalCommit providerSuccessAt providerFailedAt retryAt attempts importRevision dataRevision bindingGeneration accountGeneration reportingRevision planRevision intervals{bindingId afterDate throughDate} discrepancyCount}}}}`

func readBankingImport(t *testing.T, f *bankingHTTPFixture, h http.Handler, connection, token string) (map[string]any, map[string]any) {
	t.Helper()
	result := f.operation(h, fmt.Sprintf(`query{bankingConnection(connectionId:%q)%s}`, connection, bankingImportSelection), token, "bankingConnection", false)
	if result["code"] != "READY" {
		t.Fatalf("status code: %v", result["code"])
	}
	c := result["connection"].(map[string]any)
	a := c["accounts"].([]any)
	if len(a) != 1 {
		t.Fatalf("wanted one retained stream, got %d", len(a))
	}
	return c, a[0].(map[string]any)["importStatus"].(map[string]any)
}

func requireStatusFields(t *testing.T, got map[string]any, want map[string]any) {
	t.Helper()
	for name, value := range want {
		if !reflect.DeepEqual(got[name], value) {
			t.Fatalf("status %s: got %v want %v", name, got[name], value)
		}
	}
}

type statusSyncProvider struct {
	sync  func(banking.SyncBinding, banking.SyncCursor) (banking.SyncPage, error)
	calls int
}

func (p *statusSyncProvider) Remove(context.Context, string, banking.Credential) (banking.RemovalResult, error) {
	return banking.RemovalResult{}, fmt.Errorf("unexpected removal")
}
func (p *statusSyncProvider) SyncTransactions(_ context.Context, b banking.SyncBinding, _ banking.Credential, c banking.SyncCursor) (banking.SyncPage, error) {
	p.calls++
	return p.sync(b, c)
}

func TestBankingHTTPImportProgressFailureCommitAndPrivacy(t *testing.T) {
	f := newBankingHTTPFixture(t)
	h := f.handler(true)
	token := f.token(f.owner)
	attempt := uuid.New()
	if got := f.operation(h, bankingHTTPStart(attempt, "DIFFERENT"), token, "startBankingEnrollment", true); got["code"] != "PREPARED" {
		t.Fatal("enrollment preparation")
	}
	enrolled := f.operation(h, bankingHTTPFinish(attempt, "selected-checking"), token, "finishBankingEnrollment", false)
	connection := enrolled["connectionId"].(string)
	// Source facts produced by this test are cleaned before the shared fixture's
	// dependency-ordered binding cleanup. Only this synthetic owner is affected.
	t.Cleanup(func() {
		f.exec(`INSERT INTO app.banking_account_barriers(account_id,owner_id,connection_id,generation) SELECT account_id,owner_id,connection_id,1 FROM app.banking_bindings WHERE owner_id=$1 ON CONFLICT DO NOTHING`, f.owner)
		f.exec(`DELETE FROM app.banking_sync_batches WHERE owner_id=$1`, f.owner)
		f.exec(`UPDATE app.banking_sources SET revision=NULL WHERE owner_id=$1`, f.owner)
		f.exec(`DELETE FROM app.banking_source_revisions WHERE owner_id=$1`, f.owner)
		f.exec(`DELETE FROM app.banking_sources WHERE owner_id=$1`, f.owner)
	})
	c, queued := readBankingImport(t, f, h, connection, token)
	requireStatusFields(t, queued, map[string]any{"operation": "QUEUED", "importState": "UNKNOWN", "usable": false, "recovery": "WAIT", "coverage": "UNKNOWN", "lastLocalCommit": nil, "providerSuccessAt": nil, "historicalUpdate": "UNKNOWN", "importRevision": "1", "dataRevision": "1"})
	if queued["requestedAfter"] == nil || queued["requestedThrough"] == nil {
		t.Fatal("requested history bounds missing")
	}
	after, _ := time.Parse("2006-01-02", queued["requestedAfter"].(string))
	through, _ := time.Parse("2006-01-02", queued["requestedThrough"].(string))
	if through.Sub(after) != 365*24*time.Hour {
		t.Fatal("requested window changed")
	}
	c2, _ := readBankingImport(t, f, h, connection, token)
	if c["snapshotRevision"] != c2["snapshotRevision"] {
		t.Fatal("idle snapshot revision is unstable")
	}
	for _, deniedActor := range []struct{ token, code string }{{f.token(f.other), "NOT_FOUND"}, {f.token(f.disabled), "FORBIDDEN"}} {
		owner := deniedActor.token
		got := f.operation(h, fmt.Sprintf(`query{bankingConnection(connectionId:%q)%s}`, connection, bankingImportSelection), owner, "bankingConnection", false)
		want := deniedActor.code
		if got["code"] != want || got["connection"] != nil {
			t.Fatal("private status escaped enabled owner")
		}
	}
	absent := f.operation(h, fmt.Sprintf(`query{bankingConnection(connectionId:%q)%s}`, uuid.NewString(), bankingImportSelection), f.token(f.other), "bankingConnection", false)
	denied := f.operation(h, fmt.Sprintf(`query{bankingConnection(connectionId:%q)%s}`, connection, bankingImportSelection), f.token(f.other), "bankingConnection", false)
	if !reflect.DeepEqual(absent, denied) {
		t.Fatal("missing and denied differ")
	}
	for _, id := range []string{connection, c["accounts"].([]any)[0].(map[string]any)["id"].(string), c["accounts"].([]any)[0].(map[string]any)["streamId"].(string)} {
		envelope := f.post(h, fmt.Sprintf(`query{node(id:%q){__typename}}`, id), f.token(f.other), false)
		if envelope["errors"] == nil {
			t.Fatal("private UUID became a Node lookup")
		}
	}
	if f.post(h, fmt.Sprintf(`query{bankingConnection(connectionId:%q)%s}`, connection, bankingImportSelection), "", false)["errors"] == nil {
		t.Fatal("unauthenticated status reached storage")
	}
	preparations, exchanges := f.provider.counts()
	workerDB, err := database.OpenWorker(context.Background(), database.Config{URL: os.Getenv("TEST_WORKER_DATABASE_URL"), MaxConns: 2, Timeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer workerDB.Close()
	// The same configured keyring is used by the authenticated storage and worker.
	protector, _ := banking.NewProtector("http", map[string][]byte{"http": makeStatusKey()})
	provider := &statusSyncProvider{}
	provider.sync = func(b banking.SyncBinding, cursor banking.SyncCursor) (banking.SyncPage, error) {
		_, running := readBankingImport(t, f, h, connection, token)
		requireStatusFields(t, running, map[string]any{"operation": "RUNNING", "usable": false, "lastLocalCommit": nil, "importRevision": "1", "dataRevision": "1"})
		return banking.SyncPage{}, &banking.SyncError{Kind: banking.SyncNotReady, RetryAfter: time.Minute}
	}
	worker, err := banking.NewWorker(workerDB, protector, provider)
	if err != nil {
		t.Fatal(err)
	}
	runStatusImport(t, worker, provider, 1)
	_, pending := readBankingImport(t, f, h, connection, token)
	requireStatusFields(t, pending, map[string]any{"operation": "HISTORY_PENDING", "recovery": "RETRY_SCHEDULED", "usable": false, "attempts": float64(1), "lastLocalCommit": nil, "coverage": "UNKNOWN"})
	if pending["retryAt"] == nil {
		t.Fatal("retry due time missing")
	}
	f.exec(`UPDATE app.banking_work SET due_at=clock_timestamp()-interval '1 second',message_id=(SELECT pgmq.send('banking_lifecycle',jsonb_build_object('operation_id',id,'generation',generation))) WHERE connection_id=$1 AND kind='initial_sync'`, connection)
	provider.sync = func(b banking.SyncBinding, cursor banking.SyncCursor) (banking.SyncPage, error) {
		_, running := readBankingImport(t, f, h, connection, token)
		requireStatusFields(t, running, map[string]any{"operation": "RUNNING", "usable": false, "importRevision": "1"})
		next, err := banking.NewSyncCursor(b, "complete-fixture")
		if err != nil {
			return banking.SyncPage{}, err
		}
		phase := "HISTORICAL_UPDATE_COMPLETE"
		// A valid empty local batch proves usability, never complete availability.
		return banking.SyncPage{Binding: b, NextCursor: next, Added: []banking.SyncTransaction{}, UpdateStatus: &phase}, nil
	}
	runStatusImport(t, worker, provider, 2)
	committed, s := readBankingImport(t, f, h, connection, token)
	requireStatusFields(t, s, map[string]any{"operation": "COMMITTED", "importState": "USABLE", "usable": true, "coverage": "UNKNOWN", "historyAvailability": "unknown", "coverageAfter": nil, "coverageThrough": nil, "historicalUpdate": "COMPLETE", "providerSuccessAt": nil, "providerFailedAt": nil, "retryAt": nil, "attempts": float64(2), "importRevision": "2", "dataRevision": "2"})
	if s["lastLocalCommit"] == nil || s["historicalUpdateAt"] == nil || committed["snapshotRevision"] == c["snapshotRevision"] {
		t.Fatal("atomic commit status/revision absent")
	}
	if p, e := f.provider.counts(); p != preparations || e != exchanges || provider.calls != 2 {
		t.Fatal("status poll performed provider I/O")
	}
	// Stop retains usable history and its source facts; deletion hides the scope.
	stop := f.operation(h, fmt.Sprintf(`mutation{disconnectBanking(input:{attemptId:%q,connectionId:%q,expectedGeneration:"1"}){code}}`, uuid.NewString(), connection), token, "disconnectBanking", false)
	if stop["code"] != "READY" {
		t.Fatal("disconnect")
	}
	stopped, retained := readBankingImport(t, f, h, connection, token)
	requireStatusFields(t, retained, map[string]any{"operation": "STOPPED", "usable": true, "freshness": "STALE", "coverage": "KNOWN_GAP", "collection": "DISCONNECTED"})
	if stopped["generation"] == committed["generation"] || stopped["snapshotRevision"] == committed["snapshotRevision"] {
		t.Fatal("stop did not invalidate status")
	}
	deleted := f.operation(h, fmt.Sprintf(`mutation{deleteBankingHistory(input:{attemptId:%q,connectionId:%q,expectedGeneration:%q}){code}}`, uuid.NewString(), connection, stopped["generation"]), token, "deleteBankingHistory", false)
	if deleted["code"] != "READY" {
		t.Fatal("delete")
	}
	result := f.operation(h, fmt.Sprintf(`query{bankingConnection(connectionId:%q)%s}`, connection, bankingImportSelection), token, "bankingConnection", false)
	deletedConnection := result["connection"].(map[string]any)
	if deletedConnection["state"] != "deleted" || len(deletedConnection["accounts"].([]any)) != 0 {
		t.Fatal("deleted scope retained import facts")
	}
}

func makeStatusKey() []byte {
	key := make([]byte, 32)
	for i := range key {
		key[i] = 87
	}
	return key
}

func TestBankingHTTPStatusSnapshotPerAccountAndDisable(t *testing.T) {
	f := newBankingHTTPFixture(t)
	h := f.handler(true)
	token := f.token(f.owner)
	attempt := uuid.New()
	f.operation(h, bankingHTTPStart(attempt, "DIFFERENT"), token, "startBankingEnrollment", true)
	finish := fmt.Sprintf(`mutation{finishBankingEnrollment(input:{attemptId:%q,publicToken:%q,accountIds:["selected-checking","unselected-savings"]})%s}`, attempt.String(), "public-private-"+attempt.String(), bankingHTTPSelection)
	connection := f.operation(h, finish, token, "finishBankingEnrollment", false)["connectionId"].(string)
	var checking, savings string
	if err := f.admin.QueryRow(context.Background(), `SELECT id::text FROM app.banking_bindings WHERE connection_id=$1 AND provider_account_id='selected-checking'`, connection).Scan(&checking); err != nil {
		t.Fatal(err)
	}
	if err := f.admin.QueryRow(context.Background(), `SELECT id::text FROM app.banking_bindings WHERE connection_id=$1 AND provider_account_id='unselected-savings'`, connection).Scan(&savings); err != nil {
		t.Fatal(err)
	}
	f.exec(`UPDATE app.banking_bindings SET import_state='usable',import_revision=4,data_revision=5,history_availability='provider_reported',coverage_after='2026-01-01',coverage_through='2026-09-30',provider_update_status='FUTURE_PHASE',provider_success_at='2026-10-20T12:00:00Z' WHERE id=$1`, checking)
	f.exec(`UPDATE app.banking_work SET state='complete',import_code='LOCAL_BATCH_COMMITTED' WHERE binding_id=$1`, checking)
	f.exec(`UPDATE app.banking_work SET state='needs_attention',attempts=10,import_code='INVALID_DATA' WHERE binding_id=$1`, savings)
	read := func() (map[string]any, map[string]map[string]any) {
		t.Helper()
		result := f.operation(h, fmt.Sprintf(`query{bankingConnection(connectionId:%q)%s}`, connection, bankingImportSelection), token, "bankingConnection", false)
		if result["code"] != "READY" {
			t.Fatal("snapshot read", result["code"])
		}
		c := result["connection"].(map[string]any)
		byStream := map[string]map[string]any{}
		for _, raw := range c["accounts"].([]any) {
			a := raw.(map[string]any)
			byStream[a["streamId"].(string)] = a["importStatus"].(map[string]any)
		}
		return c, byStream
	}
	before, streams := read()
	requireStatusFields(t, streams[checking], map[string]any{"usable": true, "operation": "COMMITTED", "coverage": "LIMITED", "historicalUpdate": "UNKNOWN", "providerUpdateStatus": "FUTURE_PHASE", "lastLocalCommit": nil, "providerSuccessAt": "2026-10-20T12:00:00Z", "importRevision": "4", "dataRevision": "5"})
	requireStatusFields(t, streams[savings], map[string]any{"usable": false, "operation": "NEEDS_ATTENTION", "recovery": "CONTACT_SUPPORT", "coverage": "UNKNOWN", "coverageAfter": nil, "coverageThrough": nil, "attempts": float64(10)})
	tx, err := f.admin.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), `UPDATE app.banking_bindings SET import_revision=import_revision+1,data_revision=data_revision+1,last_local_commit=clock_timestamp() WHERE id=$1`, checking); err != nil {
		t.Fatal(err)
	}
	during, streams := read()
	if during["snapshotRevision"] != before["snapshotRevision"] {
		t.Fatal("uncommitted sync leaked into read snapshot")
	}
	requireStatusFields(t, streams[checking], map[string]any{"importRevision": "4", "dataRevision": "5", "lastLocalCommit": nil})
	if err = tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	after, streams := read()
	requireStatusFields(t, streams[checking], map[string]any{"importRevision": "5", "dataRevision": "6", "freshness": "OBSERVED"})
	if after["snapshotRevision"] == before["snapshotRevision"] || streams[checking]["lastLocalCommit"] == nil {
		t.Fatal("committed revision did not publish coherently")
	}
	f.exec(`UPDATE app.banking_connections SET health='repair_required' WHERE id=$1`, connection)
	_, streams = read()
	requireStatusFields(t, streams[checking], map[string]any{"recovery": "RECONNECT", "freshness": "STALE", "usable": true})
	changed := f.operation(h, fmt.Sprintf(`mutation{changeBankingSelection(input:{attemptId:%q,connectionId:%q,expectedGeneration:"1",accountIds:[]}){code}}`, uuid.NewString(), connection), token, "changeBankingSelection", false)
	if changed["code"] != "READY" {
		t.Fatal("selection change", changed["code"])
	}
	_, streams = read()
	requireStatusFields(t, streams[checking], map[string]any{"collection": "DESELECTED", "operation": "STOPPED", "usable": true, "coverage": "KNOWN_GAP"})
	// A retained revoked fixture has usable data and a collection gap. It cannot be
	// confused with absent initial data or with an account deletion barrier.
	f.exec(`UPDATE app.banking_connections SET state='stopped',permission_state='revoked',generation=generation+1 WHERE id=$1`, connection)
	_, streams = read()
	requireStatusFields(t, streams[checking], map[string]any{"usable": true, "collection": "REVOKED", "operation": "STOPPED", "freshness": "STALE", "coverage": "KNOWN_GAP", "attempts": nil})
	f.exec(`INSERT INTO app.banking_account_barriers(account_id,owner_id,connection_id,generation) SELECT account_id,owner_id,connection_id,1 FROM app.banking_bindings WHERE id=$1`, checking)
	_, streams = read()
	if streams[checking] != nil || streams[savings] == nil {
		t.Fatal("logical deletion did not hide exactly the affected scope")
	}
	f.exec(`UPDATE app.users SET enabled=false WHERE id=$1`, f.owner)
	denied := f.operation(h, fmt.Sprintf(`query{bankingConnection(connectionId:%q)%s}`, connection, bankingImportSelection), token, "bankingConnection", false)
	if denied["code"] != "FORBIDDEN" || denied["connection"] != nil {
		t.Fatal("disabled owner retained cached authority")
	}
}

func TestBankingHTTPStatusReplacementRecoveryAndDiscrepancy(t *testing.T) {
	s := independentReplacementHTTP(t)
	f := s.f
	var oldConnection, newConnection string
	if err := f.admin.QueryRow(context.Background(), `SELECT connection_id::text FROM app.banking_bindings WHERE id=$1`, s.original).Scan(&oldConnection); err != nil {
		t.Fatal(err)
	}
	if err := f.admin.QueryRow(context.Background(), `SELECT connection_id::text FROM app.banking_bindings WHERE id=$1`, s.binding).Scan(&newConnection); err != nil {
		t.Fatal(err)
	}
	old, oldStatus := readBankingImport(t, f, s.handler, oldConnection, s.owner)
	stage, stageStatus := readBankingImport(t, f, s.handler, newConnection, s.owner)
	requireStatusFields(t, oldStatus, map[string]any{"reportingState": "CURRENT", "usable": true, "planRevision": nil})
	requireStatusFields(t, stageStatus, map[string]any{"reportingState": "STAGED", "usable": false, "planRevision": nil})
	if old["accounts"].([]any)[0].(map[string]any)["id"] != stage["accounts"].([]any)[0].(map[string]any)["id"] {
		t.Fatal("replacement lost logical identity")
	}
	if !reflect.DeepEqual(stageStatus["intervals"], oldStatus["intervals"]) || len(stageStatus["intervals"].([]any)) != 1 || stageStatus["intervals"].([]any)[0].(map[string]any)["bindingId"] != s.original.String() {
		t.Fatal("staged context did not preserve the shared implicit original reporting plan")
	}
	// Later producer fixtures establish usable staged-binding data; committed
	// source revisions are current while binding context controls contribution.
	// no transaction payload is returned by status or counted twice from archives.
	f.exec(`UPDATE app.banking_bindings SET import_state='usable',last_local_commit='2026-10-21T12:00:00Z',provider_success_at='2026-10-20T12:00:00Z',provider_failed_at='2026-10-21T11:00:00Z' WHERE id=$1`, s.binding)
	source := uuid.New()
	f.exec(`WITH saved AS (INSERT INTO app.banking_sources(id,owner_id,binding_id,provider_transaction_id,revision,discrepancy) VALUES($1,$2,$3,'status-discrepancy-fixture',1,'none') RETURNING id) INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,amount_minor,currency,bank_date,processing_state,mapping_version,stage) SELECT id,$2,1,125,'USD','2026-10-01','posted','controlled','current' FROM saved`, source, f.owner, s.binding)
	_, later := readBankingImport(t, f, s.handler, newConnection, s.owner)
	requireStatusFields(t, later, map[string]any{"usable": true, "freshness": "STALE", "discrepancyCount": "0", "reportingState": "STAGED"})
	p := f.operation(s.handler, s.preview, s.owner, "bankingReplacementPreview", false)
	confirm := fmt.Sprintf(`mutation{confirmBankingReplacement(input:{attemptId:%q,request:%s,expected:%s}){code}}`, uuid.NewString(), s.request, replacementHTTPExpected(t, p))
	if got := f.operation(s.handler, confirm, s.owner, "confirmBankingReplacement", false); got["code"] != "READY" {
		t.Fatal("replacement activation", got["code"])
	}
	retired, prior := readBankingImport(t, f, s.handler, oldConnection, s.owner)
	active, current := readBankingImport(t, f, s.handler, newConnection, s.owner)
	requireStatusFields(t, prior, map[string]any{"reportingState": "RETIRED", "collection": "RETIRED", "operation": "STOPPED", "usable": true, "freshness": "STALE"})
	requireStatusFields(t, current, map[string]any{"reportingState": "CURRENT", "usable": true, "discrepancyCount": "0"})
	if prior["planRevision"] == nil || prior["planRevision"] != current["planRevision"] || len(current["intervals"].([]any)) != 2 || !reflect.DeepEqual(prior["intervals"], current["intervals"]) {
		t.Fatal("reporting plan was not coherent across source contexts")
	}
	if retired["snapshotRevision"] == old["snapshotRevision"] || active["snapshotRevision"] == stage["snapshotRevision"] {
		t.Fatal("activation did not invalidate both status contexts")
	}
	// A later correction signal invalidates the same shared reporting view.
	f.exec(`UPDATE app.banking_sources SET discrepancy='cross_boundary_change' WHERE id=$1`, source)
	corrected, notice := readBankingImport(t, f, s.handler, newConnection, s.owner)
	requireStatusFields(t, notice, map[string]any{"discrepancyCount": "1", "reportingState": "CURRENT"})
	if corrected["snapshotRevision"] == active["snapshotRevision"] || notice["reportingRevision"] == current["reportingRevision"] {
		t.Fatal("late correction did not invalidate status/reporting together")
	}
	restoreRequest := fmt.Sprintf(`{accountId:%q,action:RESTORE_PREDECESSOR}`, s.account.String())
	preview := fmt.Sprintf(`query{bankingReplacementPreview(input:%s){code revisions{plan import data annotation lifecycle}}}`, restoreRequest)
	p = f.operation(s.handler, preview, s.owner, "bankingReplacementPreview", false)
	restore := fmt.Sprintf(`mutation{confirmBankingReplacement(input:{attemptId:%q,request:%s,expected:%s}){code}}`, uuid.NewString(), restoreRequest, replacementHTTPExpected(t, p))
	if got := f.operation(s.handler, restore, s.owner, "confirmBankingReplacement", false); got["code"] != "READY" {
		t.Fatal("predecessor recovery", got["code"])
	}
	_, recovered := readBankingImport(t, f, s.handler, oldConnection, s.owner)
	requireStatusFields(t, recovered, map[string]any{"reportingState": "RETIRED", "collection": "RETIRED", "operation": "STOPPED", "usable": true})
	if recovered["planRevision"] == prior["planRevision"] || len(recovered["intervals"].([]any)) != 1 {
		t.Fatal("recovery did not publish a distinct bounded plan")
	}
}

// Earlier package fixtures can leave queue deliveries whose durable work was
// deleted by their cleanup. A single claim removes one such delivery and reports
// no executable work; bounded polling reaches this fixture without purging others.
func runStatusImport(t *testing.T, worker *banking.Worker, provider *statusSyncProvider, calls int) {
	t.Helper()
	for attempt := 0; attempt < 1000 && provider.calls < calls; attempt++ {
		if _, err := worker.ProcessOne(context.Background()); err != nil {
			t.Fatal("initial consumer", err)
		}
	}
	if provider.calls != calls {
		t.Fatal("owned initial import was not observed within bounded queue polling")
	}
}

func TestBankingHTTPStatusStorageFailureAndRestrictedWrapper(t *testing.T) {
	f := newBankingHTTPFixture(t)
	h := f.handler(true)
	token := f.token(f.owner)
	attempt := uuid.New()
	f.operation(h, bankingHTTPStart(attempt, "DIFFERENT"), token, "startBankingEnrollment", true)
	connection := f.operation(h, bankingHTTPFinish(attempt, "selected-checking"), token, "finishBankingEnrollment", false)["connectionId"].(string)
	workerLogin, err := pgx.Connect(context.Background(), os.Getenv("TEST_WORKER_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer workerLogin.Close(context.Background())
	if _, err = workerLogin.Exec(context.Background(), `SELECT app.banking_connection_status($1)`, connection); err == nil {
		t.Fatal("worker could execute owner status wrapper")
	}
	if _, err = workerLogin.Exec(context.Background(), `SELECT * FROM app.banking_work`); err == nil {
		t.Fatal("worker could read private work directly")
	}
	f.exec(`REVOKE EXECUTE ON FUNCTION app.banking_connection_status(uuid) FROM kami_api`)
	defer f.exec(`GRANT EXECUTE ON FUNCTION app.banking_connection_status(uuid) TO kami_api`)
	result := f.operation(h, fmt.Sprintf(`query{bankingConnection(connectionId:%q)%s}`, connection, bankingImportSelection), token, "bankingConnection", false)
	if result["code"] != "UNAVAILABLE" || result["connection"] != nil {
		t.Fatal("storage failure returned partial status")
	}
	logs := f.logs.String()
	if strings.Count(logs, `"operation":"banking.storage"`) != 1 || strings.Contains(logs, "permission denied") || strings.Contains(logs, "banking_connection_status") {
		t.Fatal("storage failure diagnostic was duplicated or exposed private cause")
	}
}
