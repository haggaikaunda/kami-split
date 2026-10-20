//go:build integration

package graph_test

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/google/uuid"
)

func TestBankingHTTPReplacementStagePreviewPublishRecovery(t *testing.T) {
	f := newBankingHTTPFixture(t)
	t.Cleanup(func() {
		f.exec(`INSERT INTO app.banking_account_barriers(account_id,owner_id,connection_id,generation) SELECT DISTINCT ON(b.account_id) b.account_id,b.owner_id,b.connection_id,1 FROM app.banking_bindings b WHERE b.owner_id IN($1,$2,$3) ON CONFLICT DO NOTHING`, f.owner, f.other, f.disabled)
		for _, table := range []string{"captures", "archives", "plan_sources", "plan_intervals", "plans", "annotations", "source_revisions", "sources"} {
			if table == "source_revisions" {
				f.exec(`UPDATE app.banking_sources SET revision=NULL WHERE owner_id IN($1,$2,$3)`, f.owner, f.other, f.disabled)
			}
			f.exec(`DELETE FROM app.banking_`+table+` WHERE owner_id IN($1,$2,$3)`, f.owner, f.other, f.disabled)
		}
	})
	handler := f.handler(true)
	owner := f.token(f.owner)
	other := f.token(f.other)
	zone := fmt.Sprintf(`mutation{initializeReportingTimezone(attemptId:%q,deviceTimezone:"UTC"){__typename ... on ReportingTimezone{timezone}}}`, uuid.NewString())
	f.operation(handler, zone, owner, "initializeReportingTimezone", false)
	attempt := uuid.New()
	f.operation(handler, bankingHTTPStart(attempt, "DIFFERENT"), owner, "startBankingEnrollment", true)
	enrolled := f.operation(handler, bankingHTTPFinish(attempt, "selected-checking"), owner, "finishBankingEnrollment", false)
	if enrolled["code"] != "AWAITING_INITIAL_IMPORT" {
		t.Fatal(enrolled["code"])
	}
	var account, original uuid.UUID
	if err := f.admin.QueryRow(context.Background(), `SELECT account_id,id FROM app.banking_bindings WHERE connection_id=$1`, enrolled["connectionId"]).Scan(&account, &original); err != nil {
		t.Fatal(err)
	}
	f.exec(`UPDATE app.banking_bindings SET import_state='usable' WHERE id=$1`, original)
	stage := uuid.New()
	start := fmt.Sprintf(`mutation{startBankingReplacement(input:{attemptId:%q,accountId:%q})%s}`, stage.String(), account.String(), bankingHTTPSelection)
	for _, token := range []string{other, f.token(f.disabled)} {
		denied := f.operation(handler, start, token, "startBankingReplacement", false)
		if denied["code"] == "PREPARED" {
			t.Fatal("unauthorized replacement prepared")
		}
	}
	if started := f.operation(handler, start, owner, "startBankingReplacement", true); started["code"] != "PREPARED" {
		t.Fatal(started["code"])
	}
	staged := f.operation(handler, bankingHTTPFinish(stage, "selected-checking"), owner, "finishBankingEnrollment", false)
	if staged["code"] != "AWAITING_INITIAL_IMPORT" {
		t.Fatal(staged["code"])
	}
	var binding uuid.UUID
	if err := f.admin.QueryRow(context.Background(), `SELECT id FROM app.banking_bindings WHERE connection_id=$1 AND reporting_state='staged'`, staged["connectionId"]).Scan(&binding); err != nil {
		t.Fatal(err)
	}
	// Only persisted import facts/classifications are fixtures. All staging,
	// authentication, preview, publication, recovery and transport are real.
	f.exec(`UPDATE app.banking_bindings SET import_state='usable' WHERE id=$1`, binding)
	source := uuid.New()
	f.exec(`WITH source AS(INSERT INTO app.banking_sources(id,owner_id,binding_id,provider_transaction_id,revision) VALUES($1,$2,$3,'controlled-source',1) RETURNING id) INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,amount_minor,currency,bank_date,processing_state,mapping_version,stage) SELECT id,$2,1,5000,'USD','2026-10-02','posted','controlled-pfc-v2','current' FROM source`, source, f.owner, binding)
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,activity) VALUES($1,$2,1,1,'purchase')`, source, f.owner)
	request := fmt.Sprintf(`{accountId:%q,bindingId:%q,action:ACTIVATE,transitionDate:"2026-09-30"}`, account.String(), binding.String())
	query := fmt.Sprintf(`query{bankingReplacementPreview(input:%s){code revisions{plan import data annotation lifecycle} reportingRevision intervals{bindingId afterDate throughDate} proposed{count spendingMinor} coverage}}`, request)
	if denied := f.operation(handler, query, other, "bankingReplacementPreview", false); denied["code"] != "NOT_FOUND" {
		t.Fatal("preview leaked across owner")
	}
	preview := f.operation(handler, query, owner, "bankingReplacementPreview", false)
	if preview["code"] != "READY" || preview["proposed"].(map[string]any)["spendingMinor"] != "5000" {
		t.Fatal("generated preview did not expose exact impact")
	}
	revisions := preview["revisions"].(map[string]any)
	expected := fmt.Sprintf(`{plan:%q,import:%q,data:%q,annotation:%q,lifecycle:%q}`, revisions["plan"], revisions["import"], revisions["data"], revisions["annotation"], revisions["lifecycle"])
	confirmID := uuid.New()
	confirm := fmt.Sprintf(`mutation{confirmBankingReplacement(input:{attemptId:%q,request:%s,expected:%s}){code resultId}}`, confirmID.String(), request, expected)
	result := f.operation(handler, confirm, owner, "confirmBankingReplacement", false)
	if result["code"] != "READY" || result["resultId"] == nil {
		t.Fatal("generated confirmation failed", result["code"])
	}
	// A fresh handler represents a restarted process with no local operation state.
	status := f.operation(f.handler(true), fmt.Sprintf(`query{bankingReplacementOperation(attemptId:%q){code resultId}}`, confirmID.String()), owner, "bankingReplacementOperation", false)
	a, _ := json.Marshal(result)
	b, _ := json.Marshal(status)
	if string(a) != string(b) {
		t.Fatal("status lost immutable outcome")
	}
}
