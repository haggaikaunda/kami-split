//go:build integration

package banking

import (
	"context"
	"net/http"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestInitialConsumerMutationDiscardsFactBearingSequence(t *testing.T) {
	c := newInitialConsumer(t)
	c.respond = func(cursor string) (*http.Response, error) {
		switch cursor {
		case "":
			return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"discarded-first","account_id":"checking","amount":12.34,"iso_currency_code":"USD","date":"2020-01-01","pending":true}],"modified":[],"removed":[],"has_more":true,"next_cursor":"first"}`), nil
		case "first":
			return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"discarded-second","account_id":"checking","amount":-4.56,"iso_currency_code":"USD","date":"2026-10-01","pending":false}],"modified":[],"removed":[],"has_more":true,"next_cursor":"second"}`), nil
		case "second":
			if c.sources(t) != 0 || queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_sync_pages p JOIN app.banking_sync_batches b ON b.id=p.batch_id WHERE b.work_id=$1`, c.operation) != 2 {
				t.Fatal("fact-bearing pages not staged privately before mutation")
			}
			return plaidTestResponse(400, `{"error_type":"TRANSACTIONS_ERROR","error_code":"TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"}`), nil
		default:
			t.Fatal("unexpected cursor")
			return nil, nil
		}
	}
	c.run(t)
	if c.sources(t) != 0 || queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_bindings WHERE id=$1 AND sync_cursor IS NULL AND last_local_commit IS NULL`, c.binding) != 1 {
		t.Fatal("mutation published partial facts or checkpoint")
	}
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_sync_pages p JOIN app.banking_sync_batches b ON b.id=p.batch_id WHERE b.work_id=$1`, c.operation) != 0 || queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='pending' AND import_code='PAGINATION_RESTART'`, c.operation) != 1 {
		t.Fatal("mutated staging or retry outcome retained incorrectly")
	}
	c.respond = func(cursor string) (*http.Response, error) {
		if cursor != "" {
			t.Fatal("mutation restarted ahead of committed cursor")
		}
		return plaidTestResponse(200, `{"accounts":[],"added":[{"transaction_id":"accepted-after-restart","account_id":"checking","amount":0.29,"iso_currency_code":"USD","date":"2026-10-02","pending":false}],"modified":[],"removed":[],"has_more":false,"next_cursor":"accepted"}`), nil
	}
	releaseDue(t, c.fixture, c.operation)
	c.run(t)
	if len(c.requests) != 4 || c.requests[0] != "" || c.requests[1] != "first" || c.requests[2] != "second" || c.requests[3] != "" || c.sources(t) != 1 {
		t.Fatal("restart did not replace the whole discarded sequence")
	}
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_sources s JOIN app.banking_source_revisions r ON r.source_id=s.id AND r.revision=s.revision WHERE s.binding_id=$1 AND s.provider_transaction_id='accepted-after-restart' AND r.amount_minor=29`, c.binding) != 1 {
		t.Fatal("restarted source history contains the wrong facts")
	}
}

func TestInitialConsumerHandoffRollbackLeavesNoExecutableOrphan(t *testing.T) {
	c := newInitialConsumer(t)
	c.exec(`SELECT pgmq.delete('banking_lifecycle',message_id) FROM app.banking_work WHERE id=$1`, c.operation)
	c.exec(`DELETE FROM app.banking_work WHERE id=$1`, c.operation)
	tx, err := c.admin.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), `UPDATE app.banking_connections SET permission_state='granted' WHERE id=$1`, c.connection); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(context.Background(), `SET CONSTRAINTS ALL IMMEDIATE`); err != nil {
		t.Fatal(err)
	}
	var inside int
	if err = tx.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_work w JOIN pgmq.q_banking_lifecycle q ON q.msg_id=w.message_id WHERE w.binding_id=$1`, c.binding).Scan(&inside); err != nil || inside != 1 {
		t.Fatal("transactional handoff not created", err)
	}
	if err = tx.Rollback(context.Background()); err != nil {
		t.Fatal(err)
	}
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE binding_id=$1`, c.binding) != 0 || queryInt(t, c.fixture, `SELECT count(*) FROM pgmq.q_banking_lifecycle`) != 0 {
		t.Fatal("rolled-back handoff left executable work")
	}
	if worked, err := c.worker.ProcessOne(context.Background()); err != nil || worked || len(c.requests) != 0 {
		t.Fatal("consumer imported rolled-back intent", err)
	}
}

func TestInitialConsumerEnrollmentDenialsNeverSchedule(t *testing.T) {
	for _, mode := range []string{"foreign-owner", "cancelled", "unknown-exchange", "unsupported", "foreign-currency"} {
		t.Run(mode, func(t *testing.T) {
			f, s, p, _, _ := enrollmentFixture(t)
			id := startEnrollment(t, f, s, f.owner, "different")
			owner, account := f.owner, "checking"
			switch mode {
			case "foreign-owner":
				owner = f.other
			case "cancelled":
				if o := s.Cancel(f.actor(f.owner), id); o.State == "ready" {
					t.Fatal("cancellation unexpectedly activated")
				}
			case "unknown-exchange":
				p.loseExchange = true
			case "unsupported":
				account = "unsupported"
			case "foreign-currency":
				account = "foreign"
			}
			if o := finishEnrollment(f, s, owner, id, account); o.Code == "AWAITING_INITIAL_IMPORT" {
				t.Fatal("ineligible enrollment activated")
			}
			if queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE kind='initial_sync'`) != 0 || queryInt(t, f, `SELECT count(*) FROM app.banking_bindings WHERE owner_id=$1`, f.owner) != 0 {
				t.Fatal("denied enrollment scheduled collection")
			}
		})
	}
}

func TestInitialConsumerDuplicateCompletionAndTransportAreInert(t *testing.T) {
	c := newInitialConsumer(t)
	var attempt uuid.UUID
	if err := c.admin.QueryRow(context.Background(), `SELECT id FROM app.banking_enrollments WHERE connection_id=$1`, c.connection).Scan(&attempt); err != nil {
		t.Fatal(err)
	}
	if o := finishEnrollment(c.fixture, c.enrollment, c.owner, attempt, "checking"); o.Code != "AWAITING_INITIAL_IMPORT" {
		t.Fatal("same-input enrollment replay", o.Code)
	}
	c.run(t)
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE binding_id=$1`, c.binding) != 1 {
		t.Fatal("completion replay duplicated operation")
	}
	c.exec(`SELECT pgmq.send('banking_lifecycle',jsonb_build_object('operation_id',$1::uuid,'generation',1))`, c.operation)
	if worked, err := c.worker.ProcessOne(context.Background()); err != nil || worked {
		t.Fatal("completed redelivery executed", err)
	}
	if len(c.requests) != 1 || c.sources(t) != 1 || queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_source_revisions r JOIN app.banking_sources s ON s.id=r.source_id WHERE s.binding_id=$1`, c.binding) != 1 {
		t.Fatal("redelivery duplicated provider work or source revision")
	}
}

func TestInitialConsumerResumeRequiresOperatorAndCurrentLifecycle(t *testing.T) {
	c := newInitialConsumer(t)
	c.respond = func(string) (*http.Response, error) {
		return plaidTestResponse(400, `{"error_type":"ITEM_ERROR","error_code":"ITEM_LOGIN_REQUIRED"}`), nil
	}
	c.run(t)
	if queryInt(t, c.fixture, `SELECT count(*) FROM app.banking_work WHERE id=$1 AND state='needs_attention' AND import_code='REPAIR_REQUIRED'`, c.operation) != 1 {
		t.Fatal("repair intent not retained")
	}
	workerLogin, err := pgx.Connect(context.Background(), os.Getenv("TEST_WORKER_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer workerLogin.Close(context.Background())
	if _, err := workerLogin.Exec(context.Background(), `SELECT app.banking_resume($1)`, c.operation); err == nil {
		t.Fatal("worker resumed its own exhausted work")
	}
	requireCode(t, c.service.Stop(c.actor(c.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: c.connection, ExpectedGeneration: 1}), "READY")
	var resumed bool
	if err := c.admin.QueryRow(context.Background(), `SELECT app.banking_resume($1)`, c.operation).Scan(&resumed); err != nil || resumed {
		t.Fatal("operator resume restored stopped authority", err)
	}
}
