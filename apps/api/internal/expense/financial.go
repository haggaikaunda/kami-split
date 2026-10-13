package expense

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database/expensequery"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// financialIntent provides the differing validation/effect while execute owns
// the single authorization, retry and atomic-commit protocol for both writes.
type financialIntent struct {
	group, key, kind, version string
	canonical, hash           []byte
	affected                  []string
	expense                   string
	precheck                  func(context.Context, pgx.Tx) (*Outcome, error)
	fields                    []ledger.FieldProblem
	apply                     func(context.Context, pgx.Tx, auth.Actor, Snapshot) (Outcome, error)
}

// Recover reauthorizes current actor/group access before returning an expense attempt.
func (s *Service) Recover(ctx context.Context, groupID, key string) (Outcome, error) {
	return s.recover(ctx, groupID, key, "CREATE_EXPENSE")
}

// RecoverRepayment returns the original transfer outcome under current access.
// A missing result never proves that an in-flight transaction cannot commit.
func (s *Service) RecoverRepayment(ctx context.Context, groupID, key string) (Outcome, error) {
	return s.recover(ctx, groupID, key, "RECORD_REPAYMENT")
}

func (s *Service) recover(ctx context.Context, groupID, key, kind string) (Outcome, error) {
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
		out, _, _, e = lookup(ctx, tx, group, key, kind)
		if errors.Is(e, pgx.ErrNoRows) {
			out = Outcome{Kind: "NOT_OBSERVED", Key: key}
			return nil
		}
		return e
	})
	return financialResult(ctx, out, key, err)
}

func financialResult(ctx context.Context, out Outcome, key string, err error) (Outcome, error) {
	if errors.Is(err, Failure("UNAVAILABLE")) {
		diagnostic.Report(ctx, err)
		return Outcome{Kind: "UNKNOWN", Key: key}, nil
	}
	return out, err
}
func compare(old Outcome, canonical, hash, wantCanonical, wantHash []byte, key string) Outcome {
	if !bytes.Equal(canonical, wantCanonical) || !bytes.Equal(hash, wantHash) {
		return Outcome{Kind: "MISMATCH", Key: key}
	}
	return old
}
func overflow(field string) []ledger.FieldProblem {
	return []ledger.FieldProblem{{Path: []string{"input", field}, Code: "AMOUNT_OVERFLOW", Message: "The group amount limit would be exceeded."}}
}

func (s *Service) execute(ctx context.Context, in financialIntent) (Outcome, error) {
	group, _ := rawID(in.group, "Group")
	var out Outcome
	found := false
	err := s.transaction(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		if _, e := tx.Exec(ctx, `SELECT app.lock_group_read($1)`, group); e != nil {
			return e
		}
		old, c, h, e := lookup(ctx, tx, group, in.key, in.kind)
		if errors.Is(e, pgx.ErrNoRows) {
			return nil
		}
		if e != nil {
			return e
		}
		found = true
		out = compare(old, c, h, in.canonical, in.hash, in.key)
		return nil
	})
	if err != nil || found {
		return financialResult(ctx, out, in.key, err)
	}
	ids := make([]pgtype.UUID, 0, len(in.affected))
	for _, id := range in.affected {
		raw, e := rawID(id, "Membership")
		if e != nil {
			return Outcome{}, e
		}
		ids = append(ids, uuidValue(raw))
	}
	for attempt := 0; attempt < 3; attempt++ {
		err = s.transaction(ctx, func(tx pgx.Tx, actor auth.Actor) error {
			// Restart in user-before-group order, including ineligible historical members.
			var lockErr error
			if in.expense != "" {
				lockErr = func() error {
					_, e := tx.Exec(ctx, `SELECT app.lock_expense_edit($1,$2,$3)`, group, in.expense, ids)
					return e
				}()
			} else {
				_, lockErr = tx.Exec(ctx, `SELECT app.lock_expense_write($1,$2)`, group, ids)
			}
			if lockErr != nil {
				return lockErr
			}
			old, c, h, e := lookup(ctx, tx, group, in.key, in.kind)
			if e == nil {
				out = compare(old, c, h, in.canonical, in.hash, in.key)
				return nil
			}
			if !errors.Is(e, pgx.ErrNoRows) {
				return e
			}
			var checked *Outcome
			if in.precheck != nil {
				checked, e = in.precheck(ctx, tx)
				if e != nil {
					return e
				}
			}
			fields := append([]ledger.FieldProblem(nil), in.fields...)
			var eligible bool
			if e = tx.QueryRow(ctx, `SELECT NOT EXISTS(
  SELECT
  FROM unnest($2::uuid[]) a(id)
  WHERE NOT EXISTS(
    SELECT
    FROM app.group_members($1) m
    WHERE m.id = a.id
    AND m.can_participate
  )
)`, group, ids).Scan(&eligible); e != nil {
				return e
			}
			if !eligible {
				path := []string{"input"}
				if in.kind == "CREATE_EXPENSE" {
					path = append(path, "participantIds")
				}
				fields = append(fields, ledger.FieldProblem{Path: path, Code: "INVALID_PARTICIPANT", Message: "Select eligible group members."})
			}
			out = Outcome{Kind: "VALIDATION", Key: in.key, Fields: fields}
			if checked != nil {
				out = *checked
				out.Key = in.key
			} else if len(fields) == 0 {
				snapshot, e := readSnapshot(ctx, tx, group, PageRequest{First: 1}, nil)
				if e != nil {
					return e
				}
				if snapshot.BalanceError != "" || snapshot.Revision == math.MaxInt64 {
					out.Fields = overflow("groupId")
				} else {
					out, e = in.apply(ctx, tx, actor, snapshot)
					if e != nil {
						return e
					}
					out.Key = in.key
				}
			}
			payload, e := json.Marshal(out)
			if e != nil {
				return e
			}
			var expenseID, repaymentID pgtype.UUID
			if out.Record != nil {
				raw, _ := rawID(out.Record.ExpenseID, "Expense")
				expenseID = uuidValue(raw)
			}
			if out.Repayment != nil {
				raw, _ := rawID(out.Repayment.RepaymentID, "Repayment")
				repaymentID = uuidValue(raw)
			}
			return expensequery.New(tx).StoreFinancialOperation(ctx, expensequery.StoreFinancialOperationParams{ActorUserID: actor.ID, GroupID: uuidValue(group), OperationKind: in.kind, Key: uuidValue(in.key), CanonicalVersion: in.version, Canonical: in.canonical, CanonicalHash: in.hash, ExpenseID: expenseID, RepaymentID: repaymentID, Outcome: payload})
		})
		var driver *pgconn.PgError
		if !errors.As(err, &driver) || driver.Code != "40001" {
			break
		}
		// A serialization rollback has no committed effect. Restart the complete
		// lock/receipt protocol using exactly the same canonical attempt.
	}
	return financialResult(ctx, out, in.key, err)
}

// Create commits expense, allocation, audit and result together using shared
// financial revisions and complete post-effect bounds, including repayments.
func (s *Service) Create(ctx context.Context, input ledger.Input) (Outcome, error) {
	original := input
	input, canonical, hash, err := ledger.Normalize(input)
	if err != nil {
		return Outcome{}, Failure("INVALID_INPUT")
	}
	original.Description = input.Description
	allocations, fields := ledger.Validate(original)
	affected := append(append([]string(nil), input.ParticipantIDs...), input.PayerID)
	in := financialIntent{group: input.GroupID, key: input.Key, kind: "CREATE_EXPENSE", version: ledger.CreateVersion(input), canonical: canonical, hash: hash[:], affected: affected, fields: fields}
	in.apply = func(ctx context.Context, tx pgx.Tx, actor auth.Actor, snapshot Snapshot) (Outcome, error) {
		total, e := ledger.CheckedAdd(snapshot.Total, input.Total)
		candidate := append([]ledger.Position(nil), snapshot.Positions...)
		if e == nil {
			for i := range candidate {
				p := &candidate[i]
				if p.MemberID == input.PayerID {
					p.Paid, e = ledger.CheckedAdd(p.Paid, input.Total)
					if e != nil {
						break
					}
				}
				for _, a := range allocations {
					if a.ParticipantID == p.MemberID {
						p.Owed, e = ledger.CheckedAdd(p.Owed, a.Amount)
						if e != nil {
							break
						}
					}
				}
				if e != nil {
					break
				}
			}
		}
		if e == nil {
			_, e = ledger.Balances(total, candidate)
		}
		if e != nil {
			return Outcome{Kind: "VALIDATION", Fields: overflow("totalMinor")}, nil
		}
		record := Record{ExpenseID: ledger.PublicID("Expense", uuid.NewString()), GroupID: input.GroupID, CreatorMembershipID: snapshot.ViewerMembershipID, PayerMembershipID: input.PayerID, TotalMinor: input.Total, Currency: input.Currency, Description: input.Description, EffectiveDate: input.EffectiveDate, Category: input.Category, Note: input.Note, Split: input.Split, Allocations: allocations, Percentages: input.Percentages, Revision: snapshot.Revision + 1, Version: 1, CanEdit: true}
		group, _ := rawID(input.GroupID, "Group")
		if e = insertExpense(ctx, tx, group, record, actor.ID, &record); e != nil {
			return Outcome{}, e
		}
		return Outcome{Kind: "COMMITTED", Record: &record}, nil
	}
	return s.execute(ctx, in)
}
