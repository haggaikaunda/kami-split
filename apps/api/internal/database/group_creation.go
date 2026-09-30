package database

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// ErrGroupCreationInput indicates malformed scalars, which never reserve a key.
var ErrGroupCreationInput = errors.New("invalid group creation input")

// ErrGroupCreationForbidden indicates missing current linked creator authority.
var ErrGroupCreationForbidden = errors.New("group creation forbidden")

// ErrGroupCreationUnavailable means the outcome is uncertain; retry only the
// identical operation key and input or query its durable result.
var ErrGroupCreationUnavailable = errors.New("group creation unavailable")

// GroupTripInput contains date-only Gregorian values; destination is preserved.
// Its zero destination also represents an absent or null destination on the wire.
type GroupTripInput struct {
	Destination string `json:"destination"`
	StartDate   string `json:"startDate"`
	EndDate     string `json:"endDate"`
}

// GroupCreationInput has no actor, currency, ownership or household controls.
// Kind is ORDINARY or TRIP; a nil Trip is required for ordinary creation.
type GroupCreationInput struct {
	OperationKey string
	Name         string
	Kind         string
	Trip         *GroupTripInput
}

// GroupCreationFieldError is a durable domain rejection, safe to present publicly.
type GroupCreationFieldError struct {
	Field string `json:"field"`
	Code  string `json:"code"`
}

// GroupCreationResult identifies the original creation, never current metadata.
// State is COMPLETED, REJECTED, NOT_STARTED, NOT_FOUND, OPERATION_CONFLICT, or
// UNAVAILABLE. NOT_STARTED does not prove that an in-flight call cannot commit.
// Only COMPLETED contains IDs. FieldErrors are present only for REJECTED.
type GroupCreationResult struct {
	State             string                    `json:"state"`
	GroupID           string                    `json:"groupId"`
	OwnerMembershipID string                    `json:"ownerMembershipId"`
	FieldErrors       []GroupCreationFieldError `json:"fieldErrors"`
	CreatedAt         time.Time                 `json:"createdAt"`
}

// CreateGroup atomically creates an ordinary/trip group and durable receipt under
// a previously verified subject. SQL repeats validation and authorization using
// user→installation→attempt locks. A completed result is checked in a separate
// ordinary authorized group read after commit, avoiding attempt→group lock order.
// No caller-owned transaction may surround this operation.
func (d *DB) CreateGroup(ctx context.Context, subject string, input GroupCreationInput) (GroupCreationResult, error) {
	if err := validateGroupCreationScalars(input); err != nil {
		return GroupCreationResult{}, err
	}
	var trip any
	if input.Trip != nil {
		encoded, err := json.Marshal(input.Trip)
		if err != nil {
			return GroupCreationResult{}, ErrGroupCreationInput
		}
		trip = string(encoded)
	}
	var result GroupCreationResult
	err := d.WithIdentity(ctx, subject, func(tx pgx.Tx) error {
		return scanGroupCreation(ctx, tx, `SELECT app.create_group($1,$2,$3,$4::jsonb)`, &result, input.OperationKey, input.Name, input.Kind, trip)
	})
	if err != nil {
		return groupCreationFailure(err)
	}
	return d.authorizeGroupCreationResult(ctx, subject, input.OperationKey, result)
}

// GroupCreationOperation looks up only the current designated identity's key.
// It retains no privileged recovery exception after departure or grant loss and
// does not wait for an uncommitted attempt; that observation is NOT_STARTED.
func (d *DB) GroupCreationOperation(ctx context.Context, subject, operationKey string) (GroupCreationResult, error) {
	if !groupCreationKeyValid(operationKey) {
		return GroupCreationResult{}, ErrGroupCreationInput
	}
	var result GroupCreationResult
	err := d.WithIdentity(ctx, subject, func(tx pgx.Tx) error {
		return scanGroupCreation(ctx, tx, `SELECT app.group_creation_operation($1)`, &result, operationKey)
	})
	if err != nil {
		return groupCreationFailure(err)
	}
	return d.authorizeGroupCreationResult(ctx, subject, operationKey, result)
}

func (d *DB) authorizeGroupCreationResult(ctx context.Context, subject, key string, result GroupCreationResult) (GroupCreationResult, error) {
	if result.State != "COMPLETED" {
		return result, nil
	}
	err := d.WithIdentity(ctx, subject, func(tx pgx.Tx) error {
		// Fresh creator authority and group access are both required for recovery.
		if err := scanGroupCreation(ctx, tx, `SELECT app.group_creation_operation($1)`, &result, key); err != nil {
			return err
		}
		if result.State != "COMPLETED" {
			return nil
		}
		var group pgtype.UUID
		if err := group.Scan(result.GroupID); err != nil {
			return err
		}
		_, err := ReadGroup(ctx, tx, group)
		if groupCreationDenied(err) || errors.Is(err, pgx.ErrNoRows) {
			return pgx.ErrNoRows
		}
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return GroupCreationResult{State: "NOT_FOUND"}, nil
	}
	if err != nil {
		return groupCreationFailure(err)
	}
	return result, nil
}

func scanGroupCreation(ctx context.Context, tx pgx.Tx, query string, result *GroupCreationResult, args ...any) error {
	var raw []byte
	if err := tx.QueryRow(ctx, query, args...).Scan(&raw); err != nil {
		return err
	}
	var decoded GroupCreationResult
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return err
	}
	*result = decoded
	return nil
}
func groupCreationDenied(err error) bool {
	var pgerr *pgconn.PgError
	return errors.As(err, &pgerr) && pgerr.Code == "42501"
}
func groupCreationFailure(err error) (GroupCreationResult, error) {
	if groupCreationDenied(err) {
		return GroupCreationResult{}, ErrGroupCreationForbidden
	}
	var pgerr *pgconn.PgError
	if errors.As(err, &pgerr) && pgerr.Code == "22023" {
		return GroupCreationResult{}, ErrGroupCreationInput
	}
	return GroupCreationResult{State: "UNAVAILABLE"}, diagnostic.Wrap(ErrGroupCreationUnavailable, err, "group.creation")
}
func groupCreationKeyValid(key string) bool {
	var id pgtype.UUID
	if len(key) != 36 || strings.ToLower(key) != key || id.Scan(key) != nil || !id.Valid {
		return false
	}
	return key[8] == '-' && key[13] == '-' && key[18] == '-' && key[23] == '-'
}
func validateGroupCreationScalars(input GroupCreationInput) error {
	validString := func(value string) bool { return utf8.ValidString(value) && !strings.ContainsRune(value, 0) }
	if !groupCreationKeyValid(input.OperationKey) || !validString(input.Name) || (input.Kind != "ORDINARY" && input.Kind != "TRIP") {
		return ErrGroupCreationInput
	}
	if input.Trip != nil {
		if !validString(input.Trip.Destination) {
			return ErrGroupCreationInput
		}
		for _, value := range []string{input.Trip.StartDate, input.Trip.EndDate} {
			date, err := time.Parse("2006-01-02", value)
			if err != nil || date.Year() < 1 || date.Year() > 9999 || date.Format("2006-01-02") != value {
				return ErrGroupCreationInput
			}
		}
	}
	return nil
}
