package expense

import (
	"context"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database/expensequery"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"time"
)

func insertExpense(ctx context.Context, tx pgx.Tx, group string, record Record, actor pgtype.UUID, result *Record) error {
	id, _ := rawID(record.ExpenseID, "Expense")
	payer, _ := rawID(record.PayerMembershipID, "Membership")
	creator, _ := rawID(record.CreatorMembershipID, "Membership")
	date, err := time.Parse("2006-01-02", record.EffectiveDate)
	if err != nil {
		return err
	}
	queries := expensequery.New(tx)
	committed, err := queries.InsertExpense(ctx, expensequery.InsertExpenseParams{ID: uuidValue(id), GroupID: uuidValue(group), CreatorID: uuidValue(creator), PayerID: uuidValue(payer), TotalMinor: record.TotalMinor, Currency: record.Currency, Description: record.Description, EffectiveDate: pgtype.Date{Time: date, Valid: true}, Category: record.Category, Note: record.Note, Split: record.Split, Revision: record.Revision})
	if err != nil {
		return err
	}
	result.CommittedAt = committed.Time.UTC().Format("2006-01-02T15:04:05.000000Z")
	for _, allocation := range record.Allocations {
		participant, _ := rawID(allocation.ParticipantID, "Membership")
		if err = queries.InsertAllocation(ctx, expensequery.InsertAllocationParams{ExpenseID: uuidValue(id), GroupID: uuidValue(group), ParticipantID: uuidValue(participant), AmountMinor: allocation.Amount}); err != nil {
			return err
		}
	}
	return queries.InsertAudit(ctx, expensequery.InsertAuditParams{ExpenseID: uuidValue(id), GroupID: uuidValue(group), ActorUserID: actor, CreatorID: uuidValue(creator), CommittedAt: committed})
}
