//go:build integration

package banking

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/jackc/pgx/v5"
)

func TestIndependentProtectedRemovalPersistsUnknownThenConfirmedRetry(t *testing.T) {
	f, db, _, _ := workerFixture(t)
	ctx := context.Background()
	create := func(item, token string) uuid.UUID {
		result := f.service.CreateConnection(f.actor(f.owner), ConnectionInput{AttemptID: uuid.New(), Environment: "sandbox", ProviderItemID: item, AccessToken: token})
		requireCode(t, result, "READY")
		return result.ID
	}
	target := create("independent-target", "synthetic-target-token")
	sibling := create("independent-sibling", "synthetic-sibling-token")
	remaining := map[string]bool{"synthetic-target-token": true, "synthetic-sibling-token": true}
	calls := 0
	provider := testPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Path != "/item/remove" || r.URL.Host != "sandbox.plaid.com" || r.Header.Get("PLAID-SECRET") != "secret-private" {
			return nil, errors.New("unexpected protected removal contract")
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body) != 1 || body["access_token"] != "synthetic-target-token" {
			return nil, errors.New("wrong cleanup target")
		}
		// Another session must acquire the target row while the external call runs.
		// A provider call inside the claim/finalization transaction would hold it.
		probe, err := pgx.Connect(ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
		if err != nil {
			return nil, err
		}
		defer probe.Close(ctx)
		tx, err := probe.Begin(ctx)
		if err != nil {
			return nil, err
		}
		defer tx.Rollback(ctx)
		if _, err = tx.Exec(ctx, `SET LOCAL ROLE kami_migrator`); err != nil {
			return nil, errors.New("probe could not assume fixture owner")
		}
		if _, err = tx.Exec(ctx, `SELECT id FROM app.banking_connections WHERE id=$1 FOR UPDATE NOWAIT`, target); err != nil {
			return nil, errors.New("provider called with target locked")
		}
		if calls == 1 {
			delete(remaining, body["access_token"])
			return nil, io.ErrUnexpectedEOF
		}
		return plaidTestResponse(http.StatusBadRequest, `{"error_code":"ITEM_NOT_FOUND"}`), nil
	}))
	worker, err := NewWorker(db, f.service.protector, provider)
	if err != nil {
		t.Fatal(err)
	}
	requireCode(t, f.service.Stop(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: target, ExpectedGeneration: 1}), "READY")
	if worked, err := worker.ProcessOne(ctx); err != nil || !worked {
		t.Fatal("unknown removal consumption", worked, err)
	}
	if calls != 1 || remaining["synthetic-target-token"] || !remaining["synthetic-sibling-token"] {
		t.Fatal("remote target/sibling effects")
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE connection_id=$1 AND state='pending'`, target) != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_credentials WHERE connection_id=$1`, target) != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_connections WHERE id=$1 AND provider_removed`, target) != 0 {
		t.Fatal("response loss was falsely confirmed")
	}
	var job uuid.UUID
	if err = f.admin.QueryRow(ctx, `SELECT id FROM app.banking_work WHERE connection_id=$1`, target).Scan(&job); err != nil {
		t.Fatal(err)
	}
	releaseDue(t, f, job)
	restarted, err := NewWorker(db, f.service.protector, provider)
	if err != nil {
		t.Fatal(err)
	}
	if worked, err := restarted.ProcessOne(ctx); err != nil || !worked {
		t.Fatal("confirmed retry", worked, err)
	}
	if calls != 2 || queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND attempts=2 AND state='complete'`, job) != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_credentials WHERE connection_id=$1`, target) != 0 {
		t.Fatal("narrow retry result not durable")
	}
	if !remaining["synthetic-sibling-token"] || queryInt(t, f, `SELECT count(*) FROM app.banking_credentials WHERE connection_id=$1`, sibling) != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_connections WHERE id=$1 AND state='active'`, sibling) != 1 {
		t.Fatal("unrelated Item changed")
	}
}

func TestIndependentConcurrentConsumersHaveOneProtectedEffect(t *testing.T) {
	f, db, _, _ := workerFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	connection := f.connection(f.owner, "independent-competing-workers")
	requireCode(t, f.service.Stop(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}), "READY")
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	var calls atomic.Int32
	provider := testPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		entered <- struct{}{}
		select {
		case <-release:
			return plaidTestResponse(200, `{"request_id":"confirmed"}`), nil
		case <-r.Context().Done():
			return nil, r.Context().Err()
		}
	}))
	secondDB, err := database.OpenWorker(ctx, database.Config{URL: os.Getenv("TEST_WORKER_DATABASE_URL"), MaxConns: 2, Timeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer secondDB.Close()
	first, _ := NewWorker(db, f.service.protector, provider)
	second, _ := NewWorker(secondDB, f.service.protector, provider)
	start := make(chan struct{})
	type outcome struct {
		worked bool
		err    error
	}
	results := make(chan outcome, 2)
	for _, w := range []*Worker{first, second} {
		go func(w *Worker) { <-start; worked, err := w.ProcessOne(ctx); results <- outcome{worked, err} }(w)
	}
	close(start)
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("no consumer reached provider")
	}
	var loser outcome
	select {
	case loser = <-results:
	case <-ctx.Done():
		t.Fatal("competing consumer blocked instead of skipping claim")
	}
	if loser.err != nil || loser.worked {
		t.Fatal("competing claim", loser.worked, loser.err)
	}
	if calls.Load() != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE connection_id=$1 AND attempts=1 AND state='running'`, connection) != 1 {
		t.Fatal("duplicate provider claim")
	}
	close(release)
	select {
	case winner := <-results:
		if winner.err != nil || !winner.worked {
			t.Fatal("winner", winner.worked, winner.err)
		}
	case <-ctx.Done():
		t.Fatal("winner did not finish")
	}
	if calls.Load() != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE connection_id=$1 AND state='complete' AND attempts=1`, connection) != 1 {
		t.Fatal("duplicate local/remote effect")
	}
}

type independentPausedObserver struct {
	entered chan struct{}
	release chan struct{}
	item    string
}

func (p *independentPausedObserver) Remove(context.Context, string, Credential) (RemovalResult, error) {
	return RemovalResult{Confirmed: true}, nil
}
func (p *independentPausedObserver) Observe(ctx context.Context, _ string, _ Credential) (Observation, error) {
	close(p.entered)
	select {
	case <-p.release:
		return Observation{ItemID: p.item, Healthy: true}, nil
	case <-ctx.Done():
		return Observation{}, ctx.Err()
	}
}
func TestIndependentLateObservationCannotCrossStopOrDeletion(t *testing.T) {
	for _, erase := range []bool{false, true} {
		t.Run(map[bool]string{false: "stop", true: "delete"}[erase], func(t *testing.T) {
			f, db, _, _ := workerFixture(t)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			item := "independent-delayed-observation"
			connection := f.connection(f.owner, item)
			_, binding := f.binding(f.owner, connection, "selected")
			f.exec(`UPDATE app.banking_connections SET permission_state='granted' WHERE id=$1`, connection)
			// The scheduler is covered separately; isolate this delayed result from
			// unrelated healthy fixture bindings left by preceding integration tests.
			f.exec(`SELECT app.banking_enqueue($1,1,'reconcile')`, connection)
			provider := &independentPausedObserver{entered: make(chan struct{}), release: make(chan struct{}), item: item}
			worker, _ := NewWorker(db, f.service.protector, provider)
			done := make(chan error, 1)
			go func() { _, err := worker.ProcessOne(ctx); done <- err }()
			select {
			case <-provider.entered:
			case <-ctx.Done():
				t.Fatal("observation not claimed")
			}
			input := FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}
			result := Result{}
			if erase {
				result = f.service.DeleteHistory(f.actor(f.owner), input)
			} else {
				result = f.service.Stop(f.actor(f.owner), input)
			}
			requireCode(t, result, "READY")
			close(provider.release)
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-ctx.Done():
				t.Fatal("observation did not return")
			}
			if queryInt(t, f, `SELECT count(*) FROM app.banking_reconciliation WHERE binding_id=$1 AND state='healthy'`, binding) != 0 {
				t.Fatal("late result crossed terminal generation")
			}
			if queryInt(t, f, `SELECT count(*) FROM app.banking_connections WHERE id=$1 AND generation=2 AND state<>'active'`, connection) != 1 {
				t.Fatal("late observation revived connection")
			}
			var old uuid.UUID
			if err := f.admin.QueryRow(ctx, `SELECT id FROM app.banking_work WHERE connection_id=$1 AND generation=1 AND kind='reconcile'`, connection).Scan(&old); err != nil {
				t.Fatal(err)
			}
			releaseDue(t, f, old)
			for range 5 {
				if _, err := worker.ProcessOne(ctx); err != nil {
					t.Fatal(err)
				}
			}
			if queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='complete' AND last_code='SUPERSEDED'`, old) != 1 {
				t.Fatal("obsolete observation not retired")
			}
			if queryInt(t, f, `SELECT count(*) FROM app.banking_credentials WHERE connection_id=$1`, connection) != 0 {
				t.Fatal("terminal cleanup did not complete")
			}
		})
	}
}

func TestIndependentSignedIngressRejectsRoutingAndForgeryWithoutWrites(t *testing.T) {
	f, _, _, _ := workerFixture(t)
	connection := f.connection(f.owner, "independent-http-item")
	correlation := uuid.New()
	f.exec(`INSERT INTO app.banking_webhook_correlations VALUES($1,$2,1)`, correlation, connection)
	signed := newWebhookFixture(t)
	handler, err := NewWebhookHandler(signed.verifier, f.service)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	send := func(id uuid.UUID, body []byte, signature string) int {
		request, err := http.NewRequest(http.MethodPost, server.URL+"/banking/webhooks/"+id.String(), bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Plaid-Verification", signature)
		response, err := server.Client().Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		_, _ = io.Copy(io.Discard, response.Body)
		return response.StatusCode
	}
	body := webhookBody("sandbox", "independent-http-item")
	wrongItem := webhookBody("sandbox", "unrelated-item")
	wrongEnvironment := webhookBody("production", "independent-http-item")
	forged := newWebhookFixture(t)
	for _, tc := range []struct {
		name      string
		id        uuid.UUID
		body      []byte
		signature string
	}{
		{"unknown correlation", uuid.New(), body, signed.sign(t, body, signed.now, nil)},
		{"wrong item", correlation, wrongItem, signed.sign(t, wrongItem, signed.now, nil)},
		{"wrong environment", correlation, wrongEnvironment, signed.sign(t, wrongEnvironment, signed.now, nil)},
		{"stale", correlation, body, signed.sign(t, body, signed.now.Add(-6*time.Minute), nil)},
		{"forgery", correlation, body, forged.sign(t, body, forged.now, nil)},
	} {
		if code := send(tc.id, tc.body, tc.signature); code != http.StatusBadRequest {
			t.Fatalf("%s returned %d", tc.name, code)
		}
		if queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_receipts WHERE correlation_id=$1`, correlation) != 0 {
			t.Fatalf("%s persisted receipt", tc.name)
		}
	}
	signature := signed.sign(t, body, signed.now, nil)
	if code := send(correlation, body, signature); code != http.StatusNoContent {
		t.Fatal("valid event", code)
	}
	requireCode(t, f.service.Stop(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}), "READY")
	late := append(append([]byte{}, body...), byte(' '))
	for range 2 {
		if code := send(correlation, late, signed.sign(t, late, signed.now, nil)); code != http.StatusNoContent {
			t.Fatal("late event", code)
		}
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_receipts WHERE correlation_id=$1 AND state='terminal'`, correlation) != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_receipts WHERE correlation_id=$1`, correlation) != 2 {
		t.Fatal("terminal receipt/replay not durable")
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_connections WHERE id=$1 AND state='stopped' AND generation=2`, connection) != 1 {
		t.Fatal("late webhook undid terminal state")
	}
}

func TestIndependentProviderMinimumRetryIsNeverRoundedEarlier(t *testing.T) {
	f, db, _, _ := workerFixture(t)
	ctx := context.Background()
	connection := f.connection(f.owner, "independent-provider-minimum")
	requireCode(t, f.service.Stop(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}), "READY")
	notBefore := time.Now().Add(130 * time.Second).UTC().Truncate(time.Second)
	provider := testPlaid(t, bankingRoundTrip(func(*http.Request) (*http.Response, error) {
		response := plaidTestResponse(http.StatusTooManyRequests, `{}`)
		response.Header.Set("Retry-After", notBefore.Format(http.TimeFormat))
		return response, nil
	}))
	worker, _ := NewWorker(db, f.service.protector, provider)
	if worked, err := worker.ProcessOne(ctx); err != nil || !worked {
		t.Fatal(worked, err)
	}
	var due time.Time
	if err := f.admin.QueryRow(ctx, `SELECT due_at FROM app.banking_work WHERE connection_id=$1 AND state='pending'`, connection).Scan(&due); err != nil {
		t.Fatal(err)
	}
	if due.Before(notBefore) {
		t.Fatalf("retry scheduled %s before provider minimum", notBefore.Sub(due))
	}
}
