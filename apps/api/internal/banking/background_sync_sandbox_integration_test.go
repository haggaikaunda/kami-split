//go:build integration

package banking

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
)

// This isolated opt-in check uses a synthetic Sandbox Item and real restricted
// database/consumer. Link preparation remains covered by deterministic enrollment
// tests; this check does not attest live Link, institution consent or release.
func TestBackgroundSandboxConsumer(t *testing.T) {
	if os.Getenv("PLAID_BACKGROUND_SANDBOX_CHECK") != "1" {
		t.Skip("opt-in Sandbox consumer disabled")
	}
	origin, parseErr := url.Parse(os.Getenv("PLAID_BACKGROUND_WEBHOOK_ORIGIN"))
	if parseErr != nil || origin.Scheme != "https" || origin.Host == "" || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || strings.Trim(origin.Path, "/") != "" {
		t.Fatal("dedicated HTTPS Sandbox receiver origin required")
	}
	listenAddr := os.Getenv("PLAID_BACKGROUND_LISTEN_ADDR")
	host, _, parseErr := net.SplitHostPort(listenAddr)
	if parseErr != nil || host != "127.0.0.1" {
		t.Fatal("explicit dedicated loopback receiver required")
	}
	provider, err := NewPlaidProvider(PlaidConfig{Environment: "sandbox", ClientID: os.Getenv("PLAID_CLIENT_ID"), Secret: os.Getenv("PLAID_SANDBOX_SECRET")}, nil)
	if err != nil {
		t.Fatal("Sandbox configuration unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	var created struct {
		Public string `json:"public_token"`
	}
	if err := provider.enrollmentPost(ctx, "/sandbox/public_token/create", map[string]any{"institution_id": "ins_109508", "initial_products": []string{"transactions"}, "options": map[string]any{"transactions": map[string]int{"days_requested": 365}}}, &created, true); err != nil || created.Public == "" {
		t.Fatal("synthetic Sandbox create unconfirmed; inspect owned inventory before retry")
	}
	var exchangedPayload struct {
		ItemID      string `json:"item_id"`
		AccessToken string `json:"access_token"`
	}
	// The isolated adapter/consumer test does not assert user-scoped enrollment
	// capabilities. Exchange directly once, just like TestSyncSandboxContract.
	err = provider.enrollmentPost(ctx, "/item/public_token/exchange", map[string]string{"public_token": created.Public}, &exchangedPayload, true)
	if err != nil || !validProviderID(exchangedPayload.ItemID) || exchangedPayload.AccessToken == "" {
		t.Fatal("synthetic single exchange unconfirmed; do not replay exchange")
	}
	exchanged := ExchangeResult{ItemID: exchangedPayload.ItemID, AccessToken: Credential{raw: []byte(exchangedPayload.AccessToken)}}
	t.Cleanup(func() {
		cleanupCtx, done := context.WithTimeout(context.Background(), 30*time.Second)
		defer done()
		result, err := provider.Remove(cleanupCtx, "sandbox", exchanged.AccessToken)
		if err != nil || !result.Confirmed {
			t.Error("owned Sandbox Item removal unconfirmed")
		} else {
			t.Log("owned synthetic Sandbox Item removal confirmed")
		}
	})
	inventory, err := provider.Accounts(ctx, "sandbox", exchanged.AccessToken)
	if err != nil || inventory.ItemID != exchanged.ItemID {
		t.Fatal("synthetic inventory unavailable")
	}
	selected := ""
	for _, account := range inventory.Accounts {
		if account.Type == "depository" && account.Subtype == "checking" && account.Currency == "USD" {
			selected = account.ID
			break
		}
	}
	if selected == "" {
		t.Fatal("supported synthetic checking unavailable")
	}
	f := newFixture(t)
	result := f.service.CreateConnection(f.actor(f.owner), ConnectionInput{AttemptID: uuid.New(), Environment: "sandbox", ProviderItemID: exchanged.ItemID, AccessToken: string(exchanged.AccessToken.Bytes())})
	requireCode(t, result, "READY")
	// Explicit synthetic selection fixture: no provider inventory implicitly grants
	// selection. Only the chosen account is persisted under its authenticated owner.
	_, binding := f.binding(f.owner, result.ID, selected)
	f.exec(`INSERT INTO app.banking_enrollment_accounts(binding_id,owner_id,environment,institution_id,stable_id,display_name,currency,requested_history_days) VALUES($1,$2,'sandbox',$3,'','Synthetic selected checking','USD',365)`, binding, f.owner, inventory.InstitutionID)
	f.exec(`UPDATE app.banking_connections SET permission_state='granted' WHERE id=$1`, result.ID)
	db, err := database.OpenWorker(ctx, database.Config{URL: os.Getenv("TEST_WORKER_DATABASE_URL"), MaxConns: 3, Timeout: 5 * time.Second})
	if err != nil {
		t.Fatal("restricted worker unavailable")
	}
	defer db.Close()
	worker, _ := NewWorker(db, f.service.protector, provider)
	var operation uuid.UUID
	if err := f.admin.QueryRow(ctx, `SELECT id FROM app.banking_work WHERE binding_id=$1 AND kind='initial_sync'`, binding).Scan(&operation); err != nil {
		t.Fatal("Sandbox durable selection intent missing")
	}
	completed := false
	for poll := 0; poll < 100; poll++ {
		// Both clocks gate a claim. banking_finish sets due_at and then transport
		// visibility, so waking at due_at alone can poll before pgmq exposes it.
		// Measure remaining duration in PostgreSQL's clock domain, round upward,
		// then preserve that full delay after receiving the query response.
		var waitMillis, visibilityLagMicros int64
		var olderMessages, attempts int
		if err := f.admin.QueryRow(ctx, `
SELECT ceil(greatest(0,extract(epoch FROM greatest(w.due_at,q.vt)-clock_timestamp())*1000))::bigint,
 ceil(extract(epoch FROM q.vt-w.due_at)*1000000)::bigint,
 (SELECT count(*) FROM pgmq.q_banking_lifecycle older WHERE older.msg_id<q.msg_id),w.attempts
FROM app.banking_work w JOIN pgmq.q_banking_lifecycle q ON q.msg_id=w.message_id
WHERE w.id=$1 AND w.state='pending'`, operation).Scan(&waitMillis, &visibilityLagMicros, &olderMessages, &attempts); err != nil {
			t.Fatal("Sandbox pending intent or transport unavailable")
		}
		if attempts >= 5 {
			t.Fatal("Sandbox provider attempt budget exhausted")
		}
		t.Logf("Sandbox claim wait milliseconds=%d; transport minus durable due microseconds=%d", waitMillis, visibilityLagMicros)
		timer := time.NewTimer(time.Duration(waitMillis) * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			t.Fatal("Sandbox bounded readiness deadline")
		case <-timer.C:
		}
		worked, err := worker.ProcessOne(ctx)
		if err != nil {
			t.Fatal("Sandbox actual consumer returned an error")
		}
		if !worked {
			var state string
			var remainingOlder int
			var due, visible bool
			if diagnosticErr := f.admin.QueryRow(ctx, `
SELECT w.state,w.attempts,w.due_at<=clock_timestamp(),coalesce(q.vt<=clock_timestamp(),false),
 (SELECT count(*) FROM pgmq.q_banking_lifecycle older WHERE older.msg_id<q.msg_id)
FROM app.banking_work w LEFT JOIN pgmq.q_banking_lifecycle q ON q.msg_id=w.message_id
WHERE w.id=$1`, operation).Scan(&state, &attempts, &due, &visible, &remainingOlder); diagnosticErr != nil {
				t.Fatal("Sandbox actual consumer unavailable; safe state unavailable")
			}
			// A one-message poll can discard an earlier orphan/terminal transport
			// without claiming this operation. Continue only on observed progress;
			// never mask an error, target-state change or inexplicable empty claim.
			if state == "pending" && due && visible && remainingOlder < olderMessages {
				t.Logf("Sandbox poll removed earlier transport; remaining earlier messages=%d", remainingOlder)
				continue
			}
			t.Fatalf("Sandbox actual consumer unavailable; worked=%t error=%t state=%s attempts=%d due=%t visible=%t", worked, err != nil, state, attempts, due, visible)
		}
		if queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='complete' AND import_code='LOCAL_BATCH_COMMITTED'`, operation) == 1 {
			completed = true
			break
		}
	}
	if !completed {
		t.Fatal("Sandbox initial batch not completed within bounded attempts")
	}
	count := queryInt(t, f, `SELECT count(*) FROM app.banking_sources WHERE binding_id=$1`, binding)
	if count == 0 {
		t.Fatal("Sandbox selected source rows unobserved")
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_bindings WHERE id=$1 AND sync_cursor IS NOT NULL AND last_local_commit IS NOT NULL AND import_state='usable' AND coverage_after IS NULL AND coverage_through IS NULL`, binding) != 1 {
		t.Fatal("Sandbox checkpoint/commit facts unavailable")
	}
	t.Logf("real restricted consumer completed initial selected synthetic rows=%d", count)
	correlation := uuid.New()
	f.exec(`INSERT INTO app.banking_webhook_correlations(id,connection_id,generation) VALUES($1,$2,1)`, correlation, result.ID)
	verifier, err := NewWebhookVerifier(provider, nil)
	if err != nil {
		t.Fatal("real Sandbox verifier unavailable")
	}
	handler, err := NewWebhookHandler(verifier, f.service)
	if err != nil {
		t.Fatal("Sandbox receiver unavailable")
	}
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		t.Fatal("owned Sandbox receiver port unavailable")
	}
	var drop atomic.Bool
	var callbacks sync.RWMutex
	route := "/banking/webhooks/" + correlation.String()
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != route {
			http.NotFound(w, r)
			return
		}
		callbacks.RLock()
		defer callbacks.RUnlock()
		if drop.Load() {
			http.Error(w, "test receiver paused", http.StatusServiceUnavailable)
			return
		}
		handler.ServeHTTP(w, r)
	}), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 8 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 10 * time.Second, MaxHeaderBytes: 8 << 10}
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	defer func() {
		shutdown, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		if err := server.Shutdown(shutdown); err != nil {
			t.Error("Sandbox receiver shutdown unconfirmed")
			_ = server.Close()
		}
		if err := <-served; err != http.ErrServerClosed {
			t.Error("Sandbox receiver stopped unexpectedly")
		}
	}()
	var ack struct {
		WebhookFired bool `json:"webhook_fired"`
	}
	var ignored struct{}
	if err := provider.enrollmentPost(ctx, "/item/webhook/update", map[string]any{"access_token": exchangedPayload.AccessToken, "webhook": origin.String() + route}, &ignored, false); err != nil {
		t.Fatal("Sandbox webhook assignment unconfirmed")
	}
	t.Log("dedicated signed Sandbox receiver ready; Item callback assigned")
	add := func(description string) {
		t.Helper()
		today := time.Now().UTC().Format("2006-01-02")
		err := provider.enrollmentPost(ctx, "/sandbox/transactions/create", map[string]any{"access_token": exchangedPayload.AccessToken, "transactions": []any{map[string]any{"date_transacted": today, "date_posted": today, "amount": json.Number("0.29"), "description": description, "iso_currency_code": "USD", "account_id": selected}}}, &ignored, true)
		if err != nil {
			t.Fatal("Sandbox selected-account transaction creation unconfirmed")
		}
	}
	marker := "kami-background-" + uuid.NewString()
	add(marker)
	if err := provider.enrollmentPost(ctx, "/sandbox/item/fire_webhook", map[string]any{"access_token": exchangedPayload.AccessToken, "webhook_type": "TRANSACTIONS", "webhook_code": "SYNC_UPDATES_AVAILABLE"}, &ack, true); err != nil || !ack.WebhookFired {
		t.Fatal("Sandbox webhook dispatch request unconfirmed")
	}
	t.Log("provider confirmed Transactions webhook dispatch request; awaiting actual verified durable receipt")
	waitSandboxCondition(t, ctx, func() bool {
		return queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_receipts WHERE correlation_id=$1 AND event_type='TRANSACTIONS' AND event_code='SYNC_UPDATES_AVAILABLE' AND dispatch_state='dispatched'`, correlation) > 0
	})
	t.Log("actual Sandbox-signed Transactions delivery verified and durably dispatched")
	consumeSandboxMarker(t, ctx, f, worker, operation, binding, marker)
	t.Log("actual consumer committed provider-created selected-account incremental transaction")
	// Remove the callback and pause this test receiver before adding a second fact.
	// Any delivery already in flight is refused and cannot create accepted demand.
	callbacks.Lock()
	drop.Store(true)
	callbacks.Unlock()
	if err := provider.enrollmentPost(ctx, "/item/webhook/update", map[string]any{"access_token": exchangedPayload.AccessToken, "webhook": nil}, &ignored, false); err != nil {
		t.Fatal("Sandbox callback removal unconfirmed")
	}
	// Drain demand accepted before callback shutdown, then establish the exact
	// durable baseline before the intentionally unnotified provider change.
	consumeSandboxMarker(t, ctx, f, worker, operation, binding, marker)
	var beforeRequest int64
	if err := f.admin.QueryRow(ctx, `SELECT requested_version FROM app.banking_work WHERE id=$1 AND state='complete' AND requested_version=completed_version`, operation).Scan(&beforeRequest); err != nil {
		t.Fatal("Sandbox pre-reconciliation baseline unavailable")
	}
	missed := "kami-missed-" + uuid.NewString()
	add(missed)
	if queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='complete' AND requested_version=$2 AND completed_version=$2`, operation, beforeRequest) != 1 {
		t.Fatal("Sandbox absent callback unexpectedly changed demand")
	}
	f.exec(`UPDATE app.banking_work SET due_at=clock_timestamp()-interval '1 day' WHERE id=$1 AND state='complete'`, operation)
	if err := db.ReconcileBanking(ctx); err != nil {
		t.Fatal("Sandbox missed-notification reconciliation unavailable")
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='pending' AND last_code='DAILY_RECONCILIATION' AND requested_version=$2 AND completed_version=$3`, operation, beforeRequest+1, beforeRequest) != 1 {
		t.Fatal("Sandbox missed-notification demand did not originate in daily reconciliation")
	}
	t.Log("callbacks drained; exact daily reconciliation request watermark observed before consumption")
	consumeSandboxMarker(t, ctx, f, worker, operation, binding, missed)
	t.Log("daily reconciliation committed provider-created transaction with callback disabled; complete history and institution freshness remain unproven")
}

// Conditions use real provider/database timing. No forced early retry or silent
// skip can convert absent delivered receipt or persisted source into success.
func waitSandboxCondition(t *testing.T, ctx context.Context, ready func() bool) {
	t.Helper()
	for poll := 0; poll < 120; poll++ {
		if ready() {
			return
		}
		timer := time.NewTimer(time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			t.Fatal("Sandbox observation deadline")
		case <-timer.C:
		}
	}
	t.Fatal("Sandbox expected observation unavailable")
}
func consumeSandboxMarker(t *testing.T, ctx context.Context, f *fixture, worker *Worker, operation, binding uuid.UUID, marker string) {
	t.Helper()
	for poll := 0; poll < 100; poll++ {
		if queryInt(t, f, `SELECT count(*) FROM app.banking_sources s JOIN app.banking_source_revisions r ON r.source_id=s.id AND r.revision=s.revision WHERE s.binding_id=$1 AND r.name=$2 AND r.amount_minor=29`, binding, marker) == 1 && queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='complete' AND requested_version=completed_version`, operation) == 1 {
			return
		}
		var waitMillis int64
		var state string
		var attempts int
		if err := f.admin.QueryRow(ctx, `SELECT w.state,w.attempts,ceil(greatest(0,extract(epoch FROM greatest(w.due_at,coalesce(q.vt,w.due_at))-clock_timestamp())*1000))::bigint FROM app.banking_work w LEFT JOIN pgmq.q_banking_lifecycle q ON q.msg_id=w.message_id WHERE w.id=$1`, operation).Scan(&state, &attempts, &waitMillis); err != nil {
			t.Fatal("Sandbox safe work state unavailable")
		}
		if state == "needs_attention" || attempts >= 5 || state == "complete" {
			t.Fatal("Sandbox source change not observed in completed pass")
		}
		timer := time.NewTimer(time.Duration(waitMillis) * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			t.Fatal("Sandbox consumer deadline")
		case <-timer.C:
		}
		if _, err := worker.ProcessOne(ctx); err != nil {
			t.Fatal("Sandbox background consumer unavailable")
		}
	}
	t.Fatal("Sandbox consumer poll budget exhausted")
}
