//go:build integration

package graph_test

import (
	"encoding/base64"
	"fmt"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

func TestBankingHTTPStatusIndependentReferenceIsolation(t *testing.T) {
	f := newBankingHTTPFixture(t)
	h := f.handler(true)
	token := f.token(f.owner)
	attempt := uuid.New()
	f.operation(h, bankingHTTPStart(attempt, "DIFFERENT"), token, "startBankingEnrollment", true)
	connection := f.operation(h, bankingHTTPFinish(attempt, "selected-checking"), token, "finishBankingEnrollment", false)["connectionId"].(string)
	c, _ := readBankingImport(t, f, h, connection, token)
	account := c["accounts"].([]any)[0].(map[string]any)
	preparations, exchanges := f.provider.counts()
	for _, tc := range []struct{ name, id, token, code string }{
		{"logical account is not a connection", account["id"].(string), token, "NOT_FOUND"},
		{"binding is not a connection", account["streamId"].(string), token, "NOT_FOUND"},
		{"malformed connection", "not-an-id", token, "INVALID_INPUT"},
		{"unprovisioned signed actor", connection, f.token(uuid.New()), "FORBIDDEN"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := f.operation(h, fmt.Sprintf(`query{bankingConnection(connectionId:%q)%s}`, tc.id, bankingImportSelection), tc.token, "bankingConnection", false)
			if got["code"] != tc.code || got["connection"] != nil {
				t.Fatal("invalid reference or actor exposed private status")
			}
		})
	}
	// Sibling aliases must each authorize their own reference; the known foreign
	// reference must be indistinguishable from a missing one, including children.
	query := fmt.Sprintf(`query{known:bankingConnection(connectionId:%q)%s missing:bankingConnection(connectionId:%q)%s}`, connection, bankingImportSelection, uuid.NewString(), bankingImportSelection)
	envelope := f.post(h, query, f.token(f.other), false)
	data := envelope["data"].(map[string]any)
	if envelope["errors"] != nil || !reflect.DeepEqual(data["known"], data["missing"]) {
		t.Fatal("aliased nested reads distinguished missing and denied references")
	}
	for _, id := range []string{connection, account["id"].(string), account["streamId"].(string)} {
		for _, encoded := range []string{"ks1:BankingAccount:" + id, base64.StdEncoding.EncodeToString([]byte("BankingAccount:" + id))} {
			for _, actor := range []string{token, f.token(f.other)} {
				got := f.post(h, fmt.Sprintf(`query{node(id:%q){__typename id}}`, encoded), actor, false)
				if got["errors"] == nil {
					t.Fatal("banking identity acquired an alternate Node path")
				}
				if result, ok := got["data"].(map[string]any); ok && result["node"] != nil {
					t.Fatal("Node error returned private data")
				}
			}
		}
	}
	if p, e := f.provider.counts(); p != preparations || e != exchanges {
		t.Fatal("status or denial performed provider I/O")
	}
}

func TestBankingHTTPStatusIndependentPersistedPrecedence(t *testing.T) {
	f := newBankingHTTPFixture(t)
	h := f.handler(true)
	token := f.token(f.owner)
	attempt := uuid.New()
	f.operation(h, bankingHTTPStart(attempt, "DIFFERENT"), token, "startBankingEnrollment", true)
	connection := f.operation(h, bankingHTTPFinish(attempt, "selected-checking"), token, "finishBankingEnrollment", false)["connectionId"].(string)
	c, original := readBankingImport(t, f, h, connection, token)
	stream := c["accounts"].([]any)[0].(map[string]any)["streamId"].(string)
	for _, tc := range []struct {
		name, binding, work string
		want                map[string]any
	}{
		{"initial phase is not complete coverage", `import_state='usable',provider_update_status='INITIAL_UPDATE_COMPLETE'`, `state='complete',attempts=1,import_code='LOCAL_BATCH_COMMITTED'`, map[string]any{"operation": "COMMITTED", "usable": true, "coverage": "UNKNOWN", "historicalUpdate": "INITIAL_AVAILABLE", "lastLocalCommit": nil}},
		{"live retry outranks prior failed usability", `import_state='failed'`, `state='pending',attempts=2,import_code='RETRYABLE'`, map[string]any{"operation": "RETRY_WAIT", "recovery": "RETRY_SCHEDULED", "usable": false, "attempts": float64(2)}},
		{"running outranks prior unavailable usability", `import_state='unavailable'`, `state='running',attempts=3,import_code='RUNNING'`, map[string]any{"operation": "RUNNING", "recovery": "WAIT", "usable": false, "retryAt": nil}},
		{"repair retains data and directs explicit reconnect", `import_state='usable'`, `state='needs_attention',attempts=4,import_code='REPAIR_REQUIRED'`, map[string]any{"operation": "NEEDS_ATTENTION", "recovery": "RECONNECT", "usable": true, "freshness": "STALE"}},
		{"failed completed work requests operator attention", `import_state='failed'`, `state='complete',attempts=4,import_code='INVALID_DATA'`, map[string]any{"operation": "NEEDS_ATTENTION", "recovery": "CONTACT_SUPPORT", "usable": false}},
		{"older provider failure does not override newer success", `import_state='usable',last_local_commit='2026-10-20T12:00:00Z',provider_success_at='2026-10-20T11:00:00Z',provider_failed_at='2026-10-19T11:00:00Z'`, `state='complete',attempts=1`, map[string]any{"freshness": "OBSERVED", "coverage": "UNKNOWN", "usable": true}},
		{"later provider failure marks retained history stale", `import_state='usable',last_local_commit='2026-10-20T12:00:00Z',provider_success_at='2026-10-19T11:00:00Z',provider_failed_at='2026-10-20T11:00:00Z'`, `state='complete',attempts=1`, map[string]any{"freshness": "STALE", "coverage": "UNKNOWN", "usable": true}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f.exec(`UPDATE app.banking_bindings SET import_state='unknown',provider_update_status=NULL,provider_historical_update_at=NULL,last_local_commit=NULL,provider_success_at=NULL,provider_failed_at=NULL WHERE id=$1`, stream)
			f.exec(`UPDATE app.banking_bindings SET `+tc.binding+` WHERE id=$1`, stream)
			f.exec(`UPDATE app.banking_work SET `+tc.work+` WHERE binding_id=$1 AND kind='initial_sync'`, stream)
			_, got := readBankingImport(t, f, h, connection, token)
			requireStatusFields(t, got, tc.want)
			requireStatusFields(t, got, map[string]any{"requestedAfter": original["requestedAfter"], "requestedThrough": original["requestedThrough"], "coverageAfter": nil, "coverageThrough": nil})
		})
	}
	// A new stream generation cannot advertise old executable work. Its original
	// requested window remains provenance rather than moving with the new fence.
	f.exec(`UPDATE app.banking_bindings SET generation=generation+1 WHERE id=$1`, stream)
	_, fenced := readBankingImport(t, f, h, connection, token)
	requireStatusFields(t, fenced, map[string]any{"operation": "COMMITTED", "attempts": nil, "retryAt": nil, "requestedAfter": original["requestedAfter"], "requestedThrough": original["requestedThrough"]})
	if fenced["bindingGeneration"] == original["bindingGeneration"] {
		t.Fatal("stream generation did not invalidate status")
	}
}
