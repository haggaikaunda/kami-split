//go:build integration

package banking

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

type backgroundIngress struct {
	signed      *webhookFixture
	handler     *WebhookHandler
	correlation uuid.UUID
	body        []byte
}

func newBackgroundIngress(t *testing.T, c *initialConsumerFixture) *backgroundIngress {
	t.Helper()
	var correlation uuid.UUID
	if err := c.admin.QueryRow(context.Background(), `SELECT id FROM app.banking_webhook_correlations WHERE connection_id=$1`, c.connection).Scan(&correlation); err != nil {
		t.Fatal(err)
	}
	signed := newWebhookFixture(t)
	handler, err := NewWebhookHandler(signed.verifier, c.service)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"environment": "sandbox", "item_id": "item-public-" + correlation.String(), "webhook_type": "TRANSACTIONS", "webhook_code": "SYNC_UPDATES_AVAILABLE"})
	return &backgroundIngress{signed: signed, handler: handler, correlation: correlation, body: body}
}
func (h *backgroundIngress) notify(t *testing.T) string {
	t.Helper()
	signature := h.signed.sign(t, h.body, h.signed.now, nil)
	if status := lifecycleSignedRequest(h.handler, h.correlation, h.body, signature); status != 204 {
		t.Fatal("verified Transactions acceptance", status)
	}
	return signature
}
func backgroundVersion(t *testing.T, c *initialConsumerFixture) int {
	return queryInt(t, c.fixture, `SELECT requested_version::integer FROM app.banking_work WHERE id=$1`, c.operation)
}

func TestBackgroundConsumerVerifiedLosslessCoalescing(t *testing.T) {
	c := newInitialConsumer(t)
	h := newBackgroundIngress(t, c)
	first := h.notify(t)
	version := backgroundVersion(t, c)
	// A durable ACK precedes import; a duplicate exact delivery cannot create demand.
	if c.sources(t) != 0 || queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_webhook_receipts WHERE correlation_id=$1 AND dispatch_state='dispatched'`, h.correlation) != 1 {
		t.Fatal("ACK did not mean durable dispatch")
	}
	if lifecycleSignedRequest(h.handler, h.correlation, h.body, first) != 204 || backgroundVersion(t, c) != version {
		t.Fatal("duplicate delivery created demand")
	}
	c.respond = func(cursor string) (*http.Response, error) {
		if cursor != "" {
			t.Fatal("initial cursor")
		}
		// Arriving after claim but before final publication must cause another pass.
		h.notify(t)
		return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"first","account_id":"checking","amount":1.25,"iso_currency_code":"USD","date":"2026-10-01","pending":false}],"modified":[],"removed":[],"has_more":false,"next_cursor":"initial"}`), nil
	}
	c.run(t)
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='pending' AND requested_version>completed_version AND attempts=0`, c.operation) != 1 {
		t.Fatal("active batch swallowed notification")
	}
	c.respond = func(cursor string) (*http.Response, error) {
		if cursor != "initial" {
			t.Fatal("follow-up lost committed checkpoint")
		}
		return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"refund","account_id":"checking","amount":-0.29,"iso_currency_code":"USD","date":"2026-10-02","pending":false}],"modified":[{"transaction_id":"first","account_id":"checking","amount":2.50,"iso_currency_code":"USD","date":"2026-10-01","pending":false}],"removed":[],"has_more":false,"next_cursor":"incremental"}`), nil
	}
	c.run(t)
	if c.sources(t) != 2 || queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='complete' AND completed_version=requested_version`, c.operation) != 1 {
		t.Fatal("incremental convergence")
	}
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_sources s JOIN app.banking_source_revisions r ON r.source_id=s.id AND r.revision=s.revision WHERE s.binding_id=$1 AND r.amount_minor IN(250,-29)`, c.binding) != 2 {
		t.Fatal("added/modified exact money")
	}
	// Replayed signatures stay inert after ACK; newly signed identical bodies and
	// out-of-order valid signatures describe unknown demand and remain conservative.
	if lifecycleSignedRequest(h.handler, h.correlation, h.body, first) != 204 || queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='complete'`, c.operation) != 1 {
		t.Fatal("old replay reopened completed work")
	}
	later := h.signed.sign(t, h.body, h.signed.now.Add(time.Minute), nil)
	earlier := h.signed.sign(t, h.body, h.signed.now.Add(30*time.Second), nil)
	h.signed.now = h.signed.now.Add(time.Minute)
	for _, signature := range []string{later, earlier} {
		if lifecycleSignedRequest(h.handler, h.correlation, h.body, signature) != 204 {
			t.Fatal("out-of-order valid notification")
		}
	}
	c.respond = func(cursor string) (*http.Response, error) {
		if cursor != "incremental" {
			t.Fatal("incremental cursor regressed")
		}
		return plaidTestResponse(200, `{"accounts":[],"added":[],"modified":[],"removed":[{"transaction_id":"first","account_id":"checking"}],"has_more":false,"next_cursor":"removed"}`), nil
	}
	c.run(t)
	if len(c.requests) != 3 || queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_sources s JOIN app.banking_source_revisions r ON r.source_id=s.id AND r.revision=s.revision WHERE s.binding_id=$1 AND r.processing_state='removed'`, c.binding) != 1 {
		t.Fatal("coalesced removal/history")
	}
	if queryInt(t, c.fixture, `SELECT count(*) FROM pgmq.q_banking_lifecycle WHERE message-'operation_id'-'generation'<>'{}'::jsonb`) != 0 {
		t.Fatal("private queue payload")
	}
}

func TestBackgroundIngressRejectsInvalidAndMismatchedEvents(t *testing.T) {
	for _, mode := range []string{"body", "stale", "future", "environment", "unknown-item", "algorithm", "malformed", "unknown-code"} {
		t.Run(mode, func(t *testing.T) {
			c := newInitialConsumer(t)
			c.run(t)
			h := newBackgroundIngress(t, c)
			before := backgroundVersion(t, c)
			body := h.body
			issued := h.signed.now
			switch mode {
			case "stale":
				issued = issued.Add(-6 * time.Minute)
			case "future":
				issued = issued.Add(time.Minute)
			case "environment":
				body = []byte(`{"environment":"production","item_id":"wrong","webhook_type":"TRANSACTIONS","webhook_code":"SYNC_UPDATES_AVAILABLE"}`)
			case "unknown-item":
				body = []byte(`{"environment":"sandbox","item_id":"wrong","webhook_type":"TRANSACTIONS","webhook_code":"SYNC_UPDATES_AVAILABLE"}`)
			case "malformed":
				body = []byte(`{`)
			case "unknown-code":
				body = []byte(`{"environment":"sandbox","item_id":"item-public-` + h.correlation.String() + `","webhook_type":"TRANSACTIONS","webhook_code":"HISTORICAL_UPDATE"}`)
			}
			signature := h.signed.sign(t, body, issued, nil)
			if mode == "body" {
				body = append(body, ' ')
			}
			if mode == "algorithm" {
				signature = "eyJhbGciOiJub25lIn0.e30."
			}
			status := lifecycleSignedRequest(h.handler, h.correlation, body, signature)
			// Unknown Item hints retain existing narrow enrollment-recovery behavior;
			// neither those hints nor legacy unsupported notification codes import data.
			if mode != "unknown-item" && mode != "unknown-code" && status != 400 {
				t.Fatal("invalid signature/body accepted", status)
			}
			if backgroundVersion(t, c) != before || len(c.requests) != 1 {
				t.Fatal("invalid event dispatched import")
			}
		})
	}
}

func TestBackgroundConsumerDailyCatchupRestartAndRetryBudget(t *testing.T) {
	c := newInitialConsumer(t)
	c.run(t)
	c.respond = func(cursor string) (*http.Response, error) {
		if cursor != "committed" {
			t.Fatal("daily catch-up cursor")
		}
		return plaidTestResponse(429, `{"error_type":"RATE_LIMIT_EXCEEDED","error_code":"TRANSACTIONS_SYNC_LIMIT"}`), nil
	}
	// Simulate elapsed daily deadlines and missed scheduler polls, not a database
	// wall-clock jump. A sweep only rearms completed healthy eligible intent.
	c.exec(`UPDATE app.banking_work SET due_at=clock_timestamp()-interval '2 days' WHERE id=$1`, c.operation)
	if err := c.db.ReconcileBanking(context.Background()); err != nil {
		t.Fatal(err)
	}
	h := newBackgroundIngress(t, c)
	for attempt := 1; attempt <= 10; attempt++ {
		beforeRequests := len(c.requests)
		for poll := 0; poll < 5 && len(c.requests) == beforeRequests; poll++ {
			c.run(t)
		}
		if len(c.requests) != beforeRequests+1 {
			t.Fatal("due sync pass not consumed")
		}
		h.notify(t)
		if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND attempts=$2`, c.operation, attempt) != 1 {
			t.Fatal("hint reset retry budget")
		}
		// Loss of queue transport and process restart preserve exact intent/attempts.
		if attempt == 1 {
			c.exec(`SELECT pgmq.delete('banking_lifecycle',message_id) FROM app.banking_work WHERE id=$1`, c.operation)
			if err := c.db.ReconcileBanking(context.Background()); err != nil {
				t.Fatal(err)
			}
			var err error
			c.worker, err = NewWorker(c.db, c.service.protector, c.worker.provider)
			if err != nil {
				t.Fatal(err)
			}
			if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work w JOIN pgmq.q_banking_lifecycle q ON q.msg_id=w.message_id WHERE w.id=$1 AND w.attempts=1 AND w.due_at>clock_timestamp()+interval '59 seconds'`, c.operation) != 1 {
				t.Fatal("lost transport recovery reset deadline/budget")
			}
		}
		if attempt < 10 {
			releaseDue(t, c.fixture, c.operation)
		}
	}
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='needs_attention' AND attempts=10`, c.operation) != 1 {
		t.Fatal("outage not bounded")
	}
	if err := c.db.ReconcileBanking(context.Background()); err != nil {
		t.Fatal(err)
	}
	if worked, err := c.worker.ProcessOne(context.Background()); err != nil {
		t.Fatal(err)
	} else if worked && len(c.requests) > 11 {
		t.Fatal("sweep resumed exhausted provider work")
	}
	var resumed bool
	if err := c.admin.QueryRow(context.Background(), `SELECT app.banking_resume($1)`, c.operation).Scan(&resumed); err != nil || !resumed {
		t.Fatal("authorized resume", err)
	}
	c.respond = func(cursor string) (*http.Response, error) {
		if cursor != "committed" {
			t.Fatal("resume changed checkpoint")
		}
		return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"missed","account_id":"checking","amount":0.29,"iso_currency_code":"USD","date":"2026-10-03","pending":false}],"modified":[],"removed":[],"has_more":false,"next_cursor":"caught-up"}`), nil
	}
	c.run(t)
	if c.sources(t) != 2 || queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_bindings WHERE id=$1 AND sync_cursor='caught-up'`, c.binding) != 1 {
		t.Fatal("missed update not recovered")
	}
}

func TestBackgroundConsumerIncrementalLifecycleRaces(t *testing.T) {
	for _, mode := range []string{"disconnect", "revocation", "deselection", "disabled", "owner-deleted", "delete"} {
		t.Run(mode, func(t *testing.T) {
			c := newInitialConsumer(t)
			c.run(t)
			h := newBackgroundIngress(t, c)
			h.notify(t)
			c.respond = func(cursor string) (*http.Response, error) {
				if cursor != "committed" {
					t.Fatal("incremental lifecycle cursor")
				}
				switch mode {
				case "disconnect":
					requireCode(t, c.service.Stop(c.actor(c.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: c.connection, ExpectedGeneration: 1}), "READY")
				case "delete":
					requireCode(t, c.service.DeleteHistory(c.actor(c.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: c.connection, ExpectedGeneration: 1}), "READY")
				case "deselection":
					requireCode(t, c.enrollment.ChangeSelection(c.actor(c.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: c.connection, ExpectedGeneration: 1, AccountIDs: []string{}}), "READY")
				case "disabled":
					c.exec(`UPDATE app.users SET enabled=false WHERE id=$1`, c.owner)
				case "owner-deleted":
					c.exec(`UPDATE app.users SET enabled=false,live_auth_id=NULL WHERE id=$1`, c.owner)
				case "revocation":
					if lifecycleEvent(t, c.fixture, h.correlation, "item-public-"+h.correlation.String(), "USER_PERMISSION_REVOKED", "", "") != 204 {
						t.Fatal("revocation")
					}
				}
				return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"must-not-return","account_id":"checking","amount":9.99,"iso_currency_code":"USD","date":"2026-10-03","pending":false}],"modified":[],"removed":[],"has_more":false,"next_cursor":"late"}`), nil
			}
			c.run(t)
			h.notify(t) // A late valid callback grants no authority.
			if err := c.db.ReconcileBanking(context.Background()); err != nil {
				t.Fatal(err)
			}
			for range 8 {
				if _, err := c.worker.ProcessOne(context.Background()); err != nil {
					t.Fatal(err)
				}
			}
			if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_sources WHERE binding_id=$1 AND provider_transaction_id='must-not-return'`, c.binding) != 0 {
				t.Fatal("late callback resurrected history")
			}
			if mode == "delete" {
				if c.sources(t) != 0 {
					t.Fatal("private purge failed")
				}
			} else if c.sources(t) != 1 {
				t.Fatal("retained source history lost")
			}
			if len(c.requests) != 2 {
				t.Fatal("sweep restored collection authority")
			}
		})
	}
}

func TestBackgroundConsumerPendingLinksAndAnnotationConflicts(t *testing.T) {
	c := newInitialConsumer(t)
	c.respond = func(string) (*http.Response, error) {
		return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"pending","account_id":"checking","amount":2.50,"iso_currency_code":"USD","date":"2026-09-30","pending":true}],"modified":[],"removed":[],"has_more":false,"next_cursor":"pending"}`), nil
	}
	c.run(t)
	var source uuid.UUID
	if err := c.admin.QueryRow(context.Background(), `SELECT id FROM app.banking_sources WHERE binding_id=$1`, c.binding).Scan(&source); err != nil {
		t.Fatal(err)
	}
	c.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,note,excluded,reviewed,activity) VALUES($1,$2,1,1,'keep owner intent',true,true,'purchase')`, source, c.owner)
	h := newBackgroundIngress(t, c)
	h.notify(t)
	c.respond = func(cursor string) (*http.Response, error) {
		if cursor == "pending" {
			return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"second-pending","account_id":"checking","amount":1.00,"iso_currency_code":"USD","date":"2026-10-01","pending":true}],"modified":[],"removed":[],"has_more":true,"next_cursor":"linked-page"}`), nil
		}
		if cursor != "linked-page" {
			t.Fatal("pending-link pagination")
		}
		return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"posted","pending_transaction_id":"pending","account_id":"checking","amount":2.70,"iso_currency_code":"USD","date":"2026-10-01","pending":false},{"transaction_id":"second-posted","pending_transaction_id":"second-pending","account_id":"checking","amount":1.00,"iso_currency_code":"USD","date":"2026-10-02","pending":false}],"modified":[],"removed":[{"transaction_id":"pending","account_id":"checking"}],"has_more":false,"next_cursor":"posted"}`), nil
	}
	c.run(t)
	if c.sources(t) != 2 || queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_source_identities WHERE binding_id=$1 AND source_id=$2 AND provider_transaction_id='posted'`, c.binding, source) != 1 {
		t.Fatal("pending link lost stable source")
	}
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND note='keep owner intent' AND excluded AND NOT reviewed AND applies_to_source_revision=2`, source) != 1 {
		t.Fatal("material posting lost annotation or preserved stale review")
	}
	h.notify(t)
	c.respond = func(string) (*http.Response, error) {
		return plaidTestResponse(200, `{"accounts":[],"added":[],"modified":[{"transaction_id":"posted","account_id":"checking","amount":-2.70,"iso_currency_code":"USD","date":"2026-10-01","pending":false}],"removed":[],"has_more":false,"next_cursor":"refund-correction"}`), nil
	}
	c.run(t)
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND note='keep owner intent' AND excluded AND NOT reviewed AND material_conflict AND applies_to_source_revision=3`, source) != 1 {
		t.Fatal("refund correction silently reused incompatible owner activity")
	}
}

func TestBackgroundConcurrentReceiptAndPublicationConverge(t *testing.T) {
	c := newInitialConsumer(t)
	c.run(t)
	h := newBackgroundIngress(t, c)
	h.notify(t)
	signature := h.signed.sign(t, h.body, h.signed.now, nil)
	event, err := h.signed.verifier.Verify(context.Background(), signature, h.body)
	if err != nil {
		t.Fatal(err)
	}
	before := backgroundVersion(t, c)
	start, results := make(chan struct{}), make(chan error, 3)
	c.respond = func(string) (*http.Response, error) {
		return plaidTestResponse(200, `{"accounts":[],"added":[],"modified":[],"removed":[],"has_more":false,"next_cursor":"concurrent"}`), nil
	}
	go func() { <-start; _, err := c.worker.ProcessOne(context.Background()); results <- err }()
	for range 2 {
		go func() { <-start; results <- c.service.AcceptWebhook(context.Background(), h.correlation, event) }()
	}
	close(start)
	for range 3 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	if backgroundVersion(t, c) != before+1 {
		t.Fatal("concurrent duplicate delivery added multiple requests")
	}
	for range 3 {
		if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='complete' AND requested_version=completed_version`, c.operation) == 1 {
			break
		}
		c.run(t)
	}
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='complete' AND requested_version=completed_version`, c.operation) != 1 {
		t.Fatal("concurrent hint lost at publication")
	}
}
