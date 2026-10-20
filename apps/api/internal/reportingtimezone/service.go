// Package reportingtimezone owns the private reporting preference and durable write recovery.
package reportingtimezone

import (
	"context"
	"errors"

	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/jackc/pgx/v5"
)

// Service uses verified request identity and transactional restricted persistence.
type Service struct{ db *database.DB }

// New binds operations to the API pool; no provider or enrollment is required.
func New(db *database.DB) *Service { return &Service{db: db} }

// Result is either a saved zone/version (READY) or a safe code without private data.
// A recovered result is the immutable original outcome, not the current preference.
type Result struct {
	Code     string
	Timezone *string
	Version  *int64
}

// Read returns the enabled caller's current preference, or NOT_INITIALIZED.
func (s *Service) Read(ctx context.Context) Result {
	return s.run(ctx, `SELECT code,timezone,version FROM app.read_reporting_timezone()`)
}

// Recover reauthorizes the caller and returns only their original operation outcome.
// NOT_FOUND does not prove an in-flight write failed; retry the identical attempt.
func (s *Service) Recover(ctx context.Context, kind, attempt string) Result {
	return s.run(ctx, `SELECT code,timezone,version FROM app.read_reporting_timezone_attempt($1,$2::uuid)`, kind, attempt)
}

// Initialize saves a valid device zone once (nil uses UTC). Later devices receive
// the saved value without replacing it. The attempt ID is known before any effect.
func (s *Service) Initialize(ctx context.Context, attempt string, zone *string) Result {
	return s.run(ctx, `SELECT code,timezone,version FROM app.write_reporting_timezone('INITIALIZE',$1::uuid,$2,NULL)`, attempt, zone)
}

// Update compares the independent version, advances it once and atomically saves
// the original result. Identical retries replay; changed-input reuse is rejected.
func (s *Service) Update(ctx context.Context, attempt, zone string, expected int64) Result {
	return s.run(ctx, `SELECT code,timezone,version FROM app.write_reporting_timezone('UPDATE',$1::uuid,$2,$3)`, attempt, zone, expected)
}

func (s *Service) run(ctx context.Context, query string, args ...any) Result {
	var out Result
	err := auth.WithActor(ctx, s.db, func(tx pgx.Tx, _ auth.Actor) error {
		return tx.QueryRow(ctx, query, args...).Scan(&out.Code, &out.Timezone, &out.Version)
	})
	if err == nil {
		return out
	}
	code := "UNAVAILABLE"
	switch {
	case errors.Is(err, auth.Unauthenticated):
		code = "UNAUTHENTICATED"
	case errors.Is(err, auth.Disabled), errors.Is(err, auth.Unprovisioned):
		code = "FORBIDDEN"
	}
	diagnostic.Report(ctx, err)
	return Result{Code: code}
}
