//go:build integration

package banking

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// Force the signed delivery to enter while the real consumer holds publication
// locks. Both durable watermarks and the follow-up provider cursor must converge.
func TestIndependentBackgroundDeliveryDuringAtomicPublication(t *testing.T) {
	c := newInitialConsumer(t)
	c.run(t)
	h := newBackgroundIngress(t, c)
	h.notify(t)
	claimed := backgroundVersion(t, c)
	holder, err := pgx.Connect(context.Background(), os.Getenv("TEST_DATABASE_ADMIN_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Close(context.Background())
	const gate int64 = 37620261022
	if _, err = holder.Exec(context.Background(), `SELECT pg_advisory_lock($1)`, gate); err != nil {
		t.Fatal(err)
	}
	defer holder.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, gate)
	c.exec(`CREATE FUNCTION app.tester_publication_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(37620261022); RETURN NEW; END $$`)
	c.exec(fmt.Sprintf(`CREATE TRIGGER tester_publication_gate BEFORE UPDATE OF sync_cursor ON app.banking_bindings FOR EACH ROW WHEN (NEW.id='%s'::uuid AND OLD.sync_cursor IS DISTINCT FROM NEW.sync_cursor) EXECUTE FUNCTION app.tester_publication_gate()`, c.binding))
	defer func() {
		_, _ = holder.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, gate)
		c.exec(`DROP FUNCTION app.tester_publication_gate() CASCADE`)
	}()
	c.respond = func(cursor string) (*http.Response, error) {
		if cursor != "committed" {
			return nil, fmt.Errorf("unexpected committed checkpoint")
		}
		return plaidTestResponse(200, `{"accounts":[],"added":[],"modified":[{"transaction_id":"first","account_id":"checking","amount":2.50,"iso_currency_code":"USD","date":"2024-01-01","pending":false}],"removed":[],"has_more":false,"next_cursor":"publication"}`), nil
	}
	type result struct {
		worked bool
		err    error
	}
	consumed := make(chan result, 1)
	go func() { worked, e := c.worker.ProcessOne(context.Background()); consumed <- result{worked, e} }()
	waitBlocked := func(chain bool) {
		t.Helper()
		deadline := time.Now().Add(2 * time.Second)
		for {
			var blocked bool
			if e := c.admin.QueryRow(context.Background(), `SELECT EXISTS(SELECT FROM pg_stat_activity a WHERE $1=ANY(pg_blocking_pids(a.pid)) AND (NOT $2::boolean OR EXISTS(SELECT FROM pg_stat_activity b WHERE a.pid=ANY(pg_blocking_pids(b.pid)))))`, holder.PgConn().PID(), chain).Scan(&blocked); e != nil {
				t.Fatal(e)
			}
			if blocked {
				return
			}
			if time.Now().After(deadline) {
				t.Fatal("required publication/webhook lock overlap not observed")
			}
			time.Sleep(5 * time.Millisecond)
		}
	}
	waitBlocked(false)
	signature := h.signed.sign(t, h.body, h.signed.now, nil)
	event, err := h.signed.verifier.Verify(context.Background(), signature, h.body)
	if err != nil {
		t.Fatal(err)
	}
	delivered := make(chan error, 1)
	go func() { delivered <- c.service.AcceptWebhook(context.Background(), h.correlation, event) }()
	waitBlocked(true)
	if _, err = holder.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, gate); err != nil {
		t.Fatal(err)
	}
	if r := <-consumed; r.err != nil || !r.worked {
		t.Fatal("actual publication", r.err)
	}
	if err = <-delivered; err != nil {
		t.Fatal(err)
	}
	c.exec(`DROP TRIGGER tester_publication_gate ON app.banking_bindings`)
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='pending' AND requested_version=$2 AND claimed_version=$3 AND completed_version=$3 AND attempts=0`, c.operation, claimed+1, claimed) != 1 {
		t.Fatal("delivery during publication lost durable follow-up")
	}
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_bindings WHERE id=$1 AND sync_cursor='publication'`, c.binding) != 1 {
		t.Fatal("atomic publication checkpoint missing")
	}
	c.respond = func(cursor string) (*http.Response, error) {
		if cursor != "publication" {
			return nil, fmt.Errorf("follow-up checkpoint regressed")
		}
		return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"after-publication","account_id":"checking","amount":-0.29,"iso_currency_code":"USD","date":"2026-10-02","pending":false}],"modified":[],"removed":[],"has_more":false,"next_cursor":"publication-followup"}`), nil
	}
	c.run(t)
	if len(c.requests) != 3 || c.sources(t) != 2 || queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='complete' AND requested_version=$2 AND claimed_version=$2 AND completed_version=$2`, c.operation, claimed+1) != 1 {
		t.Fatal("publication demand failed to converge exactly")
	}
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_sources s JOIN app.banking_source_revisions r ON r.source_id=s.id AND r.revision=s.revision WHERE s.binding_id=$1 AND r.amount_minor IN(250,-29)`, c.binding) != 2 {
		t.Fatal("follow-up persisted facts differ")
	}
}

func TestIndependentBackgroundHintsRespectRetryDeadline(t *testing.T) {
	c := newInitialConsumer(t)
	c.run(t)
	h := newBackgroundIngress(t, c)
	h.notify(t)
	c.respond = func(string) (*http.Response, error) {
		r := plaidTestResponse(429, `{"error_type":"RATE_LIMIT_EXCEEDED","error_code":"TRANSACTIONS_SYNC_LIMIT"}`)
		r.Header.Set("Retry-After", "180")
		return r, nil
	}
	c.run(t)
	requests := len(c.requests)
	for range 4 {
		h.notify(t)
		if err := c.db.ReconcileBanking(context.Background()); err != nil {
			t.Fatal(err)
		}
		if _, err := c.worker.ProcessOne(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if len(c.requests) != requests || queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='pending' AND attempts=1 AND due_at>clock_timestamp()+interval '175 seconds'`, c.operation) != 1 {
		t.Fatal("hint or sweep accelerated provider retry")
	}
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_bindings WHERE id=$1 AND sync_cursor='committed'`, c.binding) != 1 {
		t.Fatal("failed increment changed checkpoint")
	}
}
