package expense

import "testing"

func TestFinancialSummaryExactPersonalNetAndBounds(t *testing.T) {
	for _, tc := range []struct {
		name, total, paid, owed, sent, received string
		spend, net                              int64
		error                                   string
	}{
		{name: "empty", total: "0", paid: "0", owed: "0", sent: "0", received: "0"},
		{name: "owing", total: "1000", paid: "0", owed: "334", sent: "10", received: "0", spend: 1000, net: -324},
		{name: "wide intermediate", total: "9223372036854775807", paid: "9223372036854775807", owed: "0", sent: "1", received: "1", spend: 9223372036854775807, net: 9223372036854775807},
		{name: "beyond JS precision", total: "9007199254740993", paid: "9007199254740993", owed: "0", sent: "0", received: "0", spend: 9007199254740993, net: 9007199254740993},
		{name: "total overflow", total: "9223372036854775808", paid: "0", owed: "0", sent: "0", received: "0", error: "AMOUNT_OVERFLOW"},
		{name: "net overflow", total: "9223372036854775807", paid: "9223372036854775807", owed: "0", sent: "1", received: "0", error: "AMOUNT_OVERFLOW"},
		{name: "negative bound", total: "1", paid: "0", owed: "9223372036854775807", sent: "0", received: "1", error: "AMOUNT_OVERFLOW"},
		{name: "invalid", total: "invalid", paid: "0", owed: "0", sent: "0", received: "0", error: "AMOUNT_OVERFLOW"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := financialSummary(tc.total, tc.paid, tc.owed, tc.sent, tc.received)
			if got.TotalSpendMinor != tc.spend || got.ViewerNetMinor != tc.net || got.Error != tc.error {
				t.Fatalf("summary = %+v, want spend=%d net=%d error=%q", got, tc.spend, tc.net, tc.error)
			}
		})
	}
}
