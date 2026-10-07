package graph

import (
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph/model"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
)

func mapEditOutcome(out expense.Outcome) model.ExpenseEditResult {
	switch out.Kind {
	case "COMMITTED":
		committed := mapOutcome(out).(*model.ExpenseCommitted)
		return &model.ExpenseEditCommitted{Key: committed.Key, Record: committed.Record, Version: ledger.Revision(out.Record.Version), Changed: out.Changed}
	case "CONFLICT":
		return &model.ExpenseEditConflict{Key: ledger.OperationKey(out.Key), CurrentVersion: ledger.Revision(out.CurrentVersion)}
	case "LOCKED":
		return &model.ExpenseEditLocked{Key: ledger.OperationKey(out.Key), Reason: model.ExpenseEditLockReason(out.LockReason)}
	default:
		return mapOutcome(out).(model.ExpenseEditResult)
	}
}
