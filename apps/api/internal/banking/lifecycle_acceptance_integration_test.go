//go:build integration

package banking

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestIndependentSignedDeliveryConcurrencyAndOutOfOrderRevocation(t *testing.T) {
	f, service, _, worker, _ := lifecycleFixture(t)
	enrollment, connection := lifecycleReady(t, f, service, f.owner, "checking", "savings")
	source := lifecycleHistory(t, f, connection)
	body, _ := json.Marshal(map[string]string{"environment": "sandbox", "item_id": "item-public-" + enrollment.String(), "webhook_type": "ITEM", "webhook_code": "USER_ACCOUNT_REVOKED", "account_id": "savings"})
	signed := newWebhookFixture(t)
	event, err := signed.verifier.Verify(context.Background(), signed.sign(t, body, signed.now, nil), body)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	start, results := make(chan struct{}), make(chan error, 2)
	for range 2 {
		go func() { <-start; results <- f.service.AcceptWebhook(ctx, enrollment, event) }()
	}
	close(start)
	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	if lifecycleGeneration(t, f, connection) != 2 || queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_deliveries WHERE correlation_id=$1`, enrollment) != 1 {
		t.Fatal("concurrent identical deliveries repeated authority reduction")
	}
	reauthorize := func(generation int64) {
		requireCode(t, service.ChangeSelection(f.actor(f.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: generation, AccountIDs: []string{"checking", "savings"}}), "READY")
	}
	reauthorize(2)
	// Both signatures remain fresh. Receiving the later-issued one first must
	// not turn signature time into authority to discard the earlier valid one.
	olderTime := signed.now.Add(time.Minute)
	newerTime := signed.now.Add(2 * time.Minute)
	older := signed.sign(t, body, olderTime, nil)
	newer := signed.sign(t, body, newerTime, nil)
	signed.now = newerTime
	for i, signature := range []string{newer, older} {
		event, err := signed.verifier.Verify(ctx, signature, body)
		if err != nil {
			t.Fatal(err)
		}
		if err := f.service.AcceptWebhook(ctx, enrollment, event); err != nil {
			t.Fatal(err)
		}
		if lifecycleGeneration(t, f, connection) != int64(4+2*i) || queryInt(t, f, `SELECT count(*) FROM app.banking_bindings b JOIN app.banking_accounts a ON a.id=b.account_id WHERE b.connection_id=$1 AND b.provider_account_id='savings' AND a.selected`, connection) != 0 {
			t.Fatal("valid out-of-order revocation did not fence current authority")
		}
		if i == 0 {
			reauthorize(4)
		}
	}
	_, status := f.service.ReadSource(f.actor(f.owner), source)
	requireCode(t, status, "READY")
	if queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_deliveries WHERE correlation_id=$1`, enrollment) != 3 || queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_receipts WHERE correlation_id=$1`, enrollment) != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1`, source) != 1 {
		t.Fatal("delivery identity or retained annotation changed")
	}
	otherEnrollment, otherConnection := lifecycleReady(t, f, service, f.other, "checking")
	if status := lifecycleEvent(t, f, otherEnrollment, "item-public-"+otherEnrollment.String(), "USER_ACCOUNT_REVOKED", "savings", ""); status != 204 {
		t.Fatal(status)
	}
	requireCode(t, f.service.DeleteHistory(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 6}), "READY")
	for range 10 {
		if _, err := worker.ProcessOne(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_deliveries WHERE correlation_id=$1`, enrollment) != 0 || queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_deliveries WHERE correlation_id=$1`, otherEnrollment) != 1 {
		t.Fatal("purge failed to isolate owners' delivery fingerprints")
	}
	other, status := f.service.ReadLifecycle(f.actor(f.other), otherConnection)
	requireCode(t, status, "READY")
	if other.State != "active" || other.Generation != 2 {
		t.Fatal("purge changed unrelated holder lifecycle")
	}
}

func TestIndependentLifecycleConcurrentSelectionsRecoverAfterRestart(t *testing.T) {
	f, service, provider, _, _ := lifecycleFixture(t)
	_, connection := lifecycleReady(t, f, service, f.owner, "checking", "savings")
	source := lifecycleHistory(t, f, connection)
	ctx := f.actor(f.owner)
	type outcome struct {
		input  SelectionInput
		result Result
	}
	start := make(chan struct{})
	results := make(chan outcome, 2)
	for _, account := range []string{"checking", "savings"} {
		input := SelectionInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1, AccountIDs: []string{account}}
		go func() {
			<-start
			results <- outcome{input, service.ChangeSelection(ctx, input)}
		}()
	}
	close(start)
	observed := []outcome{<-results, <-results}
	codes := map[string]int{}
	var winner string
	for _, result := range observed {
		codes[result.result.Code]++
		if result.result.Code == "READY" {
			winner = result.input.AccountIDs[0]
		}
	}
	if codes["READY"] != 1 || codes["CONFLICT"] != 1 || lifecycleGeneration(t, f, connection) != 2 {
		t.Fatal("competing subsets did not have exactly one committed winner", codes)
	}
	var selected string
	if err := f.admin.QueryRow(context.Background(), `SELECT string_agg(b.provider_account_id,',' ORDER BY b.provider_account_id) FROM app.banking_bindings b JOIN app.banking_accounts a ON a.id=b.account_id WHERE b.connection_id=$1 AND a.selected`, connection).Scan(&selected); err != nil || selected != winner {
		t.Fatal("accepted subset differs from persisted selection", err)
	}
	// A new application instance must recover both original outcomes despite an
	// unavailable provider; neither retry may apply its subset to generation 2.
	storage, err := New(f.db, f.service.protector)
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := NewEnrollment(storage, provider, service.config)
	if err != nil {
		t.Fatal(err)
	}
	provider.failAccounts = true
	for _, original := range observed {
		if result := restarted.ChangeSelection(ctx, original.input); result != original.result {
			t.Fatal("restart changed original selection receipt", result.Code, original.result.Code)
		}
		requireCode(t, storage.OperationStatus(f.actor(f.other), original.input.AttemptID), "NOT_FOUND")
	}
	if lifecycleGeneration(t, f, connection) != 2 {
		t.Fatal("replay changed the lifecycle revision")
	}
	_, status := storage.ReadSource(ctx, source)
	requireCode(t, status, "READY")
	if queryInt(t, f, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND note='private annotation'`, source) != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE connection_id=$1 AND kind='teardown'`, connection) != 0 {
		t.Fatal("selection race changed history or removed the sibling Item")
	}
}

func TestIndependentRevocationObservationRejectsLostAuthority(t *testing.T) {
	for _, mode := range []string{"expired_lease", "wrong_token", "selection_changed", "deleted"} {
		t.Run(mode, func(t *testing.T) {
			f, service, _, _, db := lifecycleFixture(t)
			_, connection := lifecycleReady(t, f, service, f.owner, "checking", "savings")
			source := lifecycleHistory(t, f, connection)
			f.exec(`SELECT app.banking_enqueue($1,1,'reconcile')`, connection)
			job := requireWork(t, db)
			if job.ConnectionID != connection || job.Kind != "reconcile" {
				t.Fatal("unexpected observation claim")
			}
			switch mode {
			case "expired_lease":
				f.exec(`UPDATE app.banking_work SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`, job.ID)
			case "wrong_token":
				job.Token = uuid.New()
			case "selection_changed":
				requireCode(t, service.ChangeSelection(f.actor(f.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1, AccountIDs: []string{"savings"}}), "READY")
			case "deleted":
				requireCode(t, f.service.DeleteHistory(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}), "READY")
			}
			before, status := f.service.ReadLifecycle(f.actor(f.owner), connection)
			requireCode(t, status, "READY")
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if accepted, err := db.RecordBankingObservation(ctx, job, false, true); err != nil || accepted {
				t.Fatal("revocation observation crossed a lost lease/generation", accepted, err)
			}
			after, status := f.service.ReadLifecycle(f.actor(f.owner), connection)
			requireCode(t, status, "READY")
			if before != after {
				t.Fatal("stale observation changed owner-visible lifecycle")
			}
			_, status = f.service.ReadSource(f.actor(f.owner), source)
			if mode == "deleted" {
				requireCode(t, status, "NOT_FOUND")
			} else {
				requireCode(t, status, "READY")
			}
			if queryInt(t, f, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1`, source) != 1 {
				t.Fatal("observation changed retained payload before purge")
			}
		})
	}
}
