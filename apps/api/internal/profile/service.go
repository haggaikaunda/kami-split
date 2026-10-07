// Package profile owns authenticated self-profile reads and independent display-name/appearance updates.
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

// Result exposes only the public profile ID, application display name and appearance.
// Code is READY on success; failure results contain no profile data.
type Result struct{ ID, DisplayName, Appearance, Code string }

// Read loads the current caller independently of membership and group discovery.
func (s *Service) Read(ctx context.Context) Result {
	var result Result
	err := auth.WithActor(ctx, s.db, func(tx pgx.Tx, _ auth.Actor) error {
		return readProfile(ctx, tx, &result)
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
			return readProfile(ctx, tx, &result)
		}
		return nil
	})
	return finish(ctx, result, err)
}

// UpdateAppearance atomically saves only the enabled caller's appearance, guarding
// against stale edits independently of display-name updates. Same-value retries succeed.
func (s *Service) UpdateAppearance(ctx context.Context, appearance, expected string) Result {
	var result Result
	err := auth.WithActor(ctx, s.db, func(tx pgx.Tx, _ auth.Actor) error {
		if err := tx.QueryRow(ctx, `SELECT app.update_my_appearance($1,$2)`, appearance, expected).Scan(&result.Code); err != nil {
			return err
		}
		if result.Code == "READY" {
			return readProfile(ctx, tx, &result)
		}
		return nil
	})
	return finish(ctx, result, err)
}

func readProfile(ctx context.Context, tx pgx.Tx, result *Result) error {
	var raw string
	if err := tx.QueryRow(ctx, `SELECT id::text,display_name,appearance FROM app.my_profile()`).Scan(&raw, &result.DisplayName, &result.Appearance); err != nil {
		return err
	}
	result.ID = ledger.PublicID("Profile", raw)
	result.Code = "READY"
	return nil
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
