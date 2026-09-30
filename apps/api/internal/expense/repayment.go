package expense

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database/expensequery"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// RecordRepayment records an actual transfer, including overpayments, by any
// currently authorized active member. It never moves money or synthesizes debts.
func (s *Service) RecordRepayment(ctx context.Context, input ledger.RepaymentInput) (Outcome, error) {
	input, canonical, hash, err := ledger.NormalizeRepayment(input)
	if err != nil {
		return Outcome{}, Failure("INVALID_INPUT")
	}
	in := financialIntent{group: input.GroupID, key: input.Key, kind: "RECORD_REPAYMENT", version: "record-repayment-v1", canonical: canonical, hash: hash[:], affected: []string{input.SenderID, input.RecipientID}, fields: ledger.ValidateRepayment(input)}
	in.apply = func(ctx context.Context, tx pgx.Tx, actor auth.Actor, snapshot Snapshot) (Outcome, error) {
		candidate := append([]ledger.Position(nil), snapshot.Positions...)
		var e error
		for i := range candidate {
			p := &candidate[i]
			if p.MemberID == input.SenderID {
				p.Sent, e = ledger.CheckedAdd(p.Sent, input.Amount)
			}
			if e != nil {
				break
			}
			if p.MemberID == input.RecipientID {
				p.Received, e = ledger.CheckedAdd(p.Received, input.Amount)
			}
			if e != nil {
				break
			}
		}
		if e == nil {
			_, e = ledger.Balances(snapshot.Total, candidate)
		}
		if e != nil {
			return Outcome{Kind: "VALIDATION", Fields: overflow("amountMinor")}, nil
		}
		record := RepaymentRecord{RepaymentID: ledger.PublicID("Repayment", uuid.NewString()), GroupID: input.GroupID, CreatorMembershipID: snapshot.ViewerMembershipID, SenderMembershipID: input.SenderID, RecipientMembershipID: input.RecipientID, AmountMinor: input.Amount, Currency: input.Currency, EffectiveDate: input.EffectiveDate, Note: input.Note, Revision: snapshot.Revision + 1}
		if e = insertRepayment(ctx, tx, actor.ID, &record); e != nil {
			return Outcome{}, e
		}
		return Outcome{Kind: "COMMITTED", Repayment: &record}, nil
	}
	return s.execute(ctx, in)
}

func insertRepayment(ctx context.Context, tx pgx.Tx, actor pgtype.UUID, r *RepaymentRecord) error {
	raw := func(id, kind string) pgtype.UUID { v, _ := rawID(id, kind); return uuidValue(v) }
	date, err := time.Parse("2006-01-02", r.EffectiveDate)
	if err != nil {
		return err
	}
	q := expensequery.New(tx)
	id, group, creator := raw(r.RepaymentID, "Repayment"), raw(r.GroupID, "Group"), raw(r.CreatorMembershipID, "Membership")
	stamp, err := q.InsertRepayment(ctx, expensequery.InsertRepaymentParams{ID: id, GroupID: group, CreatorID: creator, SenderID: raw(r.SenderMembershipID, "Membership"), RecipientID: raw(r.RecipientMembershipID, "Membership"), AmountMinor: r.AmountMinor, Currency: r.Currency, EffectiveDate: pgtype.Date{Time: date, Valid: true}, Note: r.Note, Revision: r.Revision})
	if err != nil {
		return err
	}
	r.CommittedAt = stamp.Time.UTC().Format("2006-01-02T15:04:05.000000Z")
	return q.InsertRepaymentAudit(ctx, expensequery.InsertRepaymentAuditParams{RepaymentID: id, GroupID: group, ActorUserID: actor, CreatorID: creator, CommittedAt: stamp})
}
