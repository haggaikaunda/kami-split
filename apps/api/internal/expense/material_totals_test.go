package expense

import (
	"math"
	"testing"
)

func TestMaterialDashboardTotalsSeparateExpenseFlowsFromNet(t *testing.T) {
	net := int64(0)
	spaces := []DashboardSpace{{ViewerNet: &net, ViewerPaid: 9007199254740993, ViewerShare: 700, Snapshot: Snapshot{Total: 9007199254740993}}}
	totals := dashboardTotals(spaces)
	if totals == nil || totals.ViewerPaidMinor != 9007199254740993 || totals.ViewerShareMinor != 700 || totals.ViewerNetMinor != 0 {
		t.Fatalf("expense flows lost: %+v", totals)
	}
	for _, field := range []string{"share", "paid"} {
		a, b := spaces[0], spaces[0]
		a.Snapshot.Total = 0
		b.Snapshot.Total = 0
		if field == "share" {
			a.ViewerShare = math.MaxInt64
			b.ViewerShare = 1
		} else {
			a.ViewerPaid = math.MaxInt64
			b.ViewerPaid = 1
		}
		if dashboardTotals([]DashboardSpace{a, b}) != nil {
			t.Fatalf("partial total on %s overflow", field)
		}
	}
}

func TestMaterialViewRejectsAggregateOverflowWithoutPartialRows(t *testing.T) {
	for _, field := range []string{"share", "paid", "category total", "category share", "category count"} {
		wire := viewWire{Total: "1", Count: "1", ViewerShare: "0", ViewerPaid: "0"}
		wire.Categories = append(wire.Categories, struct{ Category, Total, ViewerShare, Count string }{"HOME", "1", "0", "1"})
		overflow := "9223372036854775808"
		switch field {
		case "share":
			wire.ViewerShare = overflow
		case "paid":
			wire.ViewerPaid = overflow
		case "category total":
			wire.Categories[0].Total = overflow
		case "category share":
			wire.Categories[0].ViewerShare = overflow
		case "category count":
			wire.Categories[0].Count = overflow
		}
		got, err := decodeView(wire, ExpenseViewRequest{First: 1}, nil, nil, nil)
		if err == nil || got.Total != 0 || len(got.Categories) != 0 {
			t.Fatalf("%s returned partial result: %+v, %v", field, got, err)
		}
	}
}
