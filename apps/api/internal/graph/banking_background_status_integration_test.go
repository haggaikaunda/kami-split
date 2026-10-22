//go:build integration

package graph_test

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/banking"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
)

func TestBankingHTTPBackgroundReconciliationPreservesUsableStatus(t *testing.T) {
	f := newBankingHTTPFixture(t)
	h := f.handler(true)
	token := f.token(f.owner)
	attempt := uuid.New()
	f.operation(h, bankingHTTPStart(attempt, "DIFFERENT"), token, "startBankingEnrollment", true)
	connection := f.operation(h, bankingHTTPFinish(attempt, "selected-checking"), token, "finishBankingEnrollment", false)["connectionId"].(string)
	t.Cleanup(func() {
		f.exec(`INSERT INTO app.banking_account_barriers(account_id,owner_id,connection_id,generation) SELECT account_id,owner_id,connection_id,1 FROM app.banking_bindings WHERE owner_id=$1 ON CONFLICT DO NOTHING`, f.owner)
		f.exec(`DELETE FROM app.banking_sync_batches WHERE owner_id=$1`, f.owner)
		f.exec(`UPDATE app.banking_sources SET revision=NULL WHERE owner_id=$1`, f.owner)
		f.exec(`DELETE FROM app.banking_source_revisions WHERE owner_id=$1`, f.owner)
		f.exec(`DELETE FROM app.banking_sources WHERE owner_id=$1`, f.owner)
	})
	db, err := database.OpenWorker(context.Background(), database.Config{URL: os.Getenv("TEST_WORKER_DATABASE_URL"), MaxConns: 2, Timeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	protector, _ := banking.NewProtector("http", map[string][]byte{"http": makeStatusKey()})
	provider := &statusSyncProvider{}
	provider.sync = func(b banking.SyncBinding, cursor banking.SyncCursor) (banking.SyncPage, error) {
		if cursor.Opaque() != "" {
			t.Fatal("initial stream checkpoint")
		}
		next, e := banking.NewSyncCursor(b, "initial-status")
		phase := "HISTORICAL_UPDATE_COMPLETE"
		return banking.SyncPage{Binding: b, NextCursor: next, Added: []banking.SyncTransaction{{TransactionID: "retained", AccountID: b.AccountID, Date: "2026-10-01", AmountMinor: 29, Currency: "USD"}}, UpdateStatus: &phase}, e
	}
	worker, err := banking.NewWorker(db, protector, provider)
	if err != nil {
		t.Fatal(err)
	}
	runStatusImport(t, worker, provider, 1)
	committed, initial := readBankingImport(t, f, h, connection, token)
	requireStatusFields(t, initial, map[string]any{"operation": "COMMITTED", "importState": "USABLE", "usable": true, "freshness": "OBSERVED", "coverage": "UNKNOWN", "coverageAfter": nil, "coverageThrough": nil, "providerSuccessAt": nil, "historicalUpdate": "COMPLETE"})
	if initial["lastLocalCommit"] == nil {
		t.Fatal("initial commit timestamp missing")
	}
	var operation string
	if err := f.admin.QueryRow(context.Background(), `SELECT id::text FROM app.banking_work WHERE connection_id=$1 AND kind='initial_sync'`, connection).Scan(&operation); err != nil {
		t.Fatal(err)
	}
	preparations, exchanges := f.provider.counts()
	unchanged := map[string]any{}
	for _, key := range []string{"importState", "usable", "lastLocalCommit", "importRevision", "dataRevision", "requestedAfter", "requestedThrough", "coverage", "coverageAfter", "coverageThrough", "providerSuccessAt", "providerFailedAt", "historicalUpdate"} {
		unchanged[key] = initial[key]
	}
	// Advance only this owned fixture's daily deadline. The production restricted
	// reconciliation wrapper must rearm its existing operation, not a new import.
	f.exec(`UPDATE app.banking_work SET due_at=clock_timestamp()-interval '1 day' WHERE id=$1`, operation)
	if err := db.ReconcileBanking(context.Background()); err != nil {
		t.Fatal(err)
	}
	queuedConnection, queued := readBankingImport(t, f, h, connection, token)
	requireStatusFields(t, queued, unchanged)
	requireStatusFields(t, queued, map[string]any{"operation": "QUEUED", "recovery": "WAIT", "attempts": float64(0)})
	if queued["retryAt"] == nil || queuedConnection["snapshotRevision"] == committed["snapshotRevision"] {
		t.Fatal("daily demand did not update operation snapshot")
	}
	provider.sync = func(_ banking.SyncBinding, cursor banking.SyncCursor) (banking.SyncPage, error) {
		if cursor.Opaque() != "initial-status" {
			t.Fatal("recurring request lost committed account cursor")
		}
		_, running := readBankingImport(t, f, h, connection, token)
		requireStatusFields(t, running, unchanged)
		requireStatusFields(t, running, map[string]any{"operation": "RUNNING", "recovery": "WAIT", "attempts": float64(1), "retryAt": nil})
		return banking.SyncPage{}, &banking.SyncError{Kind: banking.SyncRateLimited, RetryAfter: 3 * time.Minute}
	}
	runStatusImport(t, worker, provider, 2)
	retryConnection, retrying := readBankingImport(t, f, h, connection, token)
	requireStatusFields(t, retrying, unchanged)
	requireStatusFields(t, retrying, map[string]any{"operation": "RETRY_WAIT", "recovery": "RETRY_SCHEDULED", "attempts": float64(1)})
	due, err := time.Parse(time.RFC3339Nano, retrying["retryAt"].(string))
	if err != nil || time.Until(due) < 175*time.Second || retryConnection["snapshotRevision"] == queuedConnection["snapshotRevision"] {
		t.Fatal("retry due/snapshot was not exposed truthfully")
	}
	for _, actor := range []struct{ token, code string }{{f.token(f.other), "NOT_FOUND"}, {f.token(f.disabled), "FORBIDDEN"}} {
		denied := f.operation(h, fmt.Sprintf(`query{bankingConnection(connectionId:%q)%s}`, connection, bankingImportSelection), actor.token, "bankingConnection", false)
		if denied["code"] != actor.code || denied["connection"] != nil {
			t.Fatal("recurring status escaped enabled owner")
		}
	}
	if f.post(h, fmt.Sprintf(`query{bankingConnection(connectionId:%q)%s}`, connection, bankingImportSelection), "", false)["errors"] == nil {
		t.Fatal("anonymous recurring status accepted")
	}
	_, again := readBankingImport(t, f, h, connection, token)
	if !reflect.DeepEqual(again, retrying) || provider.calls != 2 {
		t.Fatal("status polling mutated retry state or performed provider work")
	}
	// Simulate arrival of the saved retry deadline in both durable/transport clocks.
	f.exec(`UPDATE app.banking_work SET due_at=clock_timestamp()-interval '1 second' WHERE id=$1`, operation)
	f.exec(`SELECT pgmq.set_vt('banking_lifecycle',message_id,0) FROM app.banking_work WHERE id=$1`, operation)
	provider.sync = func(b banking.SyncBinding, cursor banking.SyncCursor) (banking.SyncPage, error) {
		if cursor.Opaque() != "initial-status" {
			t.Fatal("retry changed committed cursor")
		}
		next, e := banking.NewSyncCursor(b, "incremental-status")
		return banking.SyncPage{Binding: b, NextCursor: next, Modified: []banking.SyncTransaction{{TransactionID: "retained", AccountID: b.AccountID, Date: "2026-10-01", AmountMinor: 39, Currency: "USD"}}}, e
	}
	runStatusImport(t, worker, provider, 3)
	updated, complete := readBankingImport(t, f, h, connection, token)
	requireStatusFields(t, complete, map[string]any{"operation": "COMMITTED", "importState": "USABLE", "usable": true, "freshness": "OBSERVED", "coverage": "UNKNOWN", "coverageAfter": nil, "coverageThrough": nil, "providerSuccessAt": nil, "historicalUpdate": "COMPLETE", "retryAt": nil, "attempts": float64(2), "requestedAfter": initial["requestedAfter"], "requestedThrough": initial["requestedThrough"]})
	if complete["importRevision"] == initial["importRevision"] || complete["dataRevision"] == initial["dataRevision"] || complete["reportingRevision"] == initial["reportingRevision"] || complete["lastLocalCommit"] == initial["lastLocalCommit"] || updated["snapshotRevision"] == retryConnection["snapshotRevision"] {
		t.Fatal("atomic incremental facts did not invalidate status")
	}
	var valid int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_work w JOIN app.banking_bindings b ON b.id=w.binding_id WHERE w.id=$1 AND w.state='complete' AND w.requested_version=w.completed_version AND b.sync_cursor='incremental-status' AND (SELECT count(*) FROM app.banking_sources s JOIN app.banking_source_revisions r ON r.source_id=s.id AND r.revision=s.revision WHERE s.binding_id=b.id AND r.amount_minor=39)=1`, operation).Scan(&valid); err != nil || valid != 1 {
		t.Fatal("recurring status differs from accepted persisted operation/source")
	}
	if p, e := f.provider.counts(); p != preparations || e != exchanges || provider.calls != 3 {
		t.Fatal("status read performed provider work")
	}
	stop := f.operation(h, fmt.Sprintf(`mutation{disconnectBanking(input:{attemptId:%q,connectionId:%q,expectedGeneration:"1"}){code}}`, uuid.NewString(), connection), token, "disconnectBanking", false)
	if stop["code"] != "READY" {
		t.Fatal("disconnect")
	}
	stopped, retained := readBankingImport(t, f, h, connection, token)
	requireStatusFields(t, retained, map[string]any{"operation": "STOPPED", "usable": true, "freshness": "STALE", "coverage": "KNOWN_GAP", "collection": "DISCONNECTED", "lastLocalCommit": complete["lastLocalCommit"]})
	deleted := f.operation(h, fmt.Sprintf(`mutation{deleteBankingHistory(input:{attemptId:%q,connectionId:%q,expectedGeneration:%q}){code}}`, uuid.NewString(), connection, stopped["generation"]), token, "deleteBankingHistory", false)
	if deleted["code"] != "READY" {
		t.Fatal("delete")
	}
	result := f.operation(h, fmt.Sprintf(`query{bankingConnection(connectionId:%q)%s}`, connection, bankingImportSelection), token, "bankingConnection", false)
	if result["code"] != "READY" || len(result["connection"].(map[string]any)["accounts"].([]any)) != 0 {
		t.Fatal("deleted recurring scope retained status")
	}
}
