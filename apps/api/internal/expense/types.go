// Package expense owns authorized expense operations and their transaction boundaries.
package expense

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database/expensequery"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// Member is the minimal authorized historical profile; no peer user IDs escape.
type Member struct {
	ID, DisplayName, Status, Role string
	CanParticipate                bool
}

// Record is an immutable financial record and its original commit provenance.
type Record struct {
	ExpenseID, GroupID, CreatorMembershipID, PayerMembershipID               string
	TotalMinor                                                               int64
	Currency, Description, EffectiveDate, Category, Note, Split, CommittedAt string
	Allocations                                                              []ledger.Allocation
	Revision                                                                 int64
}

// Outcome distinguishes durable commitment/rejection from transient uncertainty.
type Outcome struct {
	Kind, Key string
	Record    *Record
	Fields    []ledger.FieldProblem
}

// Failure is a safe application failure code, never a database diagnostic.
type Failure string

// Error exposes only the safe application code, never a database diagnostic.
func (f Failure) Error() string { return string(f) }

// Service uses only verified identity and transaction-local authorized statements.
type Service struct{ db *database.DB }

// New constructs expense operations with a fixed database dependency. A nil
// database supports health-only startup; authenticated operations remain unavailable.
func New(db *database.DB) *Service { return &Service{db: db} }

func uuidValue(raw string) pgtype.UUID { var id pgtype.UUID; _ = id.Scan(raw); return id }
func rawID(value, kind string) (string, error) {
	raw, err := ledger.ParseID(value, kind)
	if err != nil {
		return "", Failure("INVALID_INPUT")
	}
	return raw, nil
}
func safeError(err error) error {
	if err == nil {
		return nil
	}
	var failure Failure
	if errors.As(err, &failure) {
		return failure
	}
	var authError auth.Outcome
	if errors.As(err, &authError) {
		if authError == auth.Disabled || authError == auth.Unprovisioned {
			return Failure("NOT_FOUND")
		}
		if authError == auth.Unavailable {
			return Failure("UNAVAILABLE")
		}
		return authError
	}
	var pgerr *pgconn.PgError
	if errors.As(err, &pgerr) && pgerr.Code == "42501" {
		return Failure("NOT_FOUND")
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return Failure("NOT_FOUND")
	}
	return Failure("UNAVAILABLE")
}
func (s *Service) transaction(ctx context.Context, fn func(pgx.Tx, auth.Actor) error) error {
	// Preserve domain/permission outcomes through WithActor's intentionally safe
	// database error boundary; failed callbacks still cause transaction rollback.
	var operationErr error
	err := auth.WithActor(ctx, s.db, func(tx pgx.Tx, actor auth.Actor) error { operationErr = fn(tx, actor); return operationErr })
	if operationErr != nil {
		return safeError(operationErr)
	}
	return safeError(err)
}
func lookup(ctx context.Context, tx pgx.Tx, group, key string) (Outcome, []byte, []byte, error) {
	var result Outcome
	row, err := expensequery.New(tx).ExpenseOperation(ctx, expensequery.ExpenseOperationParams{GroupID: uuidValue(group), Key: uuidValue(key)})
	if err != nil {
		return result, nil, nil, err
	}
	err = json.Unmarshal(row.Outcome, &result)
	return result, row.Canonical, row.CanonicalHash, err
}
