//go:build integration

package graph_test

import (
	"context"
	"fmt"
	"net/http"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

const reportingHTTPRowFields = `id accountId sourceRevision materialRevision amountMinor currency bankDate authorizationDate processingState providerPrimaryCategory providerCategory providerConfidence providerCode mappingVersion annotationRevision categoryOverride activityOverride note excluded reviewed materialConflict current category activity eligible`
const reportingHTTPFields = `{code fieldErrors start end timezone revision totalCount hasNextPage endCursor spendingContext accounts{id coverage requestedHistoryDays intervals{bindingId coverage importState}} counts{count pendingCount unresolvedCount classificationComplete} summary{count purchaseMinor refundMinor netMinor pendingCount classificationComplete} rows{` + reportingHTTPRowFields + `}}`
const reportingHTTPDetailFields = `{code currentId transaction{` + reportingHTTPRowFields + `}}`
const reportingHTTPAnnotationFields = `{code sourceId detail` + reportingHTTPDetailFields + `}`
const reportingHTTPFebruary = `filter:{period:CUSTOM,start:"2024-02-01",end:"2024-02-29"}`

type reportingHTTPFixture struct {
	*bankingHTTPFixture
	handler          http.Handler
	token            string
	account, binding uuid.UUID
	sources          map[string]uuid.UUID
}

func newReportingHTTPFixture(t *testing.T) *reportingHTTPFixture {
	t.Helper()
	f := newBankingHTTPFixture(t)
	h := f.handler(true)
	token := f.token(f.owner)
	initializeReportingHTTPZone(t, f, h, token)
	_, account, binding := enrollReportingHTTPAccount(t, f, h, token)
	out := &reportingHTTPFixture{bankingHTTPFixture: f, handler: h, token: token, account: account, binding: binding, sources: map[string]uuid.UUID{}}
	t.Cleanup(func() {
		f.exec(`INSERT INTO app.banking_account_barriers(account_id,owner_id,connection_id,generation) SELECT account_id,owner_id,connection_id,1 FROM app.banking_bindings WHERE owner_id=$1 ON CONFLICT DO NOTHING`, f.owner)
		f.exec(`DELETE FROM app.banking_annotations WHERE owner_id=$1`, f.owner)
		f.exec(`UPDATE app.banking_sources SET revision=NULL WHERE owner_id=$1`, f.owner)
		f.exec(`DELETE FROM app.banking_source_revisions WHERE owner_id=$1`, f.owner)
		f.exec(`DELETE FROM app.banking_sources WHERE owner_id=$1`, f.owner)
	})
	for _, row := range []struct {
		key, date, state, code string
		amount                 int64
	}{
		{"purchase", "2024-02-01", "posted", "purchase", 10000},
		{"refund", "2024-02-29", "posted", "refund", -4000},
		{"pending", "2024-02-28", "pending", "purchase", 2500},
		{"transfer", "2024-02-20", "posted", "transfer", 50000},
		{"next-month", "2024-03-01", "posted", "purchase", 9000},
	} {
		source := uuid.New()
		out.sources[row.key] = source
		primary, detail := "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"
		if row.code == "transfer" {
			primary, detail = "TRANSFER_OUT", "TRANSFER_OUT_SAVINGS"
		}
		f.exec(`WITH source AS (INSERT INTO app.banking_sources(id,owner_id,binding_id,provider_transaction_id,revision) VALUES($1,$2,$3,$4,1) RETURNING id) INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,material_revision,amount_minor,currency,bank_date,authorization_date,processing_state,provider_primary_category,provider_category,provider_confidence,provider_code,mapping_version,stage) SELECT id,$2,1,1,$5,'USD',$6::date,'2024-02-01',$7,$9,$10,'HIGH',$8,'plaid-pfc-v2','current' FROM source`, source, f.owner, binding, row.key, row.amount, row.date, row.state, row.code, primary, detail)
	}
	return out
}

func initializeReportingHTTPZone(t *testing.T, f *bankingHTTPFixture, h http.Handler, token string) {
	t.Helper()
	query := fmt.Sprintf(`mutation{initializeReportingTimezone(attemptId:%q,deviceTimezone:"America/Los_Angeles"){__typename ... on ReportingTimezone{timezone version} ... on ReportingTimezoneProblem{code}}}`, uuid.NewString())
	result := f.operation(h, query, token, "initializeReportingTimezone", false)
	if result["timezone"] != "America/Los_Angeles" {
		t.Fatal("reporting timezone was not initialized")
	}
}

func enrollReportingHTTPAccount(t *testing.T, f *bankingHTTPFixture, h http.Handler, token string) (uuid.UUID, uuid.UUID, uuid.UUID) {
	t.Helper()
	attempt := uuid.New()
	if got := f.operation(h, bankingHTTPStart(attempt, "DIFFERENT"), token, "startBankingEnrollment", true); got["code"] != "PREPARED" {
		t.Fatal("report enrollment preparation failed")
	}
	enrolled := f.operation(h, bankingHTTPFinish(attempt, "selected-checking"), token, "finishBankingEnrollment", false)
	if enrolled["code"] != "AWAITING_INITIAL_IMPORT" {
		t.Fatal("report enrollment did not retain initial import")
	}
	connection := uuid.MustParse(enrolled["connectionId"].(string))
	var account, binding uuid.UUID
	if err := f.admin.QueryRow(context.Background(), `SELECT account_id,id FROM app.banking_bindings WHERE connection_id=$1 AND provider_account_id='selected-checking'`, connection).Scan(&account, &binding); err != nil {
		t.Fatal(err)
	}
	f.exec(`UPDATE app.banking_bindings SET import_state='usable',coverage_after='2024-01-01',coverage_through='2024-03-31' WHERE id=$1`, binding)
	return connection, account, binding
}

func (f *reportingHTTPFixture) report(arguments string) map[string]any {
	f.t.Helper()
	return f.operation(f.handler, `query{bankingReport(`+arguments+`)`+reportingHTTPFields+`}`, f.token, "bankingReport", false)
}
func (f *reportingHTTPFixture) detail(id uuid.UUID) map[string]any {
	f.t.Helper()
	return f.operation(f.handler, fmt.Sprintf(`query{bankingTransaction(sourceId:%q)%s}`, id.String(), reportingHTTPDetailFields), f.token, "bankingTransaction", false)
}
func reportingHTTPAnnotation(attempt, source uuid.UUID, expected, field, value string) string {
	return fmt.Sprintf(`mutation{editBankingAnnotation(input:{attemptId:%q,sourceId:%q,sourceRevision:"1",expectedRevision:%q,materialRevision:"1",field:%s,value:%s})%s}`, attempt.String(), source.String(), expected, field, value, reportingHTTPAnnotationFields)
}

func TestBankingHTTPReportingCompleteDatesAndDetail(t *testing.T) {
	f := newReportingHTTPFixture(t)
	preparations, exchanges := f.provider.counts()
	first := f.report(reportingHTTPFebruary + `,first:1`)
	requireStatusFields(t, first, map[string]any{"code": "READY", "start": "2024-02-01", "end": "2024-02-29", "timezone": "America/Los_Angeles", "totalCount": float64(4), "hasNextPage": true, "spendingContext": "SPENDING_FROM_ACCOUNTS"})
	requireStatusFields(t, first["summary"].(map[string]any), map[string]any{"count": float64(4), "purchaseMinor": "10000", "refundMinor": "4000", "netMinor": "6000", "pendingCount": float64(1), "classificationComplete": true})
	rows := first["rows"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["id"] != f.sources["refund"].String() {
		t.Fatal("posted date ordering or page bound changed")
	}
	account := first["accounts"].([]any)[0].(map[string]any)
	requireStatusFields(t, account, map[string]any{"id": f.account.String(), "coverage": "COMPLETE", "requestedHistoryDays": float64(365)})
	next := f.report(reportingHTTPFebruary + fmt.Sprintf(`,first:3,after:%q`, first["endCursor"]))
	if next["code"] != "READY" || next["hasNextPage"] != false || len(next["rows"].([]any)) != 3 || !reflect.DeepEqual(next["summary"], first["summary"]) {
		t.Fatal("pagination changed complete summary or omitted remaining rows")
	}
	detail := f.detail(f.sources["next-month"])
	if detail["code"] != "READY" || detail["currentId"] != f.sources["next-month"].String() {
		t.Fatal("authorized detail missing")
	}
	requireStatusFields(t, detail["transaction"].(map[string]any), map[string]any{"bankDate": "2024-03-01", "authorizationDate": "2024-02-01", "amountMinor": "9000", "providerPrimaryCategory": "FOOD_AND_DRINK", "providerCategory": "FOOD_AND_DRINK_GROCERIES", "providerConfidence": "HIGH", "mappingVersion": "plaid-pfc-v2"})
	march := f.report(`filter:{period:CUSTOM,start:"2024-03-01",end:"2024-03-01"},first:1`)
	if march["totalCount"] != float64(1) || march["summary"].(map[string]any)["netMinor"] != "9000" {
		t.Fatal("authorization date moved purchase into February")
	}
	for _, bounds := range []string{`start:"2024-02-30",end:"2024-03-01"`, `start:"2024-03-01",end:"2024-02-29"`, `start:"2024-02-01",end:"9999-01-01"`} {
		invalid := f.report(`filter:{period:CUSTOM,` + bounds + `}`)
		if invalid["code"] != "INVALID_INPUT" || invalid["summary"] != nil || len(invalid["fieldErrors"].([]any)) == 0 {
			t.Fatal("invalid date range returned successful totals")
		}
	}
	if p, e := f.provider.counts(); p != preparations || e != exchanges {
		t.Fatal("stored report/detail initiated provider enrollment or exchange")
	}
}

func TestBankingHTTPReportingPrivateReferencesAndCursor(t *testing.T) {
	f := newReportingHTTPFixture(t)
	first := f.report(reportingHTTPFebruary + `,first:1`)
	other := f.bankingHTTPFixture.token(f.other)
	initializeReportingHTTPZone(t, f.bankingHTTPFixture, f.handler, other)
	enrollReportingHTTPAccount(t, f.bankingHTTPFixture, f.handler, other)
	query := fmt.Sprintf(`query{known:bankingTransaction(sourceId:%q)%s missing:bankingTransaction(sourceId:%q)%s}`, f.sources["purchase"].String(), reportingHTTPDetailFields, uuid.NewString(), reportingHTTPDetailFields)
	envelope := f.post(f.handler, query, other, false)
	data := envelope["data"].(map[string]any)
	if envelope["errors"] != nil || !reflect.DeepEqual(data["known"], data["missing"]) || data["known"].(map[string]any)["transaction"] != nil {
		t.Fatal("nested foreign detail disclosed a private reference")
	}
	for _, account := range []string{f.account.String(), uuid.NewString()} {
		result := f.operation(f.handler, fmt.Sprintf(`query{bankingReport(filter:{period:CUSTOM,start:"2024-02-01",end:"2024-02-29",accountIds:[%q]})%s}`, account, reportingHTTPFields), other, "bankingReport", false)
		if result["code"] != "NOT_FOUND" || result["summary"] != nil || len(result["rows"].([]any)) != 0 || len(result["accounts"].([]any)) != 0 {
			t.Fatal("foreign account filter exposed inventory or totals")
		}
	}
	cursorQuery := fmt.Sprintf(`query{bankingReport(%s,first:1,after:%q)%s}`, reportingHTTPFebruary, first["endCursor"], reportingHTTPFields)
	denied := f.operation(f.handler, cursorQuery, other, "bankingReport", false)
	if denied["code"] != "RESTART_REQUIRED" || denied["summary"] != nil || len(denied["rows"].([]any)) != 0 {
		t.Fatal("owner cursor transferred private pagination to another user")
	}
	node := f.post(f.handler, fmt.Sprintf(`query{node(id:%q){id __typename}}`, "ks1:BankingTransaction:"+f.sources["purchase"].String()), other, false)
	if node["errors"] == nil {
		t.Fatal("private source gained an alternate Node lookup")
	}
	if f.post(f.handler, `query{bankingReport`+reportingHTTPFields+`}`, "", false)["errors"] == nil {
		t.Fatal("anonymous report reached private data")
	}
	disabled := f.operation(f.handler, `query{bankingReport`+reportingHTTPFields+`}`, f.bankingHTTPFixture.token(f.disabled), "bankingReport", false)
	if disabled["code"] != "FORBIDDEN" || disabled["summary"] != nil {
		t.Fatal("disabled actor retained report access")
	}
}

func TestBankingHTTPReportingAnnotationRecoveryAndRestart(t *testing.T) {
	f := newReportingHTTPFixture(t)
	first := f.report(reportingHTTPFebruary + `,first:1`)
	source := f.sources["purchase"]
	attempt := uuid.New()
	edit := reportingHTTPAnnotation(attempt, source, "0", "NOTE", `"private HTTP note"`)
	saved := f.operation(f.handler, edit, f.token, "editBankingAnnotation", false)
	if saved["code"] != "READY" || saved["sourceId"] != source.String() {
		t.Fatal("annotation write failed")
	}
	transaction := saved["detail"].(map[string]any)["transaction"].(map[string]any)
	requireStatusFields(t, transaction, map[string]any{"note": "private HTTP note", "annotationRevision": "1", "amountMinor": "10000", "bankDate": "2024-02-01"})
	replay := f.operation(f.handler, edit, f.token, "editBankingAnnotation", false)
	receipt := f.operation(f.handler, fmt.Sprintf(`query{bankingAnnotationOperation(attemptId:%q)%s}`, attempt.String(), reportingHTTPAnnotationFields), f.token, "bankingAnnotationOperation", false)
	if !reflect.DeepEqual(saved, replay) || !reflect.DeepEqual(saved, receipt) {
		t.Fatal("same-attempt replay/recovery changed original outcome")
	}
	var count int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1`, source).Scan(&count); err != nil || count != 1 {
		t.Fatal("same-attempt recovery appended duplicate annotation")
	}
	changed := f.operation(f.handler, reportingHTTPAnnotation(attempt, source, "0", "NOTE", `"different input"`), f.token, "editBankingAnnotation", false)
	stale := f.operation(f.handler, reportingHTTPAnnotation(uuid.New(), source, "0", "NOTE", `"stale draft"`), f.token, "editBankingAnnotation", false)
	if changed["code"] != "CONFLICT" || stale["code"] != "CONFLICT" {
		t.Fatal("changed attempt or stale revision overwrote private note")
	}
	old := f.report(reportingHTTPFebruary + fmt.Sprintf(`,first:1,after:%q`, first["endCursor"]))
	if old["code"] != "RESTART_REQUIRED" || old["summary"] != nil {
		t.Fatal("annotation change did not invalidate list/summary cursor")
	}
	fresh := f.report(reportingHTTPFebruary + `,first:1`)
	if fresh["summary"].(map[string]any)["netMinor"] != "6000" {
		t.Fatal("note edit changed spending")
	}
	excluded := f.operation(f.handler, reportingHTTPAnnotation(uuid.New(), source, "1", "EXCLUDED", `"true"`), f.token, "editBankingAnnotation", false)
	if excluded["code"] != "READY" {
		t.Fatal("private exclusion failed")
	}
	if net := f.report(reportingHTTPFebruary + `,first:1`)["summary"].(map[string]any)["netMinor"]; net != "-4000" {
		t.Fatal("exclusion did not reconcile complete spending")
	}
	other := f.bankingHTTPFixture.token(f.other)
	foreignEdit := f.operation(f.handler, reportingHTTPAnnotation(uuid.New(), source, "2", "NOTE", `"foreign edit"`), other, "editBankingAnnotation", false)
	foreignReceipt := f.operation(f.handler, fmt.Sprintf(`query{bankingAnnotationOperation(attemptId:%q)%s}`, attempt.String(), reportingHTTPAnnotationFields), other, "bankingAnnotationOperation", false)
	if foreignEdit["code"] != "NOT_FOUND" || foreignReceipt["code"] != "NOT_FOUND" || foreignReceipt["sourceId"] != nil || foreignReceipt["detail"] != nil {
		t.Fatal("group member read or edited another user's annotation")
	}
	reset := f.operation(f.handler, reportingHTTPAnnotation(uuid.New(), source, "2", "EXCLUDED", `null`), f.token, "editBankingAnnotation", false)
	if reset["code"] != "READY" {
		t.Fatal("single-field exclusion reset failed")
	}
	resetRow := reset["detail"].(map[string]any)["transaction"].(map[string]any)
	requireStatusFields(t, resetRow, map[string]any{"excluded": false, "note": "private HTTP note", "annotationRevision": "3", "amountMinor": "10000", "bankDate": "2024-02-01"})
	if net := f.report(reportingHTTPFebruary + `,first:1`)["summary"].(map[string]any)["netMinor"]; net != "6000" {
		t.Fatal("exclusion reset did not restore complete spending")
	}
}
