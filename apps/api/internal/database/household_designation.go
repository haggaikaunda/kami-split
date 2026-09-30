package database

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ErrHouseholdDesignationInput identifies malformed command scalars.
var ErrHouseholdDesignationInput = errors.New("invalid household designation input")

// ErrHouseholdDesignationUnavailable indicates an uncertain result or exhausted
// lock discovery. Callers must read fresh state before a different transition.
var ErrHouseholdDesignationUnavailable = errors.New("household designation unavailable")

// HouseholdDesignationInput names the exact stable application pair and version.
// This internal operation is not a public identity directory. PROPOSE and CONSENT
// require canonical FirstUserID < SecondUserID; other actions omit both IDs.
// Actions are READ, PROPOSE, CONSENT, CANCEL and END.
type HouseholdDesignationInput struct {
	Action       string
	Version      int64
	FirstUserID  string
	SecondUserID string
}

// HouseholdDesignationResult reveals no peer identity or account status. State is
// EMPTY, PENDING, ACTIVE, SUSPENDED, ENDED, CANCELLED, CONFLICT or NOT_FOUND.
// Version is the current proposal generation; consent never advances it.
type HouseholdDesignationResult struct {
	State   string `json:"state"`
	Version int64  `json:"version"`
}

// HouseholdDesignation executes an authorized transition under READ COMMITTED.
// Each discovery retry uses a new transaction with canonical user→guard→group
// locks, bounded to three attempts and five seconds. No public transport is added.
func (d *DB) HouseholdDesignation(ctx context.Context, subject string, input HouseholdDesignationInput) (HouseholdDesignationResult, error) {
	switch input.Action {
	case "READ", "PROPOSE", "CONSENT", "CANCEL", "END":
	default:
		return HouseholdDesignationResult{}, ErrHouseholdDesignationInput
	}
	if input.Version < 0 {
		return HouseholdDesignationResult{}, ErrHouseholdDesignationInput
	}
	var first, second any
	if input.Action == "PROPOSE" || input.Action == "CONSENT" {
		if !groupCreationKeyValid(input.FirstUserID) || !groupCreationKeyValid(input.SecondUserID) || input.FirstUserID >= input.SecondUserID {
			return HouseholdDesignationResult{}, ErrHouseholdDesignationInput
		}
		first, second = input.FirstUserID, input.SecondUserID
	} else if input.FirstUserID != "" || input.SecondUserID != "" {
		return HouseholdDesignationResult{}, ErrHouseholdDesignationInput
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result HouseholdDesignationResult
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		err = d.WithIdentity(ctx, subject, func(tx pgx.Tx) error {
			var raw []byte
			if err := tx.QueryRow(ctx, `SELECT app.household_designation($1,$2,$3,$4)`, input.Action, input.Version, first, second).Scan(&raw); err != nil {
				return err
			}
			return json.Unmarshal(raw, &result)
		})
		if err == nil {
			return result, nil
		}
		var failure *pgconn.PgError
		if !errors.As(err, &failure) || failure.Code != "40001" {
			break
		}
	}
	return HouseholdDesignationResult{State: "UNAVAILABLE"}, diagnostic.Wrap(ErrHouseholdDesignationUnavailable, err, "household.designation")
}
