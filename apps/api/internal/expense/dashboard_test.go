package expense

import (
	"math"
	"testing"
)

func TestDashboardTotalsPreserveOriginalSpacesAndExactBounds(t *testing.T) {
	space := func(net, total, count int64) DashboardSpace {
		return DashboardSpace{ViewerNet: &net, Snapshot: Snapshot{Total: total}, ExpenseCount: count}
	}
	cases := []struct {
		name                    string
		spaces                  []DashboardSpace
		net, open, total, count int64
		overflow                bool
	}{
		{"source breakdown", []DashboardSpace{space(-2000, 2000, 1), space(2000, 2000, 1), space(-500, 500, 1)}, -500, 3, 4500, 3, false},
		{"cancellation does not settle", []DashboardSpace{space(-2000, 2000, 1), space(2000, 2000, 1)}, 0, 2, 4000, 2, false},
		{"exact above JS range", []DashboardSpace{space(9007199254740993, 9007199254740993, 1)}, 9007199254740993, 1, 9007199254740993, 1, false},
		{"expense overflow", []DashboardSpace{space(0, math.MaxInt64, 1), space(0, 1, 1)}, 0, 0, 0, 0, true},
		{"net overflow", []DashboardSpace{space(math.MaxInt64, 0, 1), space(1, 0, 1)}, 0, 0, 0, 0, true},
		{"count overflow", []DashboardSpace{space(0, 0, math.MaxInt64), space(0, 0, 1)}, 0, 0, 0, 0, true},
		{"unavailable required row", []DashboardSpace{{}}, 0, 0, 0, 0, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := dashboardTotals(c.spaces)
			if c.overflow {
				if got != nil {
					t.Fatal(got)
				}
				return
			}
			if got == nil || got.ViewerNetMinor != c.net || got.OpenBalanceCount != c.open || got.TotalSharedExpenseMinor != c.total || got.TotalSharedExpenseCount != c.count || got.ActiveSpaceCount != int64(len(c.spaces)) {
				t.Fatalf("got %+v", got)
			}
		})
	}
}
