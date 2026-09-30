package graph

import (
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph/model"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
)

func mapRepayment(r expense.RepaymentRecord, m map[string]*model.Membership) *model.Repayment {
	return &model.Repayment{ID: r.RepaymentID, GroupID: r.GroupID, Creator: m[r.CreatorMembershipID], Sender: m[r.SenderMembershipID], Recipient: m[r.RecipientMembershipID], AmountMinor: ledger.MinorUnits(r.AmountMinor), Currency: model.Currency(r.Currency), EffectiveDate: ledger.Date(r.EffectiveDate), Note: r.Note, CreatedAt: ledger.DateTime(r.CommittedAt), Revision: ledger.Revision(r.Revision)}
}
func mapRepaymentOutcome(out expense.Outcome) model.RecordRepaymentResult {
	if out.Kind != "COMMITTED" {
		return mapOutcome(out).(model.RecordRepaymentResult)
	}
	r := out.Repayment
	return &model.RepaymentCommitted{Key: ledger.OperationKey(out.Key), Record: &model.RepaymentOperationRecord{RepaymentID: r.RepaymentID, GroupID: r.GroupID, CreatorMembershipID: r.CreatorMembershipID, SenderMembershipID: r.SenderMembershipID, RecipientMembershipID: r.RecipientMembershipID, AmountMinor: ledger.MinorUnits(r.AmountMinor), Currency: model.Currency(r.Currency), EffectiveDate: ledger.Date(r.EffectiveDate), Note: r.Note, CommittedAt: ledger.DateTime(r.CommittedAt), Revision: ledger.Revision(r.Revision)}}
}
