package graph

import (
	"context"

	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph/model"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
)

func mapFinancialSummary(ctx context.Context, summary expense.FinancialSummary) model.GroupFinancialSummaryResult {
	if summary.Error != "" {
		return problem(ctx, expense.Failure(summary.Error))
	}
	return &model.GroupFinancialSummary{TotalSpendMinor: ledger.MinorUnits(summary.TotalSpendMinor), ViewerNetMinor: ledger.MinorUnits(summary.ViewerNetMinor)}
}
