package banking

import (
	"strings"
	"testing"
	"time"
)

func textPointer(v string) *string { return &v }
func reportFact(amount, activity string) Transaction {
	r := Transaction{Current: true, AmountMinor: amount, Currency: "USD", BankDate: "2026-10-02", ProcessingState: "posted", ActivityOverride: textPointer(activity), SourceRevision: "1", MaterialRevision: "1", AnnotationRevision: "1"}
	if err := classifyTransaction(&r); err != nil {
		panic(err)
	}
	return r
}
func TestReportC3ExactSpendingExamples(t *testing.T) {
	for _, test := range []struct {
		name, net string
		rows      []Transaction
	}{
		{"E01 same-month refund", "6000", []Transaction{reportFact("10000", "purchase"), reportFact("-4000", "refund")}},
		{"E02 September purchase", "10000", []Transaction{reportFact("10000", "purchase")}},
		{"E02 October refund", "-4000", []Transaction{reportFact("-4000", "refund")}},
		{"E03 both repayment legs", "10000", []Transaction{reportFact("10000", "purchase"), reportFact("10000", "repayment"), reportFact("-10000", "repayment")}},
		{"E04 both transfer legs", "0", []Transaction{reportFact("50000", "transfer"), reportFact("-50000", "transfer")}},
		{"E04 one transfer account", "0", []Transaction{reportFact("50000", "transfer")}},
		{"E05 income and unknown credit", "0", []Transaction{reportFact("-200000", "income"), reportFact("-2500", "unresolved")}},
		{"E06 explicit posted replacement", "2700", []Transaction{reportFact("2700", "purchase")}},
		{"E07 cash withdrawal", "0", []Transaction{reportFact("20000", "cash_withdrawal")}},
		{"E08 fee debit and credit interest", "1500", []Transaction{reportFact("500", "bank_fee"), reportFact("1000", "debit_interest"), reportFact("-200", "income")}},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := summarizeReport(test.rows)
			if err != nil || got.NetMinor != test.net {
				t.Fatalf("net=%s error=%v", got.NetMinor, err)
			}
		})
	}
	pending := reportFact("2500", "purchase")
	pending.ProcessingState = "pending"
	_ = classifyTransaction(&pending)
	excluded := reportFact("10000", "purchase")
	excluded.Excluded = true
	_ = classifyTransaction(&excluded)
	removed := reportFact("10000", "purchase")
	removed.ProcessingState = "removed"
	_ = classifyTransaction(&removed)
	got, err := summarizeReport([]Transaction{pending, excluded, removed, reportFact("0", "purchase")})
	if err != nil || got.NetMinor != "0" || got.PendingCount != 1 || got.RemovedCount != 1 || got.ExcludedCount != 1 || got.ZeroCount != 1 {
		t.Fatalf("status counts: %+v %v", got, err)
	}
}
func TestReportClassificationEvidenceAndOverrides(t *testing.T) {
	for _, test := range []struct{ name, amount, primary, detail, confidence, code, activity string }{
		{"high purchase", "10000", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES", "HIGH", "", "purchase"},
		{"credit not refund", "-2500", "GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE", "VERY_HIGH", "", "unresolved"},
		{"low confidence", "10000", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES", "LOW", "", "unresolved"},
		{"unknown category", "10000", "UNKNOWN", "UNKNOWN", "HIGH", "", "unresolved"},
		{"government unresolved", "10000", "GOVERNMENT_AND_NON_PROFIT", "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT", "HIGH", "", "unresolved"},
		{"conflicting explicit code", "10000", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES", "HIGH", "transfer", "unresolved"},
		{"merchant refund code wins", "-4000", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES", "HIGH", "refund", "refund"},
		{"explicit refund", "-4000", "", "", "", "refund", "refund"},
		{"incompatible explicit code", "-4000", "INCOME", "INCOME_WAGES", "HIGH", "purchase", "unresolved"},
		{"generic payment insufficient", "10000", "", "", "", "payment", "unresolved"},
		{"debit interest", "1000", "BANK_FEES", "BANK_FEES_INTEREST_CHARGE", "HIGH", "", "debit_interest"},
		{"tax refund income", "-1000", "INCOME", "INCOME_TAX_REFUND", "HIGH", "", "income"},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := Transaction{Current: true, AmountMinor: test.amount, Currency: "USD", ProcessingState: "posted", ProviderPrimaryCategory: &test.primary, ProviderCategory: &test.detail, ProviderConfidence: &test.confidence, ProviderCode: &test.code}
			if err := classifyTransaction(&r); err != nil || r.Activity != test.activity {
				t.Fatalf("classification %+v %v", r, err)
			}
		})
	}
	r := Transaction{Current: true, AmountMinor: "-100", Currency: "USD", ProcessingState: "posted", ProviderCode: textPointer("refund"), CategoryOverride: textPointer("FOOD_AND_DRINK")}
	_ = classifyTransaction(&r)
	if r.Activity != "refund" || r.Category != "FOOD_AND_DRINK" {
		t.Fatal("category altered activity")
	}
	r.ActivityOverride = textPointer("purchase")
	r.MaterialConflict = true
	_ = classifyTransaction(&r)
	if r.Activity != "unresolved" || r.Eligible {
		t.Fatal("stale/incompatible intent contributed")
	}
	r.Reviewed = true
	_ = classifyTransaction(&r)
	if r.Activity != "unresolved" {
		t.Fatal("review alone classified activity")
	}
}
func TestReportDatesPresetsSavedZoneAndInvalidBounds(t *testing.T) {
	for _, test := range []struct{ today, period, start, end string }{
		{"2026-10-17", "LAST_60_DAYS", "2026-08-19", "2026-10-17"}, {"2026-10-17", "LAST_90_DAYS", "2026-07-20", "2026-10-17"},
		{"2024-03-01", "LAST_MONTH", "2024-02-01", "2024-02-29"}, {"2024-03-01", "LAST_60_DAYS", "2024-01-02", "2024-03-01"},
		{"2027-01-01", "LAST_MONTH", "2026-12-01", "2026-12-31"}, {"2026-10-17", "YEAR_TO_DATE", "2026-01-01", "2026-10-17"},
	} {
		now, _ := time.Parse(time.DateOnly, test.today)
		start, end, _, fields := reportBounds(ReportFilter{Period: test.period}, "UTC", now)
		if start != test.start || end != test.end || len(fields) > 0 {
			t.Fatalf("%+v => %s %s %v", test, start, end, fields)
		}
	}
	now := time.Date(2026, 11, 1, 1, 0, 0, 0, time.UTC)
	start, end, today, fields := reportBounds(ReportFilter{Period: "THIS_MONTH"}, "America/Los_Angeles", now)
	if start != "2026-10-01" || end != "2026-10-31" || today != "2026-10-31" || len(fields) > 0 {
		t.Fatal("travel/device clock replaced saved timezone")
	}
	for _, f := range []ReportFilter{{Period: "CUSTOM"}, {Period: "CUSTOM", Start: "2026-02-29", End: "2026-03-01"}, {Period: "CUSTOM", Start: "2026-10-01", End: "2026-11-02"}, {Period: "CUSTOM", Start: "2026-10-02", End: "2026-10-01"}, {Period: "CUSTOM", Start: "0000-01-01", End: "2026-10-01"}, {Period: "THIS_MONTH", Start: "2026-01-01"}} {
		_, _, _, fields := reportBounds(f, "UTC", now)
		if len(fields) == 0 {
			t.Fatalf("invalid bounds accepted %+v", f)
		}
	}
	_, _, _, fields = reportBounds(ReportFilter{Period: "CUSTOM", Start: "0001-01-01", End: "2026-10-01"}, "UTC", now)
	if len(fields) > 0 {
		t.Fatal("older retained history clamped")
	}
}
func TestReportErrorsNotesAndCoverage(t *testing.T) {
	for _, r := range []Transaction{{AmountMinor: "1", Currency: "EUR"}, {AmountMinor: "1.0", Currency: "USD"}, {AmountMinor: "9007199254740992", Currency: "USD"}, {AmountMinor: "-9223372036854775808", Currency: "USD"}} {
		if classifyTransaction(&r) == nil {
			t.Fatal("invalid exact money accepted")
		}
	}
	if _, err := summarizeReport([]Transaction{reportFact("9007199254740991", "purchase"), reportFact("1", "purchase")}); err == nil {
		t.Fatal("overflow became successful zero/partial")
	}
	for _, note := range []string{strings.Repeat("界", 2001), "secret\x00note", "\u007f"} {
		if validAnnotationValue(AnnotationInput{Field: "note", Value: &note}) {
			t.Fatal("invalid note accepted")
		}
	}
	note := strings.Repeat("界", 2000) + ""
	if !validAnnotationValue(AnnotationInput{Field: "note", Value: &note}) {
		t.Fatal("Unicode note bounded by bytes")
	}
	a := ReportAccount{Intervals: []ReportInterval{{ImportState: "usable", CoverageAfter: textPointer("2026-09-30"), CoverageThrough: textPointer("2026-10-31"), CollectionState: "current/active/granted"}}}
	if !deriveReportCoverage(&a, "2026-01-01", "2026-10-17") || a.Coverage != "PARTIAL" {
		t.Fatal("YTD missing history hidden")
	}
	if !deriveReportCoverage(&a, "2026-10-01", "2026-10-17") || a.Coverage != "COMPLETE" {
		t.Fatal("known empty coverage not complete")
	}
	a.Intervals[0].CoverageAfter = nil
	deriveReportCoverage(&a, "2026-10-01", "2026-10-17")
	if a.Intervals[0].Coverage != "UNKNOWN" {
		t.Fatal("transaction existence proved coverage")
	}
}
