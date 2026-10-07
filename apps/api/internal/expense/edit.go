package expense

import (
	"cmp"
	"context"
	"encoding/json"
	"math"
	"slices"

	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// RecoverEdit returns the original edit attempt after checking current source
// authorization. Later edits or participant departure do not alter that outcome.
func (s *Service) RecoverEdit(ctx context.Context, groupID, key string) (Outcome, error) {
	return s.recover(ctx, groupID, key, "EDIT_EXPENSE")
}

// Edit atomically replaces one expense version, immutable audit evidence and the
// original operation outcome. Retries precede version and saved-member checks.
func (s *Service) Edit(ctx context.Context, input ledger.EditInput) (Outcome, error) {
	original := input
	input, canonical, hash, err := ledger.NormalizeEdit(input)
	if err != nil {
		return Outcome{}, Failure("INVALID_INPUT")
	}
	original.Description = input.Description
	allocations, fields := ledger.Validate(original.Input)
	group, _ := rawID(input.GroupID, "Group")
	expenseID, _ := rawID(input.ExpenseID, "Expense")
	var saved Record
	in := financialIntent{group: input.GroupID, key: input.Key, kind: "EDIT_EXPENSE", version: "edit-expense-v1", canonical: canonical, hash: hash[:], affected: append(append([]string(nil), input.ParticipantIDs...), input.PayerID), fields: fields, expense: expenseID}
	in.precheck = func(ctx context.Context, tx pgx.Tx) (*Outcome, error) {
		snapshot, e := readSnapshot(ctx, tx, group, PageRequest{First: 1}, &expenseID)
		if e != nil {
			return nil, e
		}
		if len(snapshot.Records) != 1 {
			return nil, Failure("NOT_FOUND")
		}
		saved = snapshot.Records[0]
		// Check the saved involvement, including explicit zero shares, before looking
		// at the replacement. A departed creator alone does not participate here.
		if saved.EditLockReason != "" {
			return &Outcome{Kind: "LOCKED", LockReason: saved.EditLockReason}, nil
		}
		if saved.Version != input.ExpectedVersion {
			return &Outcome{Kind: "CONFLICT", CurrentVersion: saved.Version}, nil
		}
		return nil, nil
	}
	in.apply = func(ctx context.Context, tx pgx.Tx, _ auth.Actor, snapshot Snapshot) (Outcome, error) {
		replacement := saved
		replacement.PayerMembershipID = input.PayerID
		replacement.TotalMinor = input.Total
		replacement.Description = input.Description
		replacement.EffectiveDate = input.EffectiveDate
		replacement.Category = input.Category
		replacement.Note = input.Note
		replacement.Split = input.Split
		replacement.Allocations = allocations
		replacement.Percentages = input.Percentages
		if sameExpenseValues(saved, replacement) {
			return Outcome{Kind: "COMMITTED", Record: &saved, Changed: false}, nil
		}
		if saved.Version == math.MaxInt64 {
			return Outcome{Kind: "VALIDATION", Fields: overflow("expectedVersion")}, nil
		}
		if err := validateReplacement(snapshot, saved, replacement); err != nil {
			return Outcome{Kind: "VALIDATION", Fields: overflow("totalMinor")}, nil
		}
		replacement.Version = saved.Version + 1
		replacement.Revision = snapshot.Revision + 1
		shares := make([]map[string]any, 0, len(allocations))
		for _, a := range allocations {
			raw, _ := rawID(a.ParticipantID, "Membership")
			share := map[string]any{"participant_id": raw, "amount_minor": a.Amount, "percentage_hundredths": nil}
			for _, p := range input.Percentages {
				if p.ParticipantID == a.ParticipantID {
					share["percentage_hundredths"] = p.Hundredths
					break
				}
			}
			shares = append(shares, share)
		}
		encoded, e := json.Marshal(shares)
		if e != nil {
			return Outcome{}, e
		}
		payer, _ := rawID(input.PayerID, "Membership")
		var version int64
		var eventID pgtype.UUID
		var eventTime pgtype.Timestamptz
		e = tx.QueryRow(ctx, `SELECT version,event_id,event_time FROM app.apply_expense_edit($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10::jsonb,$11)`, expenseID, input.ExpectedVersion, payer, input.Total, input.Description, input.EffectiveDate, input.Category, input.Note, input.Split, encoded, replacement.Revision).Scan(&version, &eventID, &eventTime)
		if e != nil {
			return Outcome{}, e
		}
		replacement.Version = version
		return Outcome{Kind: "COMMITTED", Record: &replacement, Changed: true}, nil
	}
	return s.execute(ctx, in)
}

func sameExpenseValues(a, b Record) bool {
	a.Allocations = slices.Clone(a.Allocations)
	b.Allocations = slices.Clone(b.Allocations)
	a.Percentages = slices.Clone(a.Percentages)
	b.Percentages = slices.Clone(b.Percentages)
	sortAllocation := func(a, b ledger.Allocation) int { return cmp.Compare(a.ParticipantID, b.ParticipantID) }
	sortPercentage := func(a, b ledger.Percentage) int { return cmp.Compare(a.ParticipantID, b.ParticipantID) }
	slices.SortFunc(a.Allocations, sortAllocation)
	slices.SortFunc(b.Allocations, sortAllocation)
	slices.SortFunc(a.Percentages, sortPercentage)
	slices.SortFunc(b.Percentages, sortPercentage)
	return a.PayerMembershipID == b.PayerMembershipID && a.TotalMinor == b.TotalMinor && a.Currency == b.Currency && a.Description == b.Description && a.EffectiveDate == b.EffectiveDate && a.Category == b.Category && a.Note == b.Note && a.Split == b.Split && slices.Equal(a.Allocations, b.Allocations) && slices.Equal(a.Percentages, b.Percentages)
}

// replacement arithmetic removes exactly the saved expense before adding its
// correction. Recorded repayments stay in each copied position unchanged.
func validateReplacement(snapshot Snapshot, old, next Record) error {
	total, err := ledger.CheckedAdd(snapshot.Total-old.TotalMinor, next.TotalMinor)
	if err != nil {
		return err
	}
	positions := append([]ledger.Position(nil), snapshot.Positions...)
	for i := range positions {
		p := &positions[i]
		if p.MemberID == old.PayerMembershipID {
			p.Paid -= old.TotalMinor
		}
		for _, a := range old.Allocations {
			if p.MemberID == a.ParticipantID {
				p.Owed -= a.Amount
			}
		}
		if p.MemberID == next.PayerMembershipID {
			p.Paid, err = ledger.CheckedAdd(p.Paid, next.TotalMinor)
			if err != nil {
				return err
			}
		}
		for _, a := range next.Allocations {
			if p.MemberID == a.ParticipantID {
				p.Owed, err = ledger.CheckedAdd(p.Owed, a.Amount)
				if err != nil {
					return err
				}
			}
		}
	}
	_, err = ledger.Balances(total, positions)
	return err
}

func setEditEligibility(record *Record, members []Member) {
	involved := map[string]bool{record.PayerMembershipID: true}
	for _, a := range record.Allocations {
		involved[a.ParticipantID] = true
	}
	record.CanEdit = true
	record.EditLockReason = ""
	for id := range involved {
		found := false
		for _, m := range members {
			if m.ID != id {
				continue
			}
			found = true
			if m.Status != "ACTIVE" {
				record.CanEdit = false
				record.EditLockReason = "FORMER_MEMBER"
				return
			}
			if !m.CanParticipate {
				record.CanEdit = false
				record.EditLockReason = "INELIGIBLE_MEMBER"
			}
		}
		if !found {
			record.CanEdit = false
			record.EditLockReason = "INELIGIBLE_MEMBER"
		}
	}
}
