//go:build integration

package graph_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestBankingHTTPReportingSnapshotIdentities(t *testing.T) {
	f := newReportingHTTPFixture(t)
	source := f.sources["purchase"]
	attempt := uuid.New()
	receiptQuery := fmt.Sprintf(`query{bankingAnnotationOperation(attemptId:%q){id code sourceId detail{id code}}}`, attempt.String())
	missing := f.operation(f.handler, receiptQuery, f.token, "bankingAnnotationOperation", false)
	initial := f.operation(f.handler, reportingHTTPAnnotation(attempt, source, "0", "NOTE", `"captured note"`), f.token, "editBankingAnnotation", false)
	if initial["code"] != "READY" {
		t.Fatal("initial annotation failed")
	}
	committed := f.operation(f.handler, receiptQuery, f.token, "bankingAnnotationOperation", false)
	if missing["code"] != "NOT_FOUND" || committed["code"] != "READY" || missing["id"] == committed["id"] || !strings.HasPrefix(committed["id"].(string), "BankingAnnotationResult:") {
		t.Fatal("pending and committed receipt contexts share identity")
	}
	// Compare clean period coverage before discrepancies deliberately downgrade it.
	account := f.report(reportingHTTPFebruary + `,first:1`)["accounts"].([]any)[0].(map[string]any)
	wider := f.report(`filter:{period:CUSTOM,start:"2023-01-01",end:"2024-02-29"},first:1`)
	widerAccount := wider["accounts"].([]any)[0].(map[string]any)
	if account["accountId"] != widerAccount["accountId"] || account["id"] == widerAccount["id"] || account["coverage"] != "COMPLETE" || widerAccount["coverage"] != "PARTIAL" {
		t.Fatal("different period coverage shares an account projection")
	}
	plan, archive := uuid.New(), uuid.New()
	t.Cleanup(func() {
		f.exec(`DELETE FROM app.banking_captures WHERE archive_id=$1`, archive)
		f.exec(`DELETE FROM app.banking_archives WHERE id=$1`, archive)
		f.exec(`DELETE FROM app.banking_plan_sources WHERE plan_id=$1`, plan)
		f.exec(`DELETE FROM app.banking_plan_intervals WHERE plan_id=$1`, plan)
		f.exec(`DELETE FROM app.banking_plans WHERE id=$1`, plan)
	})
	f.exec(`INSERT INTO app.banking_plans(id,owner_id,account_id,revision,active_binding_id) VALUES($1,$2,$3,1,$4)`, plan, f.owner, f.account, f.binding)
	f.exec(`INSERT INTO app.banking_plan_intervals(plan_id,owner_id,binding_id) VALUES($1,$2,$3)`, plan, f.owner, f.binding)
	f.exec(`INSERT INTO app.banking_plan_sources(plan_id,owner_id,source_id,source_revision) VALUES($1,$2,$3,1)`, plan, f.owner, source)
	f.exec(`INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,material_revision,amount_minor,currency,bank_date,processing_state,provider_code,mapping_version,stage) VALUES($1,$2,2,2,-4000,'USD','2024-02-01','posted','refund','plaid-pfc-v2','current')`, source, f.owner)
	f.exec(`UPDATE app.banking_sources SET revision=2,discrepancy='cross_boundary_change' WHERE id=$1`, source)
	f.exec(`INSERT INTO app.banking_archives(id,owner_id,plan_id,boundary_date) VALUES($1,$2,$3,'2024-02-29')`, archive, f.owner, plan)
	f.exec(`INSERT INTO app.banking_captures(archive_id,owner_id,source_id,source_revision,annotation_revision) VALUES($1,$2,$3,2,1)`, archive, f.owner, source)
	query := fmt.Sprintf(`query{canonical:bankingTransaction(sourceId:%q)%s correction:bankingTransaction(sourceId:%q,discrepancy:true)%s archived:bankingTransaction(sourceId:%q,archiveId:%q)%s}`, source.String(), reportingHTTPDetailFields, source.String(), reportingHTTPDetailFields, source.String(), archive.String(), reportingHTTPDetailFields)
	data := f.post(f.handler, query, f.token, false)["data"].(map[string]any)
	canonicalDetail := data["canonical"].(map[string]any)
	if !strings.HasPrefix(canonicalDetail["id"].(string), "BankingTransactionDetail:") || canonicalDetail["id"] == data["correction"].(map[string]any)["id"] {
		t.Fatal("detail outcomes share a contextual identity")
	}
	current := data["canonical"].(map[string]any)["transaction"].(map[string]any)
	correction := data["correction"].(map[string]any)["transaction"].(map[string]any)
	captured := data["archived"].(map[string]any)["transaction"].(map[string]any)
	requireStatusFields(t, current, map[string]any{"sourceId": source.String(), "sourceRevision": "1", "amountMinor": "10000"})
	for _, row := range []map[string]any{correction, captured} {
		requireStatusFields(t, row, map[string]any{"sourceId": source.String(), "sourceRevision": "2", "amountMinor": "-4000"})
		if row["id"] == current["id"] {
			t.Fatal("canonical and correction/archive facts share a cache identity")
		}
	}
	if !strings.HasPrefix(current["id"].(string), "BankingTransaction:") || current["id"] == source.String() {
		t.Fatal("cache and navigation identities overlap")
	}
	first := f.report(reportingHTTPFebruary + `,first:1`)
	partial := fmt.Sprintf(`query{bankingReport(%s,first:1){id rows{id sourceId note}}}`, reportingHTTPFebruary)
	before := f.operation(f.handler, partial, f.token, "bankingReport", false)
	if first["id"] != before["id"] {
		t.Fatal("field selection changed full snapshot identity")
	}
	edited := f.operation(f.handler, reportingHTTPAnnotation(uuid.New(), source, "1", "NOTE", `"latest note"`), f.token, "editBankingAnnotation", false)
	if edited["code"] != "READY" {
		t.Fatal("stable source identity could not edit captured canonical fact")
	}
	after := f.operation(f.handler, partial, f.token, "bankingReport", false)
	if after["id"] == before["id"] {
		t.Fatal("partial refresh reused report with old unselected summary")
	}
	updatedDetail := f.detail(source)
	if updatedDetail["id"] == canonicalDetail["id"] {
		t.Fatal("detail identity ignores changed transaction annotation")
	}
	updated := updatedDetail["transaction"].(map[string]any)
	if updated["id"] == current["id"] || updated["sourceId"] != current["sourceId"] || updated["note"] != "latest note" {
		t.Fatal("annotation refresh lost snapshot or navigation identity")
	}
	denied := f.post(f.handler, fmt.Sprintf(`query{node(id:%q){id}}`, current["id"]), f.token, false)
	if denied["data"].(map[string]any)["node"] != nil {
		t.Fatal("snapshot identity accepted as Node capability")
	}
}
