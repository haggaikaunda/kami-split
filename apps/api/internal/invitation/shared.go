package invitation

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func tokenPurpose(operation string) string {
	if operation == "CREATE_SHARED" {
		return "SHARED"
	}
	return "TARGETED"
}

// CreateShared creates or retrieves the outstanding reusable capability, without
// renewing an existing link or scheduling application email.
func (s *Service) CreateShared(ctx context.Context, group, key uuid.UUID) (Result, error) {
	return s.owner(ctx, "CREATE_SHARED", group, uuid.Nil, key, "")
}

// RenewShared preserves the capability and sets expiry seven days from the
// serialized decision. Replaying the same action key never renews it twice.
func (s *Service) RenewShared(ctx context.Context, group, invite, key uuid.UUID) (Result, error) {
	return s.owner(ctx, "RENEW_SHARED", group, invite, key, "")
}

// SharedToken is sensitive capability material. It must be returned only through
// an authenticated no-store response and never logged or persisted by the browser.
type SharedToken struct{ value string }

// Value exposes the capability only for explicit copy transport.
func (t SharedToken) Value() string { return t.value }

// String redacts diagnostic formatting.
func (SharedToken) String() string { return "[redacted shared invitation]" }

// GoString redacts Go-syntax diagnostic formatting.
func (t SharedToken) GoString() string { return t.String() }

// CopyShared checks current enabled ownership before recovering the exact link,
// including after expiry. Revocation is terminal; copying never renews.
func (s *Service) CopyShared(ctx context.Context, group, invite uuid.UUID) (SharedToken, error) {
	var result SharedToken
	err := s.transaction(ctx, func(tx pgx.Tx) error {
		var cipher []byte
		var version string
		err := tx.QueryRow(ctx, `SELECT token_cipher,token_key FROM app.shared_invitation_material($1,$2)`, group, invite).Scan(&cipher, &version)
		if errors.Is(err, pgx.ErrNoRows) {
			return Outcome("UNAVAILABLE_LINK")
		}
		if err != nil {
			return err
		}
		token, err := s.protector.Decrypt(cipher, version, "SHARED:"+invite.String())
		if err != nil {
			return err
		}
		result.value = string(token)
		return nil
	})
	return result, err
}
