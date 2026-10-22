//go:build integration

package banking

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
)

// The production consumer and HTTP adapter use a real replacement's restricted
// exact-binding intent; only external provider pages are deterministic fixtures.
func replacementBackgroundConsumer(t *testing.T, f *replacementFixture, binding uuid.UUID) *initialConsumerFixture {
	t.Helper()
	db, err := database.OpenWorker(context.Background(), database.Config{URL: os.Getenv("TEST_WORKER_DATABASE_URL"), MaxConns: 3, Timeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	c := &initialConsumerFixture{fixture: f.fixture, enrollment: f.enrollment, db: db, binding: binding}
	if err := f.admin.QueryRow(context.Background(), `SELECT connection_id FROM app.banking_bindings WHERE id=$1`, binding).Scan(&c.connection); err != nil {
		t.Fatal(err)
	}
	if err := f.admin.QueryRow(context.Background(), `SELECT id FROM app.banking_work WHERE binding_id=$1 AND kind='initial_sync'`, binding).Scan(&c.operation); err != nil {
		t.Fatal(err)
	}
	// Other selected streams remain intact and are exercised separately; postpone
	// only this fixture's sibling transport to run its target deterministically.
	f.exec(`SELECT pgmq.set_vt('banking_lifecycle',w.message_id,600) FROM app.banking_work w JOIN app.banking_connections c ON c.id=w.connection_id WHERE c.owner_id=$1 AND w.id<>$2 AND w.message_id IS NOT NULL`, f.owner, c.operation)
	var expectedItem string
	if err := f.admin.QueryRow(context.Background(), `SELECT provider_item_id FROM app.banking_connections WHERE id=$1`, c.connection).Scan(&expectedItem); err != nil {
		t.Fatal(err)
	}
	provider := testPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/item/get" {
			body, _ := json.Marshal(map[string]any{"item": map[string]any{"item_id": expectedItem, "error": nil}})
			return plaidTestResponse(200, string(body)), nil
		}
		var request struct {
			Cursor  string `json:"cursor"`
			Options struct {
				Account string `json:"account_id"`
			} `json:"options"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if r.URL.Path != "/transactions/sync" || request.Options.Account != "checking" {
			t.Fatalf("replacement expected selected sync; path=%s selected_account=%t", r.URL.Path, request.Options.Account == "checking")
		}
		c.requests = append(c.requests, request.Cursor)
		return c.respond(request.Cursor)
	}))
	c.worker, err = NewWorker(db, f.service.protector, provider)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestBackgroundConsumerReplacementActivationRecoveryAndCorrections(t *testing.T) {
	f := newReplacementFixture(t)
	old := f.row(f.oldBinding, "2026-09-20", "2500", "posted", true)
	oldPending := f.row(f.oldBinding, "2026-09-30", "100", "pending", false)
	staged := f.stage()
	c := replacementBackgroundConsumer(t, f, staged)
	c.respond = func(string) (*http.Response, error) {
		return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"initial-overlap","account_id":"checking","amount":2.50,"iso_currency_code":"USD","date":"2026-09-30","pending":false},{"transaction_id":"active","account_id":"checking","amount":3.00,"iso_currency_code":"USD","date":"2026-10-01","pending":false},{"transaction_id":"active-pending","account_id":"checking","amount":1.00,"iso_currency_code":"USD","date":"2026-10-02","pending":true}],"modified":[],"removed":[],"has_more":false,"next_cursor":"replacement-initial"}`), nil
	}
	c.run(t)
	preview := f.preview(staged, "2026-09-30", "ACTIVATE")
	h := newBackgroundIngress(t, c)
	h.notify(t)
	c.respond = func(string) (*http.Response, error) {
		f.confirm(preview)
		return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"activation-race","account_id":"checking","amount":9.99,"iso_currency_code":"USD","date":"2026-10-03","pending":false}],"modified":[],"removed":[],"has_more":false,"next_cursor":"stale-activation"}`), nil
	}
	c.run(t)
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_sources WHERE binding_id=$1 AND provider_transaction_id='activation-race'`, staged) != 0 || queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_bindings WHERE id=$1 AND sync_cursor='replacement-initial'`, staged) != 1 {
		t.Fatal("activation raced past reporting fence")
	}
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND note='original private note' AND excluded`, old) != 1 || queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_sources WHERE id=$1`, oldPending) != 1 {
		t.Fatal("replacement erased original annotation/pending history")
	}
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_sources WHERE binding_id=$1 AND provider_transaction_id='initial-overlap' AND discrepancy='none'`, staged) != 1 {
		t.Fatal("initial overlap mislabeled correction")
	}
	var resumed bool
	if err := f.admin.QueryRow(context.Background(), `SELECT app.banking_resume($1)`, c.operation).Scan(&resumed); err != nil || !resumed {
		t.Fatal("reporting-conflict resume", err)
	}
	c.respond = func(cursor string) (*http.Response, error) {
		if cursor != "replacement-initial" {
			t.Fatal("replacement retry cursor")
		}
		return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"later-pre-boundary","account_id":"checking","amount":0.29,"iso_currency_code":"USD","date":"2026-09-20","pending":false}],"modified":[{"transaction_id":"active","account_id":"checking","amount":3.00,"iso_currency_code":"USD","date":"2026-09-30","pending":false}],"removed":[],"has_more":false,"next_cursor":"replacement-corrected"}`), nil
	}
	c.run(t)
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_sources WHERE binding_id=$1 AND ((provider_transaction_id='later-pre-boundary' AND discrepancy='historical_discrepancy') OR (provider_transaction_id='active' AND discrepancy='cross_boundary_change'))`, staged) != 2 {
		t.Fatal("later discrepancy/cross-boundary notices lost")
	}
	recovery := f.preview(uuid.Nil, "", "RESTORE_PREDECESSOR")
	h.notify(t)
	c.respond = func(string) (*http.Response, error) {
		f.confirm(recovery)
		return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"recovery-race","account_id":"checking","amount":9.99,"iso_currency_code":"USD","date":"2026-10-03","pending":false}],"modified":[],"removed":[],"has_more":false,"next_cursor":"stale-recovery"}`), nil
	}
	c.run(t)
	h.notify(t)
	if err := c.db.ReconcileBanking(context.Background()); err != nil {
		t.Fatal(err)
	}
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_sources WHERE binding_id=$1 AND provider_transaction_id='recovery-race'`, staged) != 0 || queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_bindings WHERE account_id=$1 AND NOT collection_stopped AND reporting_state IN('current','staged')`, f.account) != 0 {
		t.Fatal("recovery restored collection or accepted stale job")
	}
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND note='original private note' AND excluded`, old) != 1 {
		t.Fatal("recovery lost original owner annotation")
	}
}
