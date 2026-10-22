package banking

import (
	"testing"
	"time"
)

func TestReplacementCalendarDateUsesSavedZone(t *testing.T) {
	now := time.Date(2026, 10, 20, 1, 0, 0, 0, time.UTC)
	if validTransition("2026-10-20", "America/Los_Angeles", now) || !validTransition("2026-10-19", "America/Los_Angeles", now) || !validTransition("0001-01-01", "UTC", now) {
		t.Fatal("transition did not use saved-zone today and supported years")
	}
	for _, date := range []string{"0000-12-31", "2026-02-29", "2026-10-20T00:00:00Z", "2026-1-01", "9999-12-31"} {
		if validTransition(date, "UTC", now) {
			t.Fatal("invalid/future calendar date accepted", date)
		}
	}
}
func TestReplacementSpendingExactSignedAndBounded(t *testing.T) {
	purchase, refund, income := "purchase", "refund", "income"
	rows := []replacementSource{{Currency: "USD", Amount: "10000", Activity: &purchase, Processing: "posted"}, {Currency: "USD", Amount: "-4000", Activity: &refund, Processing: "posted"}, {Currency: "USD", Amount: "10000", Activity: &purchase, Processing: "pending"}, {Currency: "USD", Amount: "10000", Activity: &purchase, Processing: "posted", Excluded: true}, {Currency: "USD", Amount: "-10000", Activity: &income, Processing: "posted"}}
	impact, err := summarizeReplacement(rows)
	if err != nil || impact.SpendingMinor != "6000" || impact.PendingCount != 1 {
		t.Fatal("exact spending eligibility changed")
	}
	_, err = summarizeReplacement([]replacementSource{{Currency: "USD", Amount: "9007199254740991", Activity: &purchase, Processing: "posted"}, {Currency: "USD", Amount: "1", Activity: &purchase, Processing: "posted"}})
	if err == nil {
		t.Fatal("overflow returned successful partial total")
	}
	impact, err = summarizeReplacement([]replacementSource{{Currency: "USD", Amount: "-1", Activity: &purchase, Processing: "posted"}, {Currency: "USD", Amount: "1", Activity: &refund, Processing: "posted"}})
	if err != nil || impact.SpendingMinor != "0" || impact.UnresolvedCount != 2 {
		t.Fatal("invalid sign classified as spending")
	}
}
