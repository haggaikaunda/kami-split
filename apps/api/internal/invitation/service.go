// Package invitation implements targeted capabilities without public transport or
// provider delivery. All mutations use verified request context and database locks.
package invitation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Outcome is a safe application error; SQL, recipient and token details never escape.
type Outcome string

// Error returns only the safe operation code.
func (o Outcome) Error() string { return string(o) }

// Unavailable means the operation could not be safely completed; recover the same
// action key before issuing a deliberate new action after an uncertain commit.
const Unavailable Outcome = "UNAVAILABLE"

// Result contains safe operation history and separately computed current access.
// HasAccess never converts a historical receipt into current authorization.
type Result struct {
	ActionID         uuid.UUID `json:"actionId"`
	InvitationID     uuid.UUID `json:"invitationId"`
	GroupID          uuid.UUID `json:"groupId"`
	Outcome          string    `json:"outcome"`
	ExpiresAt        time.Time `json:"expiresAt"`
	CurrentExpiresAt time.Time `json:"currentExpiresAt"`
	Lifecycle        string    `json:"lifecycle"`
	Delivery         string    `json:"delivery"`
	MembershipID     uuid.UUID `json:"membershipId"`
	HasAccess        bool      `json:"hasAccess"`
}

// Service owns transaction and cryptographic boundaries. Provider is injected by
// #80 and must query its configured Auth service afresh for each observation.
type Service struct {
	db        *database.DB
	protector *Protector
	provider  auth.CurrentEmailProvider
}

// New wires backend-only dependencies; no operation is published to GraphQL here.
func New(db *database.DB, p *Protector, provider auth.CurrentEmailProvider) (*Service, error) {
	if db == nil || p == nil {
		return nil, Unavailable
	}
	return &Service{db, p, provider}, nil
}

func decode(raw []byte) (Result, error) {
	var r Result
	err := json.Unmarshal(raw, &r)
	return r, err
}
func safe(err error) error {
	if err == nil {
		return nil
	}
	var outcome Outcome
	if errors.As(err, &outcome) {
		if operation, ok := diagnostic.Operation(err); ok {
			return diagnostic.Wrap(outcome, err, operation)
		}
		return outcome
	}
	var authentication auth.Outcome
	if errors.As(err, &authentication) {
		if operation, ok := diagnostic.Operation(err); ok {
			return diagnostic.Wrap(authentication, err, operation)
		}
		return authentication
	}
	var databaseError *pgconn.PgError
	if errors.As(err, &databaseError) && databaseError.Code == "42501" {
		return Outcome("ACCESS_DENIED")
	}
	return diagnostic.Wrap(Unavailable, err, "invitation.operation")
}
func (s *Service) transaction(ctx context.Context, fn func(pgx.Tx) error) error {
	return safe(auth.WithVerifiedIdentity(ctx, s.db, fn))
}
func (s *Service) digest(parts []string, version string) ([]byte, error) {
	b, err := json.Marshal(parts)
	if err != nil {
		return nil, err
	}
	return s.protector.ActionDigest(b, version)
}
func (s *Service) recover(ctx context.Context, tx pgx.Tx, op string, key uuid.UUID, parts []string) (Result, bool, error) {
	var stored []byte
	var version string
	var raw []byte
	err := tx.QueryRow(ctx, `SELECT digest,digest_key,result FROM app.invitation_action_lookup($1,$2)`, op, key).Scan(&stored, &version, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{}, false, nil
	}
	if err != nil {
		return Result{}, false, err
	}
	if parts != nil {
		actual, err := s.digest(parts, version)
		if err != nil {
			return Result{}, false, err
		}
		if !equalDigest(stored, actual) {
			return Result{Outcome: "KEY_REUSED"}, true, nil
		}
	}
	r, err := decode(raw)
	return r, true, err
}

// Recover returns only this verified actor's original result and fresh authority.
// NOT_OBSERVED does not prove that another in-flight transaction cannot commit.
func (s *Service) Recover(ctx context.Context, operation string, key uuid.UUID) (Result, error) {
	var r Result
	err := s.transaction(ctx, func(tx pgx.Tx) error {
		var found bool
		var err error
		r, found, err = s.recover(ctx, tx, operation, key, nil)
		if err == nil && !found {
			r.Outcome = "NOT_OBSERVED"
		}
		return err
	})
	return r, err
}

// Create records one outstanding target and one delivery intent atomically. A
// duplicate target returns EXISTING without extending expiry or scheduling email.
func (s *Service) Create(ctx context.Context, group uuid.UUID, email string, key uuid.UUID) (Result, error) {
	canonical, err := auth.CanonicalEmail(email)
	if err != nil {
		return Result{}, Outcome("INVALID_EMAIL")
	}
	return s.owner(ctx, "CREATE", group, uuid.Nil, key, canonical)
}

// Resend is a deliberate new action; exact-key retries never extend expiry again.
func (s *Service) Resend(ctx context.Context, group, invite, key uuid.UUID) (Result, error) {
	return s.owner(ctx, "RESEND", group, invite, key, "")
}

// Revoke terminally removes recipient/token material without removing membership.
func (s *Service) Revoke(ctx context.Context, group, invite, key uuid.UUID) (Result, error) {
	return s.owner(ctx, "REVOKE", group, invite, key, "")
}
func (s *Service) owner(ctx context.Context, op string, group, invite, key uuid.UUID, email string) (Result, error) {
	if group == uuid.Nil || key == uuid.Nil || (op != "CREATE" && invite == uuid.Nil) {
		return Result{}, Outcome("INVALID_INPUT")
	}
	parts := []string{"v1", op, group.String(), invite.String(), email}
	var result Result
	err := s.transaction(ctx, func(tx pgx.Tx) error {
		r, found, err := s.recover(ctx, tx, op, key, parts)
		if err != nil {
			return err
		}
		if found {
			result = r
			return nil
		}
		digest, err := s.digest(parts, "")
		if err != nil {
			return err
		}
		newID, err := uuid.NewRandom()
		if err != nil {
			return err
		}
		var hash, cipher []byte
		var tokenVersion string
		if op == "CREATE" {
			token, h, err := s.protector.NewToken()
			if err != nil {
				return err
			}
			hash = h
			cipher, tokenVersion, err = s.protector.Encrypt([]byte(token), "TARGETED:"+newID.String())
			if err != nil {
				return err
			}
		}
		var raw []byte
		err = tx.QueryRow(ctx, `SELECT app.invitation_owner_action($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, op, group, invite, key, digest, s.protector.CurrentVersion(), newID, hash, cipher, tokenVersion, email).Scan(&raw)
		if err != nil {
			return err
		}
		result, err = decode(raw)
		if err != nil {
			return err
		}
		// A competing instance may have committed with an older current key.
		// Compare using that stored version before classifying genuine key reuse.
		if result.Outcome == "KEY_REUSED" {
			result, _, err = s.recover(ctx, tx, op, key, parts)
			return err
		}
		if result.Delivery == "PENDING" {
			return s.materialize(ctx, tx, result.ActionID)
		}
		return nil
	})
	if err != nil {
		return Result{}, err
	}
	return result, nil
}

// ListedInvitation is owner-only recipient data; it contains no recoverable token.
type ListedInvitation struct {
	ID        uuid.UUID
	Recipient *string
	ExpiresAt time.Time
	Lifecycle string
	ActionID  *uuid.UUID
	Delivery  string
}

// List returns at most 50 invitations in stable UUID order with an exclusive ID cursor.
func (s *Service) List(ctx context.Context, group uuid.UUID, after *uuid.UUID, limit int) ([]ListedInvitation, error) {
	var result []ListedInvitation
	err := s.transaction(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT id,recipient,expires_at,lifecycle,action_id,delivery FROM app.invitation_list($1,$2,$3)`, group, after, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var i ListedInvitation
			if err := rows.Scan(&i.ID, &i.Recipient, &i.ExpiresAt, &i.Lifecycle, &i.ActionID, &i.Delivery); err != nil {
				return err
			}
			result = append(result, i)
		}
		return rows.Err()
	})
	return result, err
}

// Preview reveals exactly two approved names for a live capability, never target email.
type Preview struct {
	GroupName   string
	InviterName string
}

// Preview validates a capability without granting group reads or consuming it.
func (s *Service) Preview(ctx context.Context, token string) (Preview, error) {
	var p Preview
	hash := TokenHash(token)
	if hash == nil {
		return p, Outcome("UNAVAILABLE_LINK")
	}
	err := s.db.Pool.QueryRow(ctx, `SELECT group_name,inviter_name FROM app.invitation_preview($1)`, hash).Scan(&p.GroupName, &p.InviterName)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, Outcome("UNAVAILABLE_LINK")
	}
	return p, safe(err)
}

// Eligible supports #80's constrained Auth provisioning adapter; it discloses no
// account existence and never grants membership. Admission rechecks everything.
func (s *Service) Eligible(ctx context.Context, token, email string) (bool, error) {
	canonical, err := auth.CanonicalEmail(email)
	if err != nil {
		return false, nil
	}
	hash := TokenHash(token)
	if hash == nil {
		return false, nil
	}
	var ok bool
	err = s.db.Pool.QueryRow(ctx, `SELECT app.invitation_eligible($1,$2)`, hash, canonical).Scan(&ok)
	return ok, safe(err)
}

var rollbackOutcome = errors.New("rollback non-admission")

// Accept recovers actor-bound history first. Fresh provider evidence is fetched
// outside locks; stale evidence rolls back provisioning and retries at most twice.
func (s *Service) Accept(ctx context.Context, token string, key uuid.UUID) (Result, error) {
	hash := TokenHash(token)
	if hash == nil || key == uuid.Nil {
		return Result{}, Outcome("UNAVAILABLE_LINK")
	}
	parts := []string{"v1", "ACCEPT", fmt.Sprintf("%x", hash)}
	var result Result
	err := s.transaction(ctx, func(tx pgx.Tx) error {
		r, found, err := s.recover(ctx, tx, "ACCEPT", key, parts)
		if found {
			result = r
		}
		return err
	})
	if err != nil || result.Outcome != "" {
		return result, err
	}
	for attempt := 0; attempt < 2; attempt++ {
		evidence, err := auth.ObserveCurrentEmail(ctx, s.provider)
		if err != nil {
			return Result{}, safe(err)
		}
		stale := false
		err = auth.WithVerifiedIdentity(ctx, s.db, func(tx pgx.Tx) error {
			r, found, err := s.recover(ctx, tx, "ACCEPT", key, parts)
			if err != nil {
				return err
			}
			if found {
				result = r
				return nil
			}
			var target *uuid.UUID
			if err := tx.QueryRow(ctx, `SELECT app.invitation_admission_lock($1)`, hash).Scan(&target); err != nil {
				return err
			}
			email, err := evidence.CanonicalEmail(ctx)
			if err != nil {
				stale = true
				return err
			}
			digest, err := s.digest(parts, "")
			if err != nil {
				return err
			}
			var raw []byte
			if err := tx.QueryRow(ctx, `SELECT app.invitation_accept($1,$2,$3,$4,$5)`, hash, email, key, digest, s.protector.CurrentVersion()).Scan(&raw); err != nil {
				return err
			}
			result, err = decode(raw)
			if err != nil {
				return err
			}
			if result.Outcome == "KEY_REUSED" {
				result, _, err = s.recover(ctx, tx, "ACCEPT", key, parts)
				if err != nil {
					return err
				}
			}
			if _, err = evidence.CanonicalEmail(ctx); err != nil {
				stale = true
				return err
			}
			if result.Outcome != "ADMITTED" && result.Outcome != "ALREADY_MEMBER" {
				return rollbackOutcome
			}
			return nil
		})
		if stale {
			continue
		}
		if errors.Is(err, rollbackOutcome) {
			return result, nil
		}
		return result, safe(err)
	}
	return Result{}, Unavailable
}
