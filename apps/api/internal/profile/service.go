// Package profile owns authenticated self-profile reads and display-name updates.
package profile

import (
	"context"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/jackc/pgx/v5"
)

// Service binds profile operations to verified request evidence and a private pool.
type Service struct{ db *database.DB }

// New creates self-profile operations; a nil database returns UNAVAILABLE.
func New(db *database.DB) *Service { return &Service{db: db} }

// Result exposes only the public profile ID and current application display name.
// Code is READY on success; failure results contain no profile data.
type Result struct{ ID, DisplayName, Code string }

// Read loads the current caller independently of membership and group discovery.
func (s *Service) Read(ctx context.Context) Result {
	var result Result
	err := auth.WithActor(ctx, s.db, func(tx pgx.Tx, _ auth.Actor) error {
		var raw string
		if err := tx.QueryRow(ctx, `SELECT id::text,display_name FROM app.viewer_identity() WHERE status='READY'`).Scan(&raw, &result.DisplayName); err != nil {
			return err
		}
		result.ID = ledger.PublicID("Profile", raw)
		result.Code = "READY"
		return nil
	})
	return finish(ctx, result, err)
}

// Update atomically compares the exact previously read name and writes only the
// enabled caller's display name. Same-value retries succeed without another write.
func (s *Service) Update(ctx context.Context, name, expected string) Result {
	var result Result
	err := auth.WithActor(ctx, s.db, func(tx pgx.Tx, _ auth.Actor) error {
		canonical, valid := canonicalName(name)
		if !valid || !utf8.ValidString(expected) || strings.ContainsRune(expected, 0) {
			result.Code = "INVALID_INPUT"
			return nil
		}
		var raw *string
		var saved *string
		if err := tx.QueryRow(ctx, `SELECT status,id::text,display_name FROM app.update_my_profile($1,$2)`, canonical, expected).Scan(&result.Code, &raw, &saved); err != nil {
			return err
		}
		if result.Code == "READY" && raw != nil && saved != nil {
			result.ID = ledger.PublicID("Profile", *raw)
			result.DisplayName = *saved
		}
		return nil
	})
	return finish(ctx, result, err)
}

func canonicalName(name string) (string, bool) {
	if !utf8.ValidString(name) {
		return "", false
	}
	canonical := strings.TrimFunc(name, unicode.IsSpace)
	count := utf8.RuneCountInString(canonical)
	return canonical, count >= 1 && count <= 120 && !strings.ContainsRune(canonical, 0)
}

func finish(ctx context.Context, result Result, err error) Result {
	if err == nil {
		return result
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
