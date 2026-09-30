package database

import (
	"context"
	"errors"
	"fmt"

	"github.com/haggaikaunda/kami-split/apps/api/internal/database/identityquery"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// WithIdentity binds a previously verified Auth subject to one READ COMMITTED
// transaction. It does not verify JWTs: #78 must supply trusted subject evidence.
// Callbacks must use tx, never the pool; helpers recheck current application access.
func (d *DB) WithIdentity(ctx context.Context, subject string, fn func(pgx.Tx) error) error {
	var id pgtype.UUID
	if err := id.Scan(subject); err != nil || !id.Valid || fmt.Sprintf("%x-%x-%x-%x-%x", id.Bytes[0:4], id.Bytes[4:6], id.Bytes[6:8], id.Bytes[8:10], id.Bytes[10:16]) != subject {
		return errors.New("invalid verified subject")
	}
	return pgx.BeginTxFunc(ctx, d.Pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_catalog.set_config('app.verified_sub', $1, true)`, subject); err != nil {
			return fmt.Errorf("bind verified identity: %w", err)
		}
		return fn(tx)
	})
}

// Viewer contains only the approved self projection. Disabled/unprovisioned
// identities have no ID/name and cannot acquire creation capability.
type Viewer struct {
	Status          string
	ID              pgtype.UUID
	DisplayName     pgtype.Text
	CanCreateGroups bool
}

func ReadViewer(ctx context.Context, tx pgx.Tx) (Viewer, error) {
	var v Viewer
	err := tx.QueryRow(ctx, `SELECT status, id, display_name, can_create_groups FROM app.viewer_identity()`).Scan(&v.Status, &v.ID, &v.DisplayName, &v.CanCreateGroups)
	return v, err
}

// GroupMember intentionally excludes the user's Auth ID, user ID and email.
type GroupMember struct {
	ID             pgtype.UUID
	DisplayName    string
	Status         string
	Role           string
	CanParticipate bool
}
type Group struct {
	ID       pgtype.UUID
	Name     string
	Currency string
	Members  []GroupMember
}

// ReadGroup holds actor/group locks through the caller's transaction. One fresh
// statement after acquiring them authorizes and reads the complete projection.
// An inaccessible group returns the helper's access-denied error. An empty
// authorized projection returns pgx.ErrNoRows rather than incomplete data.
func ReadGroup(ctx context.Context, tx pgx.Tx, group pgtype.UUID) (Group, error) {
	var result Group
	if _, err := tx.Exec(ctx, `SELECT app.lock_group_read($1)`, group); err != nil {
		return result, err
	}
	rows, err := tx.Query(ctx, `SELECT g.id, g.name, g.currency, m.id, m.display_name, m.status, m.role, m.can_participate
 FROM app.groups g CROSS JOIN LATERAL app.group_members(g.id) m WHERE g.id = $1 AND app.can_read_group(g.id) ORDER BY m.id`, group)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var m GroupMember
		if err := rows.Scan(&result.ID, &result.Name, &result.Currency, &m.ID, &m.DisplayName, &m.Status, &m.Role, &m.CanParticipate); err != nil {
			return Group{}, err
		}
		result.Members = append(result.Members, m)
	}
	if err := rows.Err(); err != nil {
		return Group{}, err
	}
	if len(result.Members) == 0 {
		return Group{}, pgx.ErrNoRows
	}
	return result, nil
}

// LockGroupWrite reserves the reviewed lock order but grants no write rights.
// The future financial/admission operations must remain in this transaction.
func LockGroupWrite(ctx context.Context, tx pgx.Tx, group pgtype.UUID, members []pgtype.UUID) error {
	_, err := tx.Exec(ctx, `SELECT app.lock_group_write($1, $2)`, group, members)
	return err
}

// ListGroups returns only groups admitted by RLS in the current transaction.
func ListGroups(ctx context.Context, tx pgx.Tx) ([]identityquery.ListGroupsRow, error) {
	return identityquery.New(tx).ListGroups(ctx)
}
