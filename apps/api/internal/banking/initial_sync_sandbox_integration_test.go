//go:build integration

package banking

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
)

// This isolated opt-in check uses a synthetic Sandbox Item and real restricted
// database/consumer. Link preparation remains covered by deterministic enrollment
// tests; this check does not attest live Link, institution consent or release.
func TestInitialSandboxConsumer(t *testing.T) {
	if os.Getenv("PLAID_INITIAL_SANDBOX_CHECK") != "1" {
		t.Skip("opt-in Sandbox consumer disabled")
	}
	provider, err := NewPlaidProvider(PlaidConfig{Environment: "sandbox", ClientID: os.Getenv("PLAID_CLIENT_ID"), Secret: os.Getenv("PLAID_SANDBOX_SECRET")}, nil)
	if err != nil {
		t.Fatal("Sandbox configuration unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
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
	t.Logf("real restricted consumer committed selected synthetic checking rows=%d; complete history and institution freshness remain unproven", count)
}
