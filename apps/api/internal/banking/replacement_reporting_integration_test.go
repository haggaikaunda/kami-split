//go:build integration

package banking

import (
	"testing"

	"github.com/google/uuid"
)

func TestReplacementProviderClassificationMatchesReporting(t *testing.T) {
	f := newReplacementFixture(t)
	ctx := f.actor(f.owner)
	type providerFact struct {
		date, amount            string
		primary, category, code *string
	}
	purchase := func(date, amount string) providerFact {
		return providerFact{date: date, amount: amount, primary: textPointer("FOOD_AND_DRINK"), category: textPointer("FOOD_AND_DRINK_GROCERIES")}
	}
	refund := func(date, amount string) providerFact {
		return providerFact{date: date, amount: amount, code: textPointer("refund")}
	}
	repayment := func(date, amount string) providerFact {
		return providerFact{date: date, amount: amount, primary: textPointer("LOAN_PAYMENTS"), category: textPointer("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")}
	}
	loan := func(date, amount string) providerFact {
		return providerFact{date: date, amount: amount, primary: textPointer("LOAN_DISBURSEMENTS"), category: textPointer("LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT")}
	}
	add := func(binding uuid.UUID, fact providerFact) uuid.UUID {
		t.Helper()
		id := uuid.New()
		f.exec(`WITH source AS (INSERT INTO app.banking_sources(id,owner_id,binding_id,provider_transaction_id,revision) VALUES($1,$2,$3,$4,1) RETURNING id) INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,material_revision,amount_minor,currency,bank_date,processing_state,provider_primary_category,provider_category,provider_confidence,provider_code,mapping_version,stage) SELECT id,$2,1,1,$5::bigint,'USD',$6::date,'posted',$7,$8,'HIGH',$9,'plaid-pfc-v2','current' FROM source`, id, f.owner, binding, uuid.NewString(), fact.amount, fact.date, fact.primary, fact.category, fact.code)
		return id
	}
	add(f.oldBinding, purchase("2026-06-01", "2000"))
	add(f.oldBinding, refund("2026-09-20", "-400"))
	oldRepayment := add(f.oldBinding, repayment("2026-10-01", "10000"))
	oldLoan := add(f.oldBinding, loan("2026-10-02", "-5000"))
	add(f.oldBinding, providerFact{date: "2026-10-03", amount: "700", code: textPointer("purchase")})
	b := f.stage()
	add(b, providerFact{date: "2026-09-20", amount: "99900", code: textPointer("purchase")})
	newPurchase := add(b, purchase("2026-10-01", "3000"))
	newRefund := add(b, refund("2026-10-02", "-600"))
	newRepayment := add(b, repayment("2026-10-03", "8000"))
	newLoan := add(b, loan("2026-10-04", "-20000"))
	f.usable(b)
	assertReport := func(impact ReplacementImpact, expected string) Report {
		t.Helper()
		report := f.service.ReadReport(ctx, reportRange(f.account))
		if report.Code != "READY" || report.Summary == nil {
			t.Fatalf("report unavailable: %s", report.Code)
		}
		if report.Summary.NetMinor != expected || impact.SpendingMinor != report.Summary.NetMinor || impact.Count != report.TotalCount || impact.UnresolvedCount != report.Summary.UnresolvedCount || impact.PendingCount != report.Summary.PendingCount {
			t.Fatalf("preview/report disagree: preview=%+v report=%+v expected=%s", impact, report.Summary, expected)
		}
		return report
	}
	for _, tc := range []struct {
		action, date, before, after string
		binding                     uuid.UUID
	}{
		{"ACTIVATE", "2026-09-30", "2300", "4000", b},
		{"CHANGE_BOUNDARY", "2026-10-01", "4000", "1000", uuid.Nil},
		{"RESTORE_PREDECESSOR", "", "1000", "4000", uuid.Nil},
	} {
		t.Run(tc.action, func(t *testing.T) {
			preview := f.preview(tc.binding, tc.date, tc.action)
			assertReport(preview.Prior, tc.before)
			if preview.Proposed.AnnotationCount != 0 || preview.Proposed.UnresolvedCount != 0 {
				t.Fatal("unannotated provider facts remained unresolved")
			}
			f.confirm(preview)
			assertReport(preview.Proposed, tc.after)
		})
	}
	for id, activity := range map[uuid.UUID]string{newPurchase: "purchase", newRefund: "refund", newRepayment: "repayment", newLoan: "loan_proceeds"} {
		detail := f.service.ReadTransaction(ctx, id.String(), "")
		if detail.Code != "READY" || detail.Transaction.Activity != activity || detail.Transaction.AnnotationRevision != "0" {
			t.Fatal("provider-only activity lost after recovery", activity, detail.Code)
		}
	}
	// The original plan's separate repayment/proceeds facts remain in recovery
	// provenance without entering the active plan a second time.
	for _, id := range []uuid.UUID{oldRepayment, oldLoan} {
		if detail := f.service.ReadTransaction(ctx, id.String(), ""); detail.Code != "NOT_FOUND" {
			t.Fatal("archive-only provider fact remained current")
		}
	}
}
