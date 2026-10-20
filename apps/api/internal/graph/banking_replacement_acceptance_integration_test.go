//go:build integration

package graph_test

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

type replacementHTTPScenario struct {
	f                          *bankingHTTPFixture
	handler                    http.Handler
	owner                      string
	account, original, binding uuid.UUID
	request, preview           string
}

func independentReplacementHTTP(t *testing.T) replacementHTTPScenario {
	t.Helper()
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
	s := replacementHTTPScenario{f: f, handler: f.handler(true), owner: f.token(f.owner)}
	f.operation(s.handler, fmt.Sprintf(`mutation{initializeReportingTimezone(attemptId:%q,deviceTimezone:"UTC"){__typename ... on ReportingTimezone{timezone}}}`, uuid.NewString()), s.owner, "initializeReportingTimezone", false)
	attempt := uuid.New()
	f.operation(s.handler, bankingHTTPStart(attempt, "DIFFERENT"), s.owner, "startBankingEnrollment", true)
	initial := f.operation(s.handler, bankingHTTPFinish(attempt, "selected-checking"), s.owner, "finishBankingEnrollment", false)
	if initial["code"] != "AWAITING_INITIAL_IMPORT" {
		t.Fatal("initial enrollment failed", initial["code"])
	}
	if err := f.admin.QueryRow(context.Background(), `SELECT account_id,id FROM app.banking_bindings WHERE connection_id=$1`, initial["connectionId"]).Scan(&s.account, &s.original); err != nil {
		t.Fatal(err)
	}
	f.exec(`UPDATE app.banking_bindings SET import_state='usable' WHERE id=$1`, s.original)
	stage := uuid.New()
	start := fmt.Sprintf(`mutation{startBankingReplacement(input:{attemptId:%q,accountId:%q})%s}`, stage.String(), s.account.String(), bankingHTTPSelection)
	if result := f.operation(s.handler, start, s.owner, "startBankingReplacement", true); result["code"] != "PREPARED" {
		t.Fatal(result["code"])
	}
	result := f.operation(s.handler, bankingHTTPFinish(stage, "selected-checking"), s.owner, "finishBankingEnrollment", false)
	if result["code"] != "AWAITING_INITIAL_IMPORT" {
		t.Fatal(result["code"])
	}
	if err := f.admin.QueryRow(context.Background(), `SELECT id FROM app.banking_bindings WHERE connection_id=$1 AND reporting_state='staged'`, result["connectionId"]).Scan(&s.binding); err != nil {
		t.Fatal(err)
	}
	s.request = fmt.Sprintf(`{accountId:%q,bindingId:%q,action:ACTIVATE,transitionDate:"2026-09-30"}`, s.account.String(), s.binding.String())
	s.preview = fmt.Sprintf(`query{bankingReplacementPreview(input:%s){code revisions{plan import data annotation lifecycle} reportingRevision proposed{count spendingMinor} coverage collectionState}}`, s.request)
	return s
}

func replacementHTTPExpected(t *testing.T, p map[string]any) string {
	t.Helper()
	r, ok := p["revisions"].(map[string]any)
	if !ok {
		t.Fatal("preview omitted authorized guards")
	}
	return fmt.Sprintf(`{plan:%q,import:%q,data:%q,annotation:%q,lifecycle:%q}`, r["plan"], r["import"], r["data"], r["annotation"], r["lifecycle"])
}

func TestIndependentBankingHTTPUnavailableImportCancellation(t *testing.T) {
	for _, state := range []string{"unknown", "failed", "unavailable"} {
		t.Run(state, func(t *testing.T) {
			s := independentReplacementHTTP(t)
			f := s.f
			f.exec(`UPDATE app.banking_bindings SET import_state=$2 WHERE id=$1`, s.binding, state)
			p := f.operation(s.handler, s.preview, s.owner, "bankingReplacementPreview", false)
			if p["code"] != "IMPORT_UNAVAILABLE" || p["revisions"] == nil || p["proposed"] != nil {
				t.Fatal("unusable import hid guards or claimed complete impact")
			}
			expected := replacementHTTPExpected(t, p)
			confirm := fmt.Sprintf(`mutation{confirmBankingReplacement(input:{attemptId:%q,request:%s,expected:%s}){code resultId}}`, uuid.NewString(), s.request, expected)
			if r := f.operation(s.handler, confirm, s.owner, "confirmBankingReplacement", false); r["code"] != "IMPORT_UNAVAILABLE" || r["resultId"] != nil {
				t.Fatal("unusable import published")
			}
			cancelID := uuid.NewString()
			cancel := fmt.Sprintf(`mutation{cancelBankingReplacement(input:{attemptId:%q,request:%s,expected:%s}){code resultId}}`, cancelID, s.request, expected)
			if r := f.operation(s.handler, cancel, s.owner, "cancelBankingReplacement", false); r["code"] != "READY" || r["resultId"] != s.binding.String() {
				t.Fatal("nonready import could not be cancelled", r["code"])
			}
			var plans int
			var oldState, cancelledState string
			if err := f.admin.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM app.banking_plans WHERE account_id=$1),(SELECT reporting_state FROM app.banking_bindings WHERE id=$2),(SELECT reporting_state FROM app.banking_bindings WHERE id=$3)`, s.account, s.original, s.binding).Scan(&plans, &oldState, &cancelledState); err != nil || plans != 0 || oldState != "current" || cancelledState != "cancelled" {
				t.Fatal("cancellation changed prior plan", err)
			}
			status := f.operation(f.handler(true), fmt.Sprintf(`query{bankingReplacementOperation(attemptId:%q){code resultId}}`, cancelID), s.owner, "bankingReplacementOperation", false)
			if status["code"] != "READY" || status["resultId"] != s.binding.String() {
				t.Fatal("cancel status did not survive handler restart")
			}
		})
	}
}

func TestIndependentBankingHTTPReplacementAuthorizationAndRecovery(t *testing.T) {
	s := independentReplacementHTTP(t)
	f := s.f
	f.exec(`UPDATE app.banking_bindings SET import_state='usable' WHERE id=$1`, s.binding)
	p := f.operation(s.handler, s.preview, s.owner, "bankingReplacementPreview", false)
	expected := replacementHTTPExpected(t, p)
	attempt := uuid.NewString()
	confirm := fmt.Sprintf(`mutation{confirmBankingReplacement(input:{attemptId:%q,request:%s,expected:%s}){code resultId}}`, attempt, s.request, expected)
	cancel := fmt.Sprintf(`mutation{cancelBankingReplacement(input:{attemptId:%q,request:%s,expected:%s}){code resultId}}`, uuid.NewString(), s.request, expected)
	status := fmt.Sprintf(`query{bankingReplacementOperation(attemptId:%q){code resultId}}`, attempt)
	for _, op := range []struct{ query, field string }{{s.preview, "bankingReplacementPreview"}, {confirm, "confirmBankingReplacement"}, {cancel, "cancelBankingReplacement"}, {status, "bankingReplacementOperation"}} {
		for _, identity := range []struct{ token, code string }{{"", "UNAUTHENTICATED"}, {f.token(f.disabled), "FORBIDDEN"}, {f.token(f.other), "NOT_FOUND"}} {
			envelope := f.post(s.handler, op.query, identity.token, false)
			if identity.token == "" {
				errors, ok := envelope["errors"].([]any)
				if !ok || len(errors) != 1 || errors[0].(map[string]any)["extensions"].(map[string]any)["code"] != identity.code {
					t.Fatal("unauthenticated replacement reached domain state")
				}
				continue
			}
			if envelope["errors"] != nil {
				t.Fatal("authenticated denial exposed transport failure")
			}
			result := envelope["data"].(map[string]any)[op.field].(map[string]any)
			// Cancellation deliberately masks inaccessible input as conflict.
			if result["code"] != identity.code && !(op.field == "cancelBankingReplacement" && identity.code == "NOT_FOUND" && result["code"] == "CONFLICT") {
				t.Fatal("replacement authorization failed", op.field, result["code"])
			}
			if result["resultId"] != nil || result["revisions"] != nil || result["reportingRevision"] != nil || result["proposed"] != nil {
				t.Fatal("denial exposed private replacement state")
			}
		}
	}
	var plans int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_plans WHERE account_id=$1`, s.account).Scan(&plans); err != nil || plans != 0 {
		t.Fatal("denied mutation changed reporting", err)
	}
	// A stream owned by another actor is not a replacement candidate even when
	// the request supplies an account the caller owns.
	foreignConnection := uuid.NewString()
	foreignBinding := uuid.NewString()
	foreignAccount := uuid.NewString()
	f.exec(`INSERT INTO app.banking_connections(id,owner_id,environment,provider,provider_item_id) VALUES($1,$2,'sandbox','plaid','foreign-controlled-item')`, foreignConnection, f.other)
	f.exec(`INSERT INTO app.banking_accounts(id,owner_id,kind) VALUES($1,$2,'checking')`, foreignAccount, f.other)
	f.exec(`INSERT INTO app.banking_bindings(id,owner_id,connection_id,account_id,provider_account_id,reporting_state,import_state) VALUES($1,$2,$3,$4,'foreign-account','staged','usable')`, foreignBinding, f.other, foreignConnection, foreignAccount)
	foreign := fmt.Sprintf(`query{bankingReplacementPreview(input:{accountId:%q,bindingId:%q,action:ACTIVATE,transitionDate:"2026-09-30"}){code proposed{count}}}`, s.account.String(), foreignBinding)
	if r := f.operation(s.handler, foreign, s.owner, "bankingReplacementPreview", false); r["code"] != "CONFLICT" || r["proposed"] != nil {
		t.Fatal("foreign binding became reporting source")
	}
	// Use a fresh client attempt after the foreign-owner denial probes.
	attempt = uuid.NewString()
	confirm = fmt.Sprintf(`mutation{confirmBankingReplacement(input:{attemptId:%q,request:%s,expected:%s}){code resultId}}`, attempt, s.request, expected)
	status = fmt.Sprintf(`query{bankingReplacementOperation(attemptId:%q){code resultId}}`, attempt)
	result := f.operation(s.handler, confirm, s.owner, "confirmBankingReplacement", false)
	if result["code"] != "READY" || result["resultId"] == nil {
		t.Fatal("authorized confirmation failed", result["code"])
	}
	for _, token := range []string{f.token(f.other), f.token(f.disabled)} {
		r := f.operation(s.handler, status, token, "bankingReplacementOperation", false)
		if r["code"] == "READY" || r["resultId"] != nil {
			t.Fatal("successful receipt leaked across owner/disabled boundary")
		}
	}
	restoreRequest := fmt.Sprintf(`{accountId:%q,action:RESTORE_PREDECESSOR}`, s.account.String())
	restoreQuery := fmt.Sprintf(`query{bankingReplacementPreview(input:%s){code revisions{plan import data annotation lifecycle} collectionState proposed{count spendingMinor}}}`, restoreRequest)
	restorePreview := f.operation(f.handler(true), restoreQuery, s.owner, "bankingReplacementPreview", false)
	if restorePreview["code"] != "READY" {
		t.Fatal("HTTP predecessor preview failed", restorePreview["code"])
	}
	restoreID := uuid.NewString()
	restore := fmt.Sprintf(`mutation{confirmBankingReplacement(input:{attemptId:%q,request:%s,expected:%s}){code resultId}}`, restoreID, restoreRequest, replacementHTTPExpected(t, restorePreview))
	restored := f.operation(s.handler, restore, s.owner, "confirmBankingReplacement", false)
	if restored["code"] != "READY" || restored["resultId"] == result["resultId"] {
		t.Fatal("HTTP recovery did not publish a new plan")
	}
	recovered := f.operation(f.handler(true), fmt.Sprintf(`query{bankingReplacementOperation(attemptId:%q){code resultId}}`, restoreID), s.owner, "bankingReplacementOperation", false)
	if recovered["resultId"] != restored["resultId"] {
		t.Fatal("HTTP recovery lost durable result")
	}
	var retired string
	if err := f.admin.QueryRow(context.Background(), `SELECT reporting_state FROM app.banking_bindings WHERE id=$1`, s.original).Scan(&retired); err != nil || retired != "retired" {
		t.Fatal("HTTP recovery restored collection permission", err)
	}
}
