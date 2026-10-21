//go:build integration

package banking

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
)

type initialConsumerFixture struct {
	enrollment *EnrollmentService
	*fixture
	db                             *database.WorkerDB
	worker                         *Worker
	connection, binding, operation uuid.UUID
	requests                       []string
	respond                        func(string) (*http.Response, error)
}

func newInitialConsumer(t *testing.T) *initialConsumerFixture {
	t.Helper()
	f, enrollment, _, _, db := enrollmentFixture(t)
	f.exec(`DELETE FROM app.banking_work`)
	f.exec(`SELECT pgmq.purge_queue('banking_lifecycle')`)
	id := startEnrollment(t, f, enrollment, f.owner, "different")
	// The authenticated owner commits explicit selection. No worker is running and
	// no request context is retained when the resulting durable operation executes.
	outcome := finishEnrollment(f, enrollment, f.owner, id, "checking")
	if outcome.Code != "AWAITING_INITIAL_IMPORT" {
		t.Fatal("enrollment handoff", outcome.Code)
	}
	c := &initialConsumerFixture{fixture: f, db: db, enrollment: enrollment, connection: outcome.ConnectionID}
	t.Cleanup(func() {
		f.exec(`DELETE FROM app.banking_sync_batches WHERE owner_id=$1`, f.owner)
		f.exec(`INSERT INTO app.banking_account_barriers(account_id,owner_id,connection_id,generation) SELECT account_id,owner_id,connection_id,1 FROM app.banking_bindings WHERE owner_id=$1 ON CONFLICT DO NOTHING`, f.owner)
		f.exec(`UPDATE app.banking_sources SET revision=NULL WHERE owner_id=$1`, f.owner)
		f.exec(`DELETE FROM app.banking_annotations WHERE owner_id=$1`, f.owner)
		f.exec(`DELETE FROM app.banking_source_revisions WHERE owner_id=$1`, f.owner)
		f.exec(`DELETE FROM app.banking_sources WHERE owner_id=$1`, f.owner)
	})
	if err := f.admin.QueryRow(context.Background(), `SELECT id FROM app.banking_bindings WHERE connection_id=$1`, c.connection).Scan(&c.binding); err != nil {
		t.Fatal(err)
	}
	if err := f.admin.QueryRow(context.Background(), `SELECT id FROM app.banking_work WHERE binding_id=$1 AND kind='initial_sync'`, c.binding).Scan(&c.operation); err != nil {
		t.Fatal("atomic initial intent missing", err)
	}
	provider := testPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
		var body struct {
			Cursor  string `json:"cursor"`
			Options struct {
				Account string `json:"account_id"`
			} `json:"options"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Fatal("request decoding")
		}
		if r.URL.Path == "/item/remove" {
			return plaidTestResponse(200, `{"request_id":"synthetic-removal-confirmed"}`), nil
		}
		if r.URL.Path == "/item/get" {
			return plaidTestResponse(200, fmt.Sprintf(`{"item":{"item_id":%q,"error":null}}`, "item-public-"+id.String())), nil
		}
		if r.URL.Path != "/transactions/sync" || body.Options.Account != "checking" {
			t.Fatal("expanded account scope")
		}
		c.requests = append(c.requests, body.Cursor)
		return c.respond(body.Cursor)
	}))
	c.worker, _ = NewWorker(db, f.service.protector, provider)
	c.respond = func(cursor string) (*http.Response, error) {
		return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"first","account_id":"checking","amount":12.34,"iso_currency_code":"USD","date":"2024-01-01","pending":false}],"modified":[],"removed":[],"has_more":false,"next_cursor":"committed"}`), nil
	}
	return c
}
func (c *initialConsumerFixture) run(t *testing.T) {
	t.Helper()
	if worked, err := c.worker.ProcessOne(context.Background()); err != nil || !worked {
		t.Fatal("actual consumer", err)
	}
}
func (c *initialConsumerFixture) sources(t *testing.T) int {
	return queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_sources WHERE binding_id=$1`, c.binding)
}

func TestInitialConsumerEnrollmentPagesAndAtomicCompletion(t *testing.T) {
	c := newInitialConsumer(t)
	c.respond = func(cursor string) (*http.Response, error) {
		if cursor == "" {
			return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"older-than-request","account_id":"checking","amount":1.25,"iso_currency_code":"USD","date":"2020-01-01","pending":false}],"modified":[],"removed":[],"has_more":true,"next_cursor":"page-one","transactions_update_status":"INITIAL_UPDATE_COMPLETE"}`), nil
		}
		if c.sources(t) != 0 {
			t.Fatal("partial page visible")
		}
		return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"second","account_id":"checking","amount":-0.29,"iso_currency_code":"USD","date":"2026-10-01","pending":false}],"modified":[],"removed":[],"has_more":false,"next_cursor":"finished","transactions_update_status":"HISTORICAL_UPDATE_COMPLETE"}`), nil
	}
	c.run(t)
	if c.sources(t) != 2 || len(c.requests) != 2 {
		t.Fatal("complete pages missing")
	}
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='complete' AND attempts=1 AND import_code='LOCAL_BATCH_COMMITTED' AND requested_days=365 AND requested_through-requested_after=365`, c.operation) != 1 {
		t.Fatal("durable completion metadata")
	}
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_bindings WHERE id=$1 AND sync_cursor='finished' AND import_state='usable' AND last_local_commit IS NOT NULL AND provider_update_status='HISTORICAL_UPDATE_COMPLETE' AND provider_success_at IS NULL AND provider_historical_update_at IS NOT NULL AND history_availability='unknown' AND coverage_after IS NULL AND coverage_through IS NULL`, c.binding) != 1 {
		t.Fatal("fabricated coverage or freshness")
	}
	// Reconciliation and lost acknowledgement/redelivery never repeat this import.
	c.fixture.exec(`SELECT pgmq.send('banking_lifecycle',jsonb_build_object('operation_id',$1::uuid,'generation',1))`, c.operation)
	if err := c.db.ReconcileBanking(context.Background()); err != nil {
		t.Fatal(err)
	}
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE binding_id=$1`, c.binding) != 1 {
		t.Fatal("duplicate logical initial operation")
	}
	if c.sources(t) != 2 {
		t.Fatal("replay changed source history")
	}
}

func TestInitialConsumerNotReadyMutationRetryAndEmpty(t *testing.T) {
	for _, mode := range []string{"not-ready", "mutation", "rate-limit", "empty"} {
		t.Run(mode, func(t *testing.T) {
			c := newInitialConsumer(t)
			c.respond = func(cursor string) (*http.Response, error) {
				switch mode {
				case "not-ready":
					return plaidTestResponse(200, `{"accounts":[],"added":[],"modified":[],"removed":[],"has_more":false,"next_cursor":""}`), nil
				case "rate-limit":
					r := plaidTestResponse(429, `{"error_type":"RATE_LIMIT_EXCEEDED","error_code":"TRANSACTIONS_SYNC_LIMIT"}`)
					r.Header.Set("Retry-After", "180")
					return r, nil
				case "mutation":
					if cursor == "" {
						return plaidTestResponse(200, `{"accounts":[],"added":[],"modified":[],"removed":[],"has_more":true,"next_cursor":"partial"}`), nil
					}
					return plaidTestResponse(400, `{"error_type":"TRANSACTIONS_ERROR","error_code":"TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"}`), nil
				default:
					return plaidTestResponse(200, `{"accounts":[],"added":[],"modified":[],"removed":[],"has_more":false,"next_cursor":"empty-complete"}`), nil
				}
			}
			c.run(t)
			if mode == "empty" {
				if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='complete'`, c.operation) != 1 || c.sources(t) != 0 {
					t.Fatal("empty import")
				}
				return
			}
			if c.sources(t) != 0 || queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_bindings WHERE id=$1 AND sync_cursor IS NULL AND last_local_commit IS NULL`, c.binding) != 1 {
				t.Fatal("failure advanced checkpoint")
			}
			if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='pending' AND due_at>clock_timestamp()+interval '59 seconds'`, c.operation) != 1 {
				t.Fatal("durable bounded retry missing")
			}
			if mode == "rate-limit" && queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND due_at>clock_timestamp()+interval '179 seconds'`, c.operation) != 1 {
				t.Fatal("provider guidance ignored")
			}
			oldRequests := len(c.requests)
			c.respond = func(cursor string) (*http.Response, error) {
				if cursor != "" {
					t.Fatal("resumed past committed checkpoint")
				}
				return plaidTestResponse(200, syncEmptyFixture), nil
			}
			releaseDue(t, c.fixture, c.operation)
			restarted, _ := NewWorker(c.db, c.service.protector, c.worker.provider)
			c.worker = restarted
			c.run(t)
			if len(c.requests) != oldRequests+1 || queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='complete' AND attempts=2`, c.operation) != 1 {
				t.Fatal("restart lost identity/budget")
			}
		})
	}
}

func TestInitialConsumerExhaustionAndPrivilegedResume(t *testing.T) {
	c := newInitialConsumer(t)
	c.respond = func(string) (*http.Response, error) {
		return plaidTestResponse(503, `{"error_type":"API_ERROR","error_code":"INTERNAL_SERVER_ERROR"}`), nil
	}
	for attempt := 1; attempt <= 10; attempt++ {
		c.run(t)
		if attempt < 10 {
			releaseDue(t, c.fixture, c.operation)
		}
	}
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='needs_attention' AND attempts=10`, c.operation) != 1 {
		t.Fatal("exhausted intent not retained")
	}
	if _, err := c.db.InitialBankingTarget(context.Background(), database.BankingWork{ID: c.operation, Token: uuid.New()}); err == nil {
		t.Fatal("unleased target exposed")
	}
	var resumed bool
	if err := c.admin.QueryRow(context.Background(), `SELECT app.banking_resume($1)`, c.operation).Scan(&resumed); err != nil || !resumed {
		t.Fatal("operator resume", err)
	}
	c.respond = func(string) (*http.Response, error) { return plaidTestResponse(200, syncEmptyFixture), nil }
	c.run(t)
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='complete' AND attempts=1`, c.operation) != 1 {
		t.Fatal("resume changed identity")
	}
}

func TestInitialConsumerLifecycleRacesRejectActualCommit(t *testing.T) {
	for _, mode := range []string{"disconnect", "delete", "disabled", "deselection", "revocation", "lease-loss"} {
		t.Run(mode, func(t *testing.T) {
			c := newInitialConsumer(t)
			sibling := c.fixture.connection(c.owner, "unrelated-sibling-"+uuid.NewString())
			_, siblingBinding := c.fixture.binding(c.owner, sibling, "sibling")
			siblingSource := c.service.RecordSource(c.actor(c.owner), sourceInput(siblingBinding))
			requireCode(t, siblingSource, "READY")
			c.respond = func(string) (*http.Response, error) {
				switch mode {
				case "disconnect":
					requireCode(t, c.service.Stop(c.actor(c.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: c.connection, ExpectedGeneration: 1}), "READY")
				case "delete":
					requireCode(t, c.service.DeleteHistory(c.actor(c.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: c.connection, ExpectedGeneration: 1}), "READY")
				case "disabled":
					c.exec(`UPDATE app.users SET enabled=false WHERE id=$1`, c.owner)
				case "deselection":
					requireCode(t, c.enrollment.ChangeSelection(c.actor(c.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: c.connection, ExpectedGeneration: 1, AccountIDs: []string{}}), "READY")
				case "revocation":
					var correlation uuid.UUID
					if err := c.admin.QueryRow(context.Background(), `SELECT id FROM app.banking_webhook_correlations WHERE connection_id=$1`, c.connection).Scan(&correlation); err != nil {
						t.Fatal(err)
					}
					event := VerifiedWebhook{Environment: "sandbox", ItemID: "item-public-" + correlation.String(), WebhookType: "ITEM", WebhookCode: "USER_PERMISSION_REVOKED", Revoked: true, BodySHA256: sha256.Sum256([]byte("verified initial import revocation")), DeliverySHA256: sha256.Sum256([]byte("signed delivery"))}
					if err := c.service.AcceptWebhook(context.Background(), correlation, event); err != nil {
						t.Fatal(err)
					}
				case "lease-loss":
					c.exec(`UPDATE app.banking_work SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`, c.operation)
				}
				return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"late","account_id":"checking","amount":9.99,"iso_currency_code":"USD","date":"2026-10-01","pending":false}],"modified":[],"removed":[],"has_more":false,"next_cursor":"stale"}`), nil
			}
			c.run(t)
			if c.sources(t) != 0 || queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_bindings WHERE id=$1 AND sync_cursor IS NULL`, c.binding) != 1 {
				t.Fatal("stale worker revived data")
			}
			if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_sources WHERE id=$1`, siblingSource.ID) != 1 || queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_credentials WHERE connection_id=$1`, sibling) != 1 {
				t.Fatal("unrelated sibling damaged")
			}
			if mode == "disconnect" || mode == "delete" || mode == "revocation" {
				for n := 0; n < 6; n++ {
					if _, err := c.worker.ProcessOne(context.Background()); err != nil {
						t.Fatal("cleanup regression", err)
					}
				}
				if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_connections WHERE id=$1 AND provider_removed`, c.connection) != 1 {
					t.Fatal("existing worker teardown did not continue")
				}
			}
		})
	}
}

// Keep the provider's common deadline contract explicit at the runtime boundary.
func TestInitialSyncFailurePolicy(t *testing.T) {
	for _, kind := range []SyncErrorKind{SyncNotReady, SyncTemporary, SyncRateLimited, SyncPaginationMutation} {
		_, delay := initialSyncFailure(&SyncError{Kind: kind, RetryAfter: 3 * time.Minute})
		if delay != 3*time.Minute {
			t.Fatal("lost provider delay")
		}
	}
}

type crashInitialProvider struct{ afterCommit bool }

func (*crashInitialProvider) Remove(context.Context, string, Credential) (RemovalResult, error) {
	return RemovalResult{Confirmed: true}, nil
}
func (p *crashInitialProvider) SyncTransactions(ctx context.Context, b SyncBinding, _ Credential, cursor SyncCursor) (SyncPage, error) {
	if cursor.Opaque() != "" {
		<-ctx.Done()
		return SyncPage{}, ctx.Err()
	}
	next, _ := NewSyncCursor(b, "staged-in-child")
	return SyncPage{Binding: b, NextCursor: next, HasMore: !p.afterCommit, Added: []SyncTransaction{{TransactionID: "child-source", AccountID: b.AccountID, AmountMinor: 125, Currency: "USD", Date: "2026-10-01"}}}, nil
}

func TestInitialConsumerCrashHelper(t *testing.T) {
	mode := os.Getenv("KAMI_INITIAL_CRASH_HELPER")
	if mode == "" {
		t.Skip("child process only")
	}
	db, err := database.OpenWorker(context.Background(), database.Config{URL: os.Getenv("TEST_WORKER_DATABASE_URL"), MaxConns: 2, Timeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	key := make([]byte, 32)
	for i := range key {
		key[i] = 1
	}
	protector, _ := NewProtector("one", map[string][]byte{"one": key})
	worker, _ := NewWorker(db, protector, &crashInitialProvider{afterCommit: mode == "committed"})
	if _, err := worker.ProcessOne(context.Background()); err != nil {
		t.Fatal(err)
	}
	// Commit and queue acknowledgement share one transaction; there is no unsafe
	// process pause between them. Kill after its durable completion is observable.
	select {}
}

func TestInitialConsumerProcessKillAndRestart(t *testing.T) {
	for _, mode := range []string{"staging", "committed"} {
		t.Run(mode, func(t *testing.T) {
			c := newInitialConsumer(t)
			command := exec.Command(os.Args[0], "-test.run=^TestInitialConsumerCrashHelper$")
			command.Env = append(os.Environ(), "KAMI_INITIAL_CRASH_HELPER="+mode)
			command.Stdout = io.Discard
			command.Stderr = io.Discard
			if err := command.Start(); err != nil {
				t.Fatal(err)
			}
			killed := false
			defer func() {
				if !killed {
					_ = command.Process.Kill()
					_ = command.Wait()
				}
			}()
			observed := false
			deadline := time.Now().Add(10 * time.Second)
			for time.Now().Before(deadline) {
				sql := `SELECT count(*) FROM app.banking_sync_batches WHERE work_id=$1 AND state='staging' AND page_count=1`
				if mode == "committed" {
					sql = `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='complete' AND import_code='LOCAL_BATCH_COMMITTED'`
				}
				if queryInt(t, c.fixture, sql, c.operation) == 1 {
					observed = true
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if !observed {
				t.Fatal("child durable pause not observed")
			}
			if err := command.Process.Kill(); err != nil {
				t.Fatal(err)
			}
			_ = command.Wait()
			killed = true
			if mode == "staging" {
				if c.sources(t) != 0 {
					t.Fatal("crashed partial batch visible")
				}
				releaseDue(t, c.fixture, c.operation)
				c.run(t)
				if len(c.requests) != 1 || c.requests[0] != "" || c.sources(t) != 1 {
					t.Fatal("restart failed original checkpoint")
				}
			} else {
				if worked, err := c.worker.ProcessOne(context.Background()); err != nil || worked {
					t.Fatal("completed intent replayed", err)
				}
				if c.sources(t) != 1 || len(c.requests) != 0 {
					t.Fatal("lost ack duplicated import")
				}
			}
		})
	}
}

func TestInitialConsumerRenewsDuringProviderWork(t *testing.T) {
	c := newInitialConsumer(t)
	entered := make(chan struct{})
	release := make(chan struct{})
	c.respond = func(string) (*http.Response, error) {
		close(entered)
		<-release
		return plaidTestResponse(200, syncEmptyFixture), nil
	}
	// Two bounded provider calls normally cannot exceed the 45-second renewal
	// interval, so occupy the real consumer after several pages instead. A slow
	// test provider here waits under the caller's real renewable work context.
	provider := &renewInitialProvider{entered: entered, release: release}
	c.worker, _ = NewWorker(c.db, c.service.protector, provider)
	done := make(chan error, 1)
	go func() { _, err := c.worker.ProcessOne(context.Background()); done <- err }()
	<-entered
	var original time.Time
	if err := c.admin.QueryRow(context.Background(), `SELECT lease_until FROM app.banking_work WHERE id=$1`, c.operation).Scan(&original); err != nil {
		t.Fatal(err)
	}
	renewed := false
	deadline := time.Now().Add(52 * time.Second)
	for time.Now().Before(deadline) {
		if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND lease_until>$2`, c.operation, original) == 1 {
			renewed = true
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if !renewed || queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='complete'`, c.operation) != 1 {
		t.Fatal("actual consumer failed lease renewal")
	}
}

type renewInitialProvider struct{ entered, release chan struct{} }

func (*renewInitialProvider) Remove(context.Context, string, Credential) (RemovalResult, error) {
	return RemovalResult{Confirmed: true}, nil
}
func (p *renewInitialProvider) SyncTransactions(ctx context.Context, b SyncBinding, _ Credential, cursor SyncCursor) (SyncPage, error) {
	// Each call remains inside the worker's 30-second provider timeout. Two pages
	// together cross its actual 45-second lease-renewal ticker.
	if cursor.Opaque() == "" {
		select {
		case <-time.After(24 * time.Second):
		case <-ctx.Done():
			return SyncPage{}, ctx.Err()
		}
	}
	if cursor.Opaque() != "" {
		close(p.entered)
		select {
		case <-p.release:
		case <-ctx.Done():
			return SyncPage{}, ctx.Err()
		}
	}
	next, _ := NewSyncCursor(b, "renewed-final")
	return SyncPage{Binding: b, NextCursor: next, HasMore: cursor.Opaque() == ""}, nil
}

func TestInitialConsumerRecoversLegacyAndNewSelection(t *testing.T) {
	c := newInitialConsumer(t)
	c.exec(`SELECT pgmq.delete('banking_lifecycle',message_id) FROM app.banking_work WHERE id=$1`, c.operation)
	c.exec(`DELETE FROM app.banking_work WHERE id=$1`, c.operation)
	if err := c.db.ReconcileBanking(context.Background()); err != nil {
		t.Fatal(err)
	}
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE binding_id=$1 AND kind='initial_sync'`, c.binding) != 1 {
		t.Fatal("legacy binding not recovered")
	}
	requireCode(t, c.enrollment.ChangeSelection(c.actor(c.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: c.connection, ExpectedGeneration: 1, AccountIDs: []string{"checking", "savings"}}), "READY")
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE connection_id=$1 AND kind='initial_sync' AND generation=2`, c.connection) != 2 {
		t.Fatal("selected accounts lack independent intent")
	}
}

func TestInitialConsumerCompetingWorkersAndLostLease(t *testing.T) {
	c := newInitialConsumer(t)
	competitor, _ := NewWorker(c.db, c.service.protector, &crashInitialProvider{afterCommit: true})
	c.respond = func(string) (*http.Response, error) {
		if worked, err := competitor.ProcessOne(context.Background()); err != nil || worked {
			t.Fatal("second worker acquired live lease", err)
		}
		// Crash/visibility recovery replaces the random token. The former consumer
		// still holds an in-flight response, but cannot publish it after the winner.
		releaseDue(t, c.fixture, c.operation)
		if worked, err := competitor.ProcessOne(context.Background()); err != nil || !worked {
			t.Fatal("second worker failed expired lease recovery", err)
		}
		return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"stale-loser","account_id":"checking","amount":9.99,"iso_currency_code":"USD","date":"2026-10-01","pending":false}],"modified":[],"removed":[],"has_more":false,"next_cursor":"loser"}`), nil
	}
	c.run(t)
	if c.sources(t) != 1 || queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_sources WHERE binding_id=$1 AND provider_transaction_id='child-source'`, c.binding) != 1 {
		t.Fatal("competing workers duplicated or overwrote history")
	}
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='complete' AND attempts=2`, c.operation) != 1 {
		t.Fatal("lease recovery budget/identity lost")
	}
}
