package expense

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database/expensequery"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Recover reauthorizes current access before returning durable attempt values.
func (s *Service) Recover(ctx context.Context, groupID, key string) (Outcome, error) {
	var operationKey ledger.OperationKey
	if operationKey.UnmarshalGQL(key) != nil {
		return Outcome{}, Failure("INVALID_INPUT")
	}
	group, err := rawID(groupID, "Group")
	if err != nil {
		return Outcome{}, err
	}
	var out Outcome
	err = s.transaction(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		if _, e := tx.Exec(ctx, `SELECT app.lock_group_read($1)`, group); e != nil {
			return e
		}
		var e error
		out, _, _, e = lookup(ctx, tx, group, key)
		if errors.Is(e, pgx.ErrNoRows) {
			out = Outcome{Kind: "NOT_OBSERVED", Key: key}
			return nil
		}
		return e
	})
	if errors.Is(err, Failure("UNAVAILABLE")) {
		diagnostic.Report(ctx, err)
		return Outcome{Kind: "UNKNOWN", Key: key}, nil
	}
	return out, err
}

// Create commits allocations, attribution and recoverable result together. The
// first transaction checks historical outcomes before locking new participants;
// new work restarts from user-lock order and checks the attempt again.
func (s *Service) Create(ctx context.Context, input ledger.Input) (Outcome, error) {
	original := input
	input, canonical, hash, err := ledger.Normalize(input)
	if err != nil {
		return Outcome{}, Failure("INVALID_INPUT")
	}
	group, _ := rawID(input.GroupID, "Group")
	var out Outcome
	found := false
	err = s.transaction(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		if _, e := tx.Exec(ctx, `SELECT app.lock_group_read($1)`, group); e != nil {
			return e
		}
		previous, c, h, e := lookup(ctx, tx, group, input.Key)
		if errors.Is(e, pgx.ErrNoRows) {
			return nil
		}
		if e != nil {
			return e
		}
		found = true
		out = compare(previous, c, h, canonical, hash[:], input.Key)
		return nil
	})
	if errors.Is(err, Failure("UNAVAILABLE")) {
		diagnostic.Report(ctx, err)
		return Outcome{Kind: "UNKNOWN", Key: input.Key}, nil
	}
	if err != nil || found {
		return out, err
	}
	original.Description = input.Description
	allocations, fields := ledger.Validate(original)
	err = s.transaction(ctx, func(tx pgx.Tx, actor auth.Actor) error {
		// Lock all same-group identities (including currently ineligible ones) in
		// user order, then the group. Eligibility is checked only after receipt lookup.
		affected := append(append([]string(nil), input.ParticipantIDs...), input.PayerID)
		ids := make([]pgtype.UUID, 0, len(affected))
		for _, id := range affected {
			raw, e := rawID(id, "Membership")
			if e != nil {
				return e
			}
			ids = append(ids, uuidValue(raw))
		}
		if _, e := tx.Exec(ctx, `SELECT app.lock_expense_write($1,$2)`, group, ids); e != nil {
			return e
		}
		previous, c, h, e := lookup(ctx, tx, group, input.Key)
		if e == nil {
			out = compare(previous, c, h, canonical, hash[:], input.Key)
			return nil
		}
		if !errors.Is(e, pgx.ErrNoRows) {
			return e
		}
		var eligible bool
		if e = tx.QueryRow(ctx, `SELECT NOT EXISTS(SELECT FROM unnest($2::uuid[]) a(id) WHERE NOT EXISTS(SELECT FROM app.group_members($1) m WHERE m.id=a.id AND m.can_participate))`, group, ids).Scan(&eligible); e != nil {
			return e
		}
		if !eligible {
			fields = append(fields, ledger.FieldProblem{Path: []string{"input", "participantIds"}, Code: "INVALID_PARTICIPANT", Message: "Select eligible group members."})
		}
		out = Outcome{Kind: "VALIDATION", Key: input.Key, Fields: fields}
		if len(fields) == 0 {
			snapshot, e := readSnapshot(ctx, tx, group, PageRequest{First: 1}, nil)
			if e != nil {
				return e
			}
			if snapshot.BalanceError != "" || snapshot.Revision == math.MaxInt64 || snapshot.Total > math.MaxInt64-input.Total {
				out.Fields = []ledger.FieldProblem{{Path: []string{"input", "totalMinor"}, Code: "AMOUNT_OVERFLOW", Message: "The group amount limit would be exceeded."}}
			} else {
				record := Record{ExpenseID: ledger.PublicID("Expense", uuid.NewString()), GroupID: input.GroupID, CreatorMembershipID: snapshot.ViewerMembershipID, PayerMembershipID: input.PayerID, TotalMinor: input.Total, Currency: input.Currency, Description: input.Description, EffectiveDate: input.EffectiveDate, Category: input.Category, Note: input.Note, Split: input.Split, Allocations: allocations, Revision: snapshot.Revision + 1}
				// Nonnegative paid/owed totals cannot exceed complete group spending.
				if e = insertExpense(ctx, tx, group, record, actor.ID, &record); e != nil {
					return e
				}
				out = Outcome{Kind: "COMMITTED", Key: input.Key, Record: &record}
			}
		}
		payload, e := json.Marshal(out)
		if e != nil {
			return e
		}
		var expenseID pgtype.UUID
		if out.Record != nil {
			raw, _ := rawID(out.Record.ExpenseID, "Expense")
			expenseID = uuidValue(raw)
		}
		e = expensequery.New(tx).StoreExpenseOperation(ctx, expensequery.StoreExpenseOperationParams{ActorUserID: actor.ID, GroupID: uuidValue(group), Key: uuidValue(input.Key), Canonical: canonical, CanonicalHash: hash[:], ExpenseID: expenseID, Outcome: payload})
		return e
	})
	if err != nil {
		if errors.Is(err, Failure("UNAVAILABLE")) {
			diagnostic.Report(ctx, err)
			return Outcome{Kind: "UNKNOWN", Key: input.Key}, nil
		}
		return Outcome{}, err
	}
	return out, nil
}
func compare(old Outcome, canonical, hash, wantCanonical, wantHash []byte, key string) Outcome {
	if !bytes.Equal(canonical, wantCanonical) || !bytes.Equal(hash, wantHash) {
		return Outcome{Kind: "MISMATCH", Key: key}
	}
	return old
}
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
