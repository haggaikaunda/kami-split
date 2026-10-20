//go:build integration

package graph_test

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/banking"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
)

func (*bankingHTTPProvider) PrepareRepair(_ context.Context, _, _ string, _ banking.Credential) (banking.LinkPreparation, error) {
	return banking.LinkPreparation{LinkToken: "link-private-repair", ExpiresAt: time.Now().Add(30 * time.Minute)}, nil
}
func (p *bankingHTTPProvider) Remove(_ context.Context, _ string, token banking.Credential) (banking.RemovalResult, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.failRemoval {
		return banking.RemovalResult{RetryAfter: time.Minute}, &banking.RemovalError{Uncertain: true, Retryable: true}
	}
	// The controlled provider confirms only this exact credential's Item.
	for id := range p.items {
		if string(token.Bytes()) == "access-private-"+id {
			delete(p.items, id)
			return banking.RemovalResult{Confirmed: true}, nil
		}
	}
	return banking.RemovalResult{Confirmed: true}, nil
}
func (*bankingHTTPProvider) Observe(_ context.Context, _ string, _ banking.Credential) (banking.Observation, error) {
	return banking.Observation{Healthy: true}, nil
}

func lifecycleHTTPFence(field string, attempt, connection uuid.UUID, generation int64) string {
	return fmt.Sprintf(`mutation{%s(input:{attemptId:%q,connectionId:%q,expectedGeneration:%q}){code}}`, field, attempt.String(), connection.String(), fmt.Sprint(generation))
}
func lifecycleHTTPRead(connection uuid.UUID) string {
	return fmt.Sprintf(`query{bankingConnection(connectionId:%q){code connection{id state generation health cleanup purge accounts{id streamId selected kind}}}}`, connection.String())
}
func lifecycleHTTPSelection(attempt, connection uuid.UUID, generation int64, ids string) string {
	return fmt.Sprintf(`mutation{changeBankingSelection(input:{attemptId:%q,connectionId:%q,expectedGeneration:%q,accountIds:[%s]}){code}}`, attempt.String(), connection.String(), fmt.Sprint(generation), ids)
}
func lifecycleHTTPSeed(t *testing.T, f *bankingHTTPFixture, connection uuid.UUID) (uuid.UUID, uuid.UUID) {
	t.Helper()
	var binding, account uuid.UUID
	if err := f.admin.QueryRow(context.Background(), `SELECT b.id,b.account_id FROM app.banking_bindings b WHERE connection_id=$1 AND provider_account_id='selected-checking'`, connection).Scan(&binding, &account); err != nil {
		t.Fatal(err)
	}
	source := uuid.New()
	plan := uuid.New()
	archive := uuid.New()
	batch := uuid.New()
	f.exec(`WITH source AS(INSERT INTO app.banking_sources(id,owner_id,binding_id,provider_transaction_id,revision) VALUES($1,$2,$3,'private-source',1) RETURNING id) INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,amount_minor,currency,bank_date,processing_state,mapping_version,stage) SELECT id,$2,1,1250,'USD','2026-09-30','posted','pfc-v2','current' FROM source`, source, f.owner, binding)
	f.exec(`INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,amount_minor,currency,bank_date,processing_state,mapping_version,stage,batch_id) SELECT $1,$2,n,1250,'USD','2026-09-30','posted','pfc-v2','staged',$3 FROM generate_series(2,205) n`, source, f.owner, batch)
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,note) VALUES($1,$2,1,1,'retained private annotation'),($1,$2,2,1,'latest private annotation')`, source, f.owner)
	f.exec(`INSERT INTO app.banking_plans(id,owner_id,account_id,revision) VALUES($1,$2,$3,1)`, plan, f.owner, account)
	f.exec(`INSERT INTO app.banking_plan_intervals(plan_id,owner_id,binding_id) VALUES($1,$2,$3)`, plan, f.owner, binding)
	f.exec(`INSERT INTO app.banking_plan_sources(plan_id,owner_id,source_id,source_revision) VALUES($1,$2,$3,1)`, plan, f.owner, source)
	f.exec(`INSERT INTO app.banking_archives(id,owner_id,plan_id,boundary_date) VALUES($1,$2,$3,'2026-09-30')`, archive, f.owner, plan)
	f.exec(`INSERT INTO app.banking_captures(archive_id,owner_id,source_id,source_revision,annotation_revision) VALUES($1,$2,$3,1,2)`, archive, f.owner, source)
	return source, binding
}
func TestBankingHTTPLifecycleRetainedHistoryAndRestartableDeletion(t *testing.T) {
	f := newBankingHTTPFixture(t)
	handler := f.handler(true)
	owner, other, disabled := f.token(f.owner), f.token(f.other), f.token(f.disabled)
	zoneFields := `{__typename ... on ReportingTimezone{timezone version} ... on ReportingTimezoneProblem{code}}`
	for token, zone := range map[string]string{owner: "America/Los_Angeles", other: "Asia/Tokyo"} {
		query := fmt.Sprintf(`mutation{initializeReportingTimezone(attemptId:%q,deviceTimezone:%q)%s}`, uuid.NewString(), zone, zoneFields)
		result := f.operation(handler, query, token, "initializeReportingTimezone", false)
		if result["timezone"] != zone || result["version"] != "1" {
			t.Fatal("timezone scalar/initialization changed during merged lifecycle setup")
		}
	}
	// Cleanup only this fixture's private rows; ordinary shared records remain for
	// the repository's later dump/restore regression checks.
	t.Cleanup(func() {
		f.exec(`INSERT INTO app.banking_account_barriers(account_id,owner_id,connection_id,generation) SELECT DISTINCT ON(b.account_id) b.account_id,b.owner_id,b.connection_id,1 FROM app.banking_bindings b WHERE b.owner_id IN($1,$2,$3) ON CONFLICT DO NOTHING`, f.owner, f.other, f.disabled)
		for _, table := range []string{"captures", "archives", "plan_sources", "plan_intervals", "plans", "annotations", "source_revisions", "sources", "repairs"} {
			if table == "source_revisions" {
				f.exec(`UPDATE app.banking_sources SET revision=NULL WHERE owner_id IN($1,$2,$3)`, f.owner, f.other, f.disabled)
			}
			f.exec(`DELETE FROM app.banking_`+table+` WHERE owner_id IN($1,$2,$3)`, f.owner, f.other, f.disabled)
		}
	})
	enroll := uuid.New()
	f.operation(handler, bankingHTTPStart(enroll, "DIFFERENT"), owner, "startBankingEnrollment", true)
	finish := fmt.Sprintf(`mutation{finishBankingEnrollment(input:{attemptId:%q,publicToken:%q,accountIds:["selected-checking","unselected-savings"]})%s}`, enroll.String(), "public-private-"+enroll.String(), bankingHTTPSelection)
	result := f.operation(handler, finish, owner, "finishBankingEnrollment", false)
	if result["code"] != "AWAITING_INITIAL_IMPORT" {
		t.Fatal(result["code"])
	}
	connection := uuid.MustParse(result["connectionId"].(string))
	source, binding := lifecycleHTTPSeed(t, f, connection)
	joint := uuid.New()
	f.operation(handler, bankingHTTPStart(joint, "DIFFERENT"), other, "startBankingEnrollment", true)
	jointResult := f.operation(handler, bankingHTTPFinish(joint, "selected-checking"), other, "finishBankingEnrollment", false)
	if jointResult["code"] != "AWAITING_INITIAL_IMPORT" {
		t.Fatal(jointResult["code"])
	}
	sharedBefore := lifecycleHTTPSharedSnapshot(t, f)
	selectionID, repairID := uuid.New(), uuid.New()
	operations := []struct{ field, query string }{
		{"changeBankingSelection", lifecycleHTTPSelection(selectionID, connection, 1, `"unselected-savings"`)},
		{"startBankingRepair", lifecycleHTTPFence("startBankingRepair", repairID, connection, 1)},
		{"finishBankingRepair", fmt.Sprintf(`mutation{finishBankingRepair(input:{attemptId:%q,accountIds:["selected-checking"]})%s}`, repairID.String(), bankingHTTPSelection)},
		{"disconnectBanking", lifecycleHTTPFence("disconnectBanking", uuid.New(), connection, 1)},
		{"deleteBankingHistory", lifecycleHTTPFence("deleteBankingHistory", uuid.New(), connection, 1)},
		{"bankingRepair", fmt.Sprintf(`query{bankingRepair(attemptId:%q)%s}`, repairID.String(), bankingHTTPSelection)},
		{"bankingOperation", fmt.Sprintf(`query{bankingOperation(attemptId:%q){code}}`, selectionID.String())},
	}
	for _, op := range operations {
		envelope := f.post(handler, op.query, "", false)
		if envelope["errors"] == nil {
			t.Fatal("missing authentication on", op.field)
		}
		if got := f.operation(handler, op.query, disabled, op.field, false); got["code"] != "FORBIDDEN" {
			t.Fatal("disabled actor", op.field, got["code"])
		}
		if got := f.operation(handler, op.query, other, op.field, false); got["code"] != "NOT_FOUND" {
			t.Fatal("other owner", op.field, got["code"])
		}
	}
	if result := f.operation(handler, operations[0].query, owner, "changeBankingSelection", false); result["code"] != "READY" {
		t.Fatal(result["code"])
	}
	if result := f.operation(handler, operations[0].query, owner, "changeBankingSelection", false); result["code"] != "READY" {
		t.Fatal("selection replay")
	}
	projection := f.operation(handler, lifecycleHTTPRead(connection), owner, "bankingConnection", false)["connection"].(map[string]any)
	if projection["generation"] != "2" || len(projection["accounts"].([]any)) != 2 {
		t.Fatal("deselection erased retained account")
	}
	if query := lifecycleHTTPSelection(selectionID, connection, 1, `"selected-checking"`); f.operation(handler, query, owner, "changeBankingSelection", false)["code"] != "CONFLICT" {
		t.Fatal("changed-input replay")
	}
	repairStart := lifecycleHTTPFence("startBankingRepair", repairID, connection, 2)
	if got := f.operation(f.handler(false), repairStart, owner, "startBankingRepair", true); got["code"] != "PREPARED" {
		t.Fatal(got["code"])
	}
	repairFinish := fmt.Sprintf(`mutation{finishBankingRepair(input:{attemptId:%q,accountIds:["selected-checking","unselected-savings"]})%s}`, repairID.String(), bankingHTTPSelection)
	if got := f.operation(f.handler(false), repairFinish, owner, "finishBankingRepair", false); got["code"] != "READY" {
		t.Fatal(got["code"])
	}
	var sameSource, sameBinding uuid.UUID
	var annotation string
	if err := f.admin.QueryRow(context.Background(), `SELECT s.id,s.binding_id,a.note FROM app.banking_sources s JOIN app.banking_annotations a ON a.source_id=s.id AND a.revision=2 WHERE s.id=$1`, source).Scan(&sameSource, &sameBinding, &annotation); err != nil || sameBinding != binding || sameSource != source || annotation != "latest private annotation" {
		t.Fatal("repair changed retained provenance", err)
	}
	workerDB, err := database.OpenWorker(context.Background(), database.Config{URL: os.Getenv("TEST_WORKER_DATABASE_URL"), MaxConns: 3, Timeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(workerDB.Close)
	protector, _ := banking.NewProtector("http", map[string][]byte{"http": bytes.Repeat([]byte{87}, 32)})
	worker, err := banking.NewWorker(workerDB, protector, f.provider)
	if err != nil {
		t.Fatal(err)
	}
	stopID := uuid.New()
	stop := lifecycleHTTPFence("disconnectBanking", stopID, connection, 3)
	if got := f.operation(handler, stop, owner, "disconnectBanking", false); got["code"] != "READY" {
		t.Fatal(got["code"])
	}
	projection = f.operation(handler, lifecycleHTTPRead(connection), owner, "bankingConnection", false)["connection"].(map[string]any)
	if projection["state"] != "stopped" || projection["cleanup"] != "pending" {
		t.Fatal("false remote success", projection)
	}
	if got := f.operation(handler, stop, owner, "disconnectBanking", false); got["code"] != "READY" {
		t.Fatal("disconnect replay")
	}
	f.provider.mu.Lock()
	f.provider.failRemoval = true
	f.provider.mu.Unlock()
	for range 12 {
		if _, err := worker.ProcessOne(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	projection = f.operation(handler, lifecycleHTTPRead(connection), owner, "bankingConnection", false)["connection"].(map[string]any)
	if projection["cleanup"] != "pending" {
		t.Fatal("provider outage fabricated removal", projection)
	}
	var retained int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1`, source).Scan(&retained); err != nil || retained != 2 {
		t.Fatal("disconnect/outage lost history", err)
	}
	f.provider.mu.Lock()
	f.provider.failRemoval = false
	f.provider.mu.Unlock()
	deleteID := uuid.New()
	if got := f.operation(handler, lifecycleHTTPFence("deleteBankingHistory", deleteID, connection, 4), owner, "deleteBankingHistory", false); got["code"] != "READY" {
		t.Fatal(got["code"])
	}
	projection = f.operation(handler, lifecycleHTTPRead(connection), owner, "bankingConnection", false)["connection"].(map[string]any)
	if projection["state"] != "deleted" || projection["purge"] != "pending" || len(projection["accounts"].([]any)) != 0 {
		t.Fatal("delete barrier/status", projection)
	}
	// Claim a real purge lease and commit one bounded batch, then expire only that
	// owned lease to simulate consumer death before a fresh actual worker resumes.
	var purge database.BankingWork
	for range 12 {
		job, err := workerDB.ClaimBankingWork(context.Background())
		if database.IsEmptyBankingQueue(err) {
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		if job.Kind == "purge" {
			purge = job
			break
		}
		if _, err := workerDB.FinishBankingWork(context.Background(), job, false, 60); err != nil {
			t.Fatal(err)
		}
	}
	if purge.ID == uuid.Nil {
		t.Fatal("purge obligation absent")
	}
	n, err := workerDB.PurgeBankingBatch(context.Background(), purge)
	if err != nil || n < 1 {
		t.Fatal("first purge batch", n, err)
	}
	f.exec(`UPDATE app.banking_work SET lease_until=clock_timestamp()-interval '1 second',due_at=clock_timestamp()-interval '1 second' WHERE id=$1`, purge.ID)
	f.exec(`SELECT pgmq.set_vt('banking_lifecycle',message_id,0) FROM app.banking_work WHERE id=$1`, purge.ID)
	for range 12 {
		_, err := worker.ProcessOne(context.Background())
		if err != nil {
			t.Fatal(err)
		}
	}
	if ok, err := workerDB.FinishBankingWork(context.Background(), purge, true, 0); err != nil || ok {
		t.Fatal("stale purge authority committed", err)
	}
	projection = f.operation(handler, lifecycleHTTPRead(connection), owner, "bankingConnection", false)["connection"].(map[string]any)
	f.exec(`UPDATE app.banking_work SET due_at=clock_timestamp()-interval '1 second' WHERE connection_id=$1 AND generation=5 AND kind='teardown'`, connection)
	f.exec(`SELECT pgmq.set_vt('banking_lifecycle',message_id,0) FROM app.banking_work WHERE connection_id=$1 AND generation=5 AND kind='teardown'`, connection)
	for range 12 {
		if _, err := worker.ProcessOne(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	projection = f.operation(handler, lifecycleHTTPRead(connection), owner, "bankingConnection", false)["connection"].(map[string]any)
	if projection["cleanup"] != "confirmed" {
		t.Fatal("final removal not confirmed", projection)
	}
	if projection["purge"] != "complete" {
		t.Fatal("resumed purge incomplete", projection)
	}
	for _, table := range []string{"sources", "source_revisions", "annotations", "captures", "archives", "plans", "enrollment_accounts"} {
		var count int
		if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_`+table+` WHERE owner_id=$1`, f.owner).Scan(&count); err != nil || count != 0 {
			t.Fatal("private payload survived", table, count, err)
		}
	}
	jointRead := f.operation(handler, lifecycleHTTPRead(uuid.MustParse(jointResult["connectionId"].(string))), other, "bankingConnection", false)
	if jointRead["code"] != "READY" || len(jointRead["connection"].(map[string]any)["accounts"].([]any)) != 1 {
		t.Fatal("independent holder affected")
	}
	if sharedBefore != lifecycleHTTPSharedSnapshot(t, f) {
		t.Fatal("private deletion changed shared financial or Activity data")
	}
	for token, zone := range map[string]string{owner: "America/Los_Angeles", other: "Asia/Tokyo"} {
		result := f.operation(handler, `query{reportingTimezone`+zoneFields+`}`, token, "reportingTimezone", false)
		if result["timezone"] != zone || result["version"] != "1" {
			t.Fatal("bank lifecycle changed independent reporting timezone")
		}
	}
}

func lifecycleHTTPSharedSnapshot(t *testing.T, f *bankingHTTPFixture) string {
	t.Helper()
	result := ""
	for _, table := range []string{"groups", "expenses", "repayments", "expense_audit", "repayment_audit", "financial_records", "reporting_timezones", "reporting_timezone_attempts"} {
		var digest string
		if err := f.admin.QueryRow(context.Background(), `SELECT md5(coalesce(jsonb_agg(to_jsonb(saved) ORDER BY to_jsonb(saved)::text)::text,'')) FROM app.`+table+` saved`).Scan(&digest); err != nil {
			t.Fatal("shared snapshot unavailable", err)
		}
		result += digest
	}
	return result
}
