// Package bootstrap implements the explicit operator-only installation procedure.
// It is never wired into the API and requires the existing migration login.
package bootstrap

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Target is an operator-retained plan. All IDs must be explicit canonical UUIDs
// (application IDs must be random v4), reused unchanged after uncertain outcomes.
// Email is deliberately absent: it can never select or relink an identity.
type Target struct {
	AuthUserID   string `json:"authUserId"`
	UserID       string `json:"userId"`
	GroupID      string `json:"groupId"`
	MembershipID string `json:"membershipId"`
	DisplayName  string `json:"displayName"`
}

// Result distinguishes a newly committed installation from an exact safe retry.
type Result string

const (
	// Created means the whole application setup committed atomically.
	Created Result = "CREATED"
	// Existing means the designated identity, group and active owner still match.
	Existing Result = "EXISTING"
)

// Validate rejects implicit selection and malformed plans before database access.
func (t Target) Validate() error {
	for i, raw := range []string{t.AuthUserID, t.UserID, t.GroupID, t.MembershipID} {
		id, err := uuid.Parse(raw)
		if err != nil || id == uuid.Nil || id.String() != raw || (i > 0 && (id.Version() != 4 || id.Variant() != uuid.RFC4122)) {
			return errors.New("explicit canonical UUIDs required; application IDs must be random v4")
		}
	}
	if t.UserID == t.GroupID || t.UserID == t.MembershipID || t.GroupID == t.MembershipID || t.UserID == t.AuthUserID {
		return errors.New("distinct application identities required")
	}
	if strings.TrimSpace(t.DisplayName) == "" || !utf8.ValidString(t.DisplayName) || utf8.RuneCountInString(t.DisplayName) > 120 || strings.ContainsRune(t.DisplayName, 0) {
		return errors.New("display name must contain 1 to 120 characters")
	}
	return nil
}

// Provision atomically installs an empty USD Household or recognizes an exact
// retry. Auth creation is external. The caller supplies a dedicated migration
// connection; runtime roles cannot assume kami_migrator. Errors deliberately omit
// database details/identities. After any failure, inspect and retry the SAME plan;
// even a commit error may have committed. No existing privileges are restored.
func Provision(ctx context.Context, conn *pgx.Conn, target Target) (Result, error) {
	if err := target.Validate(); err != nil {
		return "", err
	}
	tx, err := conn.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return "", errors.New("bootstrap transaction unavailable")
	}
	defer tx.Rollback(context.Background())
	result, err := provision(ctx, tx, target)
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, "SET CONSTRAINTS ALL IMMEDIATE"); err != nil {
		return "", errors.New("bootstrap constraints rejected setup")
	}
	if err := tx.Commit(ctx); err != nil {
		return "", errors.New("bootstrap commit uncertain; inspect and retry the same plan")
	}
	return result, nil
}

func provision(ctx context.Context, tx pgx.Tx, t Target) (Result, error) {
	fail := func() (Result, error) {
		return "", errors.New("bootstrap rejected; inspect exact identities, privileges and existing setup")
	}
	// One fixed installation lock, then the same subject lock as invitation
	// admission. This serializes empty-installation attempts and first provisioning.
	if _, err := tx.Exec(ctx, `SET LOCAL ROLE kami_migrator`); err != nil {
		return fail()
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(81,1)`); err != nil {
		return fail()
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1::text,79))`, t.AuthUserID); err != nil {
		return fail()
	}
	var userID, subject, live string
	var enabled bool
	err := tx.QueryRow(ctx, `SELECT id::text,auth_subject::text,coalesce(live_auth_id::text,''),enabled
 FROM app.users WHERE id=$1 OR auth_subject=$2 ORDER BY id FOR UPDATE`, t.UserID, t.AuthUserID).Scan(&userID, &subject, &live, &enabled)
	userExists := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fail()
	}
	if userExists && (userID != t.UserID || subject != t.AuthUserID || live != t.AuthUserID || !enabled) {
		return fail()
	}
	var groupID, creator string
	err = tx.QueryRow(ctx, `SELECT household_group_id::text,group_creator_user_id::text FROM app.installation WHERE singleton`).Scan(&groupID, &creator)
	if err == nil {
		if !userExists || groupID != t.GroupID || creator != t.UserID {
			return fail()
		}
		// Match ownership under the ordinary user-before-group lock order. A retry
		// may follow real use/name changes; it must not reset mutable profile data.
		var owner, currency string
		if err := tx.QueryRow(ctx, `SELECT owner_membership_id::text,currency FROM app.groups WHERE id=$1 FOR UPDATE`, t.GroupID).Scan(&owner, &currency); err != nil || owner != t.MembershipID || currency != "USD" {
			return fail()
		}
		var matching bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT FROM app.memberships WHERE id=$1 AND group_id=$2 AND user_id=$3 AND active)`, t.MembershipID, t.GroupID, t.UserID).Scan(&matching); err != nil || !matching {
			return fail()
		}
		// Installation itself can be changed only by an operator; lock/recheck after
		// group locks to avoid reversing the normal creator user-before-installation order.
		if err := tx.QueryRow(ctx, `SELECT household_group_id::text,group_creator_user_id::text FROM app.installation WHERE singleton FOR SHARE`).Scan(&groupID, &creator); err != nil || groupID != t.GroupID || creator != t.UserID {
			return fail()
		}
		return Existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return fail()
	}
	// A missing singleton is not permission to repair historical groups or
	// memberships. Only an exact, enabled, membership-free user may be resumed.
	var collision bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT FROM app.groups WHERE id=$1)
 OR EXISTS(SELECT FROM app.memberships WHERE id=$2 OR user_id=$3)`, t.GroupID, t.MembershipID, t.UserID).Scan(&collision); err != nil || collision {
		return fail()
	}
	if !userExists {
		// The managed Auth FK validates the explicit subject; no Auth reads or writes
		// are performed by the migrator and no email inference is possible.
		if _, err := tx.Exec(ctx, `INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES($1,$2,$2,$3)`, t.UserID, t.AuthUserID, t.DisplayName); err != nil {
			return fail()
		}
	}
	if _, err := tx.Exec(ctx, `INSERT INTO app.groups(id,name,currency,owner_membership_id) VALUES($1,'Household','USD',$2)`, t.GroupID, t.MembershipID); err != nil {
		return fail()
	}
	if _, err := tx.Exec(ctx, `INSERT INTO app.memberships(id,group_id,user_id) VALUES($1,$2,$3)`, t.MembershipID, t.GroupID, t.UserID); err != nil {
		return fail()
	}
	if _, err := tx.Exec(ctx, `INSERT INTO app.installation(singleton,household_group_id,group_creator_user_id) VALUES(true,$1,$2)`, t.GroupID, t.UserID); err != nil {
		return fail()
	}
	return Created, nil
}
