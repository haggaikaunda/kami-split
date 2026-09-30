// Package group owns identity-scoped group creation and recovery operations.
package group

import (
	"context"
	"errors"

	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/jackc/pgx/v5"
)

// Service binds group operations to verified request identity, never caller IDs.
type Service struct{ db *database.DB }

// New constructs group operations; nil database keeps health-only startup safe.
func New(db *database.DB) *Service { return &Service{db: db} }

// Create commits a new group or recovers the original durable creation result.
// SQL repeats current authorization under locks and reauthorizes completed results.
func (s *Service) Create(ctx context.Context, input database.GroupCreationInput) (database.GroupCreationResult, error) {
	subject, err := s.subject(ctx)
	if err != nil {
		return database.GroupCreationResult{}, err
	}
	out, err := s.db.CreateGroup(ctx, subject, input)
	return out, safeError(err)
}

// Recover reads only the current creator's key; missing results never prove noncommit.
func (s *Service) Recover(ctx context.Context, key string) (database.GroupCreationResult, error) {
	subject, err := s.subject(ctx)
	if err != nil {
		return database.GroupCreationResult{}, err
	}
	out, err := s.db.GroupCreationOperation(ctx, subject, key)
	return out, safeError(err)
}
func (s *Service) subject(ctx context.Context) (string, error) {
	err := auth.WithActor(ctx, s.db, func(pgx.Tx, auth.Actor) error { return nil })
	if err != nil {
		return "", safeError(err)
	}
	return auth.VerifiedSubject(ctx)
}
func safeError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, database.ErrGroupCreationInput):
		return expense.Failure("INVALID_INPUT")
	case errors.Is(err, database.ErrGroupCreationForbidden):
		return expense.Failure("FORBIDDEN")
	case errors.Is(err, auth.Disabled), errors.Is(err, auth.Unprovisioned):
		return expense.Failure("NOT_FOUND")
	}
	if operation, ok := diagnostic.Operation(err); ok {
		return diagnostic.Wrap(expense.Failure("UNAVAILABLE"), err, operation)
	}
	return expense.Failure("UNAVAILABLE")
}
