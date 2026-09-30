package invitation

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type message struct {
	Recipient string    `json:"recipient"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
	Template  string    `json:"template"`
}

func (s *Service) materialize(ctx context.Context, tx pgx.Tx, action uuid.UUID) error {
	var m message
	var cipher []byte
	var version string
	var invite uuid.UUID
	err := tx.QueryRow(ctx, `SELECT recipient,token_cipher,token_key,invitation_id,expires_at FROM app.invitation_material($1)`, action).Scan(&m.Recipient, &cipher, &version, &invite, &m.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	token, err := s.protector.Decrypt(cipher, version, "TARGETED:"+invite.String())
	if err != nil {
		return err
	}
	m.Token = string(token)
	m.Template = "targeted-v1"
	raw, err := json.Marshal(m)
	if err != nil {
		return err
	}
	cipher, version, err = s.protector.Encrypt(raw, "DELIVERY:"+action.String())
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `SELECT app.invitation_attach_delivery($1,$2,$3)`, action, cipher, version)
	return err
}

// Dispatch is a short-lived, sensitive provider handoff. Never serialize/log its
// payload, place it in browser storage, or use it as an admission credential.
// The provider key and exact payload remain stable across same-action recovery.
type Dispatch struct {
	action      uuid.UUID
	lease       uuid.UUID
	providerKey uuid.UUID
	payload     []byte
}

// String redacts delivery capabilities even under normal diagnostic formatting.
func (Dispatch) String() string { return "[redacted invitation delivery]" }

// GoString also prevents %#v formatting from exposing delivery capabilities.
func (Dispatch) GoString() string { return "[redacted invitation delivery]" }

// ProviderKey is the immutable deduplication key for this action, not a recipient identity.
func (d Dispatch) ProviderKey() string { return d.providerKey.String() }

// Payload returns a private copy for the trusted #80 sender only. The versioned
// JSON schema is recipient, token, expiresAt and template; #80 constructs links
// using a configured allowlisted application origin, never request host headers.
func (d Dispatch) Payload() []byte { return append([]byte(nil), d.payload...) }

// Claim durably marks an attempted send UNKNOWN before returning material. The
// caller sends outside locks, then completes using this exact claim. A lost
// response/worker crash becomes retryable after a 30-second lease.
func (s *Service) Claim(ctx context.Context, action uuid.UUID) (Dispatch, error) {
	lease, err := uuid.NewRandom()
	if err != nil {
		return Dispatch{}, safe(err)
	}
	d := Dispatch{action: action, lease: lease}
	err = s.transaction(ctx, func(tx pgx.Tx) error {
		var cipher []byte
		var version string
		if err := tx.QueryRow(ctx, `SELECT payload,payload_key,provider_key FROM app.invitation_claim($1,$2)`, action, d.lease).Scan(&cipher, &version, &d.providerKey); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return Outcome("NOT_CLAIMABLE")
			}
			return err
		}
		raw, err := s.protector.Decrypt(cipher, version, "DELIVERY:"+action.String())
		if err != nil {
			return err
		}
		d.payload = raw
		return nil
	})
	if err != nil {
		return Dispatch{}, err
	}
	return d, nil
}

// Complete records provider acceptance (not delivery), a definite send failure,
// or uncertainty. Stale/terminal claims cannot overwrite a later result. Retry
// definite/unknown outcomes via Claim with the same action, without changing expiry.
func (s *Service) Complete(ctx context.Context, d Dispatch, outcome string) (bool, error) {
	if d.action == uuid.Nil || d.lease == uuid.Nil {
		return false, Outcome("INVALID_INPUT")
	}
	var ok bool
	err := s.transaction(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT app.invitation_complete($1,$2,$3)`, d.action, d.lease, outcome).Scan(&ok)
	})
	return ok, err
}
