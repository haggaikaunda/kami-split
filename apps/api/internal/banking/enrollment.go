package banking

import (
	"context"
	"crypto/hmac"
	"encoding/json"
	"errors"
	"net/url"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/jackc/pgx/v5"
)

// EnrollmentConfig explicitly gates new provider effects. WebhookOrigin must be
// the deployed HTTPS API origin; recovery capabilities require separate proof.
type EnrollmentConfig struct {
	Enabled                    bool
	Environment, WebhookOrigin string
}

// EnrollmentService owns actor-bound enrollment operations. The borrowed storage
// and provider outlive it; no provider call executes inside a database transaction.
type EnrollmentService struct {
	storage  *Service
	provider EnrollmentProvider
	config   EnrollmentConfig
}

// NewEnrollment validates configuration without network effects. A disabled
// service still permits authorized recovery and reads of existing attempts.
func NewEnrollment(storage *Service, provider EnrollmentProvider, config EnrollmentConfig) (*EnrollmentService, error) {
	if storage == nil || provider == nil {
		return nil, errors.New("banking enrollment unavailable")
	}
	if config.Enabled {
		u, e := url.Parse(config.WebhookOrigin)
		if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || (config.Environment != "sandbox" && config.Environment != "production") {
			return nil, errors.New("invalid banking enrollment configuration")
		}
	}
	return &EnrollmentService{storage: storage, provider: provider, config: config}, nil
}

// EnrollmentOutcome contains safe durable status. LinkToken is returned only by
// Start for the temporary Link handoff and must never enter persistent browser storage.
// Formatting redacts the entire value, including the short-lived handoff token.
type EnrollmentOutcome struct {
	Code, State             string
	AttemptID, ConnectionID uuid.UUID
	LinkToken               string
	ExpiresAt               time.Time
}

// String protects temporary Link handoff material.
func (EnrollmentOutcome) String() string { return "[redacted banking enrollment outcome]" }

// GoString protects Go-syntax diagnostics.
func (o EnrollmentOutcome) GoString() string { return o.String() }

// StartEnrollmentInput freezes different-account versus existing-account intent.
// Existing intent can only return replacement-required, never activate replacement.
type StartEnrollmentInput struct {
	AttemptID uuid.UUID
	Intent    string
}

// FinishEnrollmentInput contains the explicit selected provider account IDs and
// one-use public token. Neither callback metadata nor display names prove eligibility.
type FinishEnrollmentInput struct {
	AttemptID   uuid.UUID
	PublicToken string
	AccountIDs  []string
}

// String prevents public-token disclosure.
func (FinishEnrollmentInput) String() string { return "[redacted banking finish input]" }

// GoString prevents Go-syntax token disclosure.
func (i FinishEnrollmentInput) GoString() string { return i.String() }

type enrollmentRecord struct {
	ID, OwnerID, ConnectionID                                           uuid.UUID
	Environment, State, Code, UserID, Webhook, KeyVersion, TokenVersion string
	Expires                                                             time.Time
	Link, InputDigest, FinishDigest                                     []byte
	Cancelled                                                           bool
}

func readEnrollment(ctx context.Context, tx pgx.Tx, id uuid.UUID) (enrollmentRecord, error) {
	var e enrollmentRecord
	var connection *uuid.UUID
	err := tx.QueryRow(ctx, `SELECT id,owner_id,connection_id,environment,state,result_code,user_id,webhook_url,key_version,coalesce(token_key_version,''),expires_at,link_ciphertext,input_digest,finish_digest,cancelled FROM app.banking_enrollments WHERE id=$1`, id).Scan(&e.ID, &e.OwnerID, &connection, &e.Environment, &e.State, &e.Code, &e.UserID, &e.Webhook, &e.KeyVersion, &e.TokenVersion, &e.Expires, &e.Link, &e.InputDigest, &e.FinishDigest, &e.Cancelled)
	if connection != nil {
		e.ConnectionID = *connection
	}
	return e, err
}
func (s *EnrollmentService) actor(ctx context.Context, operation func(pgx.Tx, auth.Actor) error) error {
	return auth.WithActor(ctx, s.storage.db, func(tx pgx.Tx, a auth.Actor) error {
		if _, err := tx.Exec(ctx, `SELECT app.lock_banking_owner()`); err != nil {
			return err
		}
		return operation(tx, a)
	})
}
func outcome(e enrollmentRecord) EnrollmentOutcome {
	return EnrollmentOutcome{Code: e.Code, State: e.State, AttemptID: e.ID, ConnectionID: e.ConnectionID, ExpiresAt: e.Expires}
}
func enrollmentFailure(ctx context.Context, err error) EnrollmentOutcome {
	return EnrollmentOutcome{Code: failure(ctx, err).Code}
}

// Start durably reserves a canonical attempt and correlation before any provider
// effect. Replays recover its expiring encrypted Link handoff; cross-owner IDs mask.
func (s *EnrollmentService) Start(ctx context.Context, input StartEnrollmentInput) EnrollmentOutcome {
	if input.AttemptID == uuid.Nil || (input.Intent != "different" && input.Intent != "existing") {
		return EnrollmentOutcome{Code: "INVALID_INPUT"}
	}
	canonical, _ := json.Marshal(struct {
		Input       StartEnrollmentInput
		Environment string
	}{input, s.config.Environment})
	var e enrollmentRecord
	code := ""
	claimed := false
	authority := uuid.New()
	err := s.actor(ctx, func(tx pgx.Tx, a auth.Actor) error {
		existing, readErr := readEnrollment(ctx, tx, input.AttemptID)
		version := s.storage.protector.current
		if readErr == nil {
			version = existing.KeyVersion
		} else if !errors.Is(readErr, pgx.ErrNoRows) {
			return readErr
		}
		digest, err := s.storage.protector.digest(canonical, version)
		if err != nil {
			return err
		}
		if readErr == nil {
			if !hmac.Equal(existing.InputDigest, digest) {
				code = "CONFLICT"
				return nil
			}
			e = existing
			code = e.Code
			if blocked := s.enrollmentGate(); blocked != "" {
				code = blocked
				return nil
			}
		} else {
			if !s.config.Enabled {
				code = "FEATURE_DISABLED"
				return nil
			}
			caps := s.provider.EnrollmentCapabilities()
			if !caps.UserScopedDiscovery || !caps.UserScopedRemoval {
				code = "NEEDS_ATTENTION"
				return nil
			}
			webhook := s.config.WebhookOrigin + "/banking/webhooks/" + input.AttemptID.String()
			if err = tx.QueryRow(ctx, `SELECT app.banking_enrollment_start($1,$2,$3,$4,$5,$6)`, input.AttemptID, s.config.Environment, digest, version, input.Intent, webhook).Scan(&code); err != nil {
				return err
			}
			if code != "PREPARING" {
				return nil
			}
			e, err = readEnrollment(ctx, tx, input.AttemptID)
			if err != nil {
				return err
			}
		}
		if e.State == "preparing" && s.config.Enabled {
			return tx.QueryRow(ctx, `SELECT app.banking_enrollment_prepare_claim($1,$2)`, e.ID, authority).Scan(&claimed)
		}
		return nil
	})
	if err != nil {
		return enrollmentFailure(ctx, err)
	}
	if e.ID == uuid.Nil {
		return EnrollmentOutcome{Code: code}
	}
	if code == "CONFLICT" {
		return EnrollmentOutcome{Code: code}
	}
	if code == "FEATURE_DISABLED" || code == "NEEDS_ATTENTION" {
		result := outcome(e)
		result.Code = code
		return result
	}
	if claimed {
		user, providerErr := s.provider.EnsureUser(ctx, e.Environment, "kami-"+e.OwnerID.String()+"-"+e.Environment)
		if providerErr != nil {
			return s.unknown(ctx, e.ID)
		}
		var saved bool
		err = s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error {
			return tx.QueryRow(ctx, `SELECT app.banking_enrollment_prepared($1,$2,$3,NULL,'',now())`, e.ID, authority, user).Scan(&saved)
		})
		if err != nil {
			return enrollmentFailure(ctx, err)
		}
		if !saved {
			return outcome(e)
		}
		prepared, providerErr := s.provider.Prepare(ctx, EnrollmentPreparation{Environment: e.Environment, ClientUserID: "kami-" + e.OwnerID.String() + "-" + e.Environment, UserID: user, WebhookURL: e.Webhook})
		if providerErr != nil {
			return s.unknown(ctx, e.ID)
		}
		encrypted, version, err := s.storage.protector.encrypt([]byte(prepared.LinkToken), e.OwnerID.String(), "link/"+e.ID.String(), e.Environment)
		if err != nil {
			return enrollmentFailure(ctx, err)
		}
		err = s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error {
			return tx.QueryRow(ctx, `SELECT app.banking_enrollment_prepared($1,$2,$3,$4,$5,$6)`, e.ID, authority, user, encrypted, version, prepared.ExpiresAt).Scan(&saved)
		})
		if err != nil {
			return enrollmentFailure(ctx, err)
		}
	}
	result := s.Status(ctx, e.ID)
	if result.State == "prepared" && result.ExpiresAt.After(time.Now()) {
		err = s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error { var err error; e, err = readEnrollment(ctx, tx, e.ID); return err })
		if err != nil {
			return enrollmentFailure(ctx, err)
		}
		raw, err := s.storage.protector.decrypt(e.Link, e.TokenVersion, e.OwnerID.String(), "link/"+e.ID.String(), e.Environment)
		if err != nil {
			return enrollmentFailure(ctx, err)
		}
		result.LinkToken = string(raw)
		clear(raw)
	}
	return result
}

// Status reauthorizes each read and never returns tokens or bank provider payloads.
func (s *EnrollmentService) Status(ctx context.Context, id uuid.UUID) EnrollmentOutcome {
	var e enrollmentRecord
	err := s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error { var err error; e, err = readEnrollment(ctx, tx, id); return err })
	if errors.Is(err, pgx.ErrNoRows) {
		return EnrollmentOutcome{Code: "NOT_FOUND"}
	}
	if err != nil {
		return enrollmentFailure(ctx, err)
	}
	return outcome(e)
}

// Cancel retains correlation and durable cleanup intent, including after token expiry.
func (s *EnrollmentService) Cancel(ctx context.Context, id uuid.UUID) EnrollmentOutcome {
	return s.cancel(ctx, id, "CLEANUP_PENDING")
}
func (s *EnrollmentService) cancel(ctx context.Context, id uuid.UUID, reason string) EnrollmentOutcome {
	var code string
	err := s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		return tx.QueryRow(ctx, `SELECT app.banking_enrollment_cancel($1,$2)`, id, reason).Scan(&code)
	})
	if err != nil {
		return enrollmentFailure(ctx, err)
	}
	if code == "NOT_FOUND" {
		return EnrollmentOutcome{Code: code}
	}
	return s.Status(ctx, id)
}

type selectedAccount struct{ ID, Name, Kind, Currency, StableID string }

func selectAccounts(inventory AccountInventory, ids []string) ([]selectedAccount, bool) {
	if inventory.CountryCode != "US" || inventory.ItemID == "" || inventory.InstitutionID == "" {
		return nil, false
	}
	selected := make([]selectedAccount, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" || len(id) > 256 || seen[id] {
			return nil, false
		}
		seen[id] = true
		found := false
		for _, a := range inventory.Accounts {
			if a.ID != id {
				continue
			}
			kind := ""
			if a.Type == "depository" && (a.Subtype == "checking" || a.Subtype == "savings") {
				kind = a.Subtype
			}
			if a.Type == "credit" && a.Subtype == "credit card" {
				kind = "credit_card"
			}
			if kind == "" || a.Currency != "USD" {
				return nil, false
			}
			selected = append(selected, selectedAccount{ID: id, Name: a.Name, Kind: kind, Currency: "USD", StableID: a.StableID})
			found = true
			break
		}
		if !found {
			return nil, false
		}
	}
	return selected, len(selected) > 0
}

// Finish claims exactly one exchange before I/O. Lost/uncertain effects remain
// non-active and worker-recoverable; neither retries nor callbacks repeat exchange.
func (s *EnrollmentService) Finish(ctx context.Context, input FinishEnrollmentInput) EnrollmentOutcome {
	if input.AttemptID == uuid.Nil || len(input.PublicToken) < 1 || len(input.PublicToken) > 8192 || len(input.AccountIDs) < 1 || len(input.AccountIDs) > 100 {
		return EnrollmentOutcome{Code: "INVALID_INPUT"}
	}
	input.AccountIDs = append([]string(nil), input.AccountIDs...)
	sort.Strings(input.AccountIDs)
	canonical, _ := json.Marshal(input)
	var e enrollmentRecord
	code := ""
	err := s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		if blocked := s.enrollmentGate(); blocked != "" {
			code = blocked
			return nil
		}
		var err error
		e, err = readEnrollment(ctx, tx, input.AttemptID)
		if err != nil {
			return err
		}
		digest, err := s.storage.protector.digest(canonical, e.KeyVersion)
		if err != nil {
			return err
		}
		token, version, err := s.storage.protector.encrypt([]byte(input.PublicToken), e.OwnerID.String(), "public/"+e.ID.String(), e.Environment)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT app.banking_enrollment_exchange_claim($1,$2,$3,$4)`, e.ID, digest, token, version).Scan(&code)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return EnrollmentOutcome{Code: "NOT_FOUND"}
	}
	if err != nil {
		return enrollmentFailure(ctx, err)
	}
	if code != "CLAIMED" {
		if code == "FEATURE_DISABLED" || code == "NEEDS_ATTENTION" {
			return EnrollmentOutcome{Code: code}
		}
		if code == "CONFLICT" {
			return EnrollmentOutcome{Code: code}
		}
		return s.Status(ctx, e.ID)
	}
	exchanged, err := s.provider.Exchange(ctx, e.Environment, NewPublicToken([]byte(input.PublicToken)))
	if err != nil {
		return s.unknown(ctx, e.ID)
	}
	// The exchanged Item must belong to this actor and this exact Link URL. A
	// swapped token is never stored, activated or removed under guessed authority.
	items, err := s.provider.Discover(ctx, e.Environment, EnrollmentCorrelation{UserID: e.UserID, ClientUserID: "kami-" + e.OwnerID.String() + "-" + e.Environment, WebhookURL: e.Webhook})
	correlated := false
	for _, item := range items {
		if item == exchanged.ItemID {
			correlated = true
		}
	}
	if err != nil || !correlated {
		return s.unknown(ctx, e.ID)
	}
	connection := uuid.New()
	raw := exchanged.AccessToken.Bytes()
	defer clear(raw)
	encrypted, version, err := s.storage.protector.encrypt(raw, e.OwnerID.String(), connection.String(), e.Environment)
	if err != nil {
		return enrollmentFailure(ctx, err)
	}
	saved := false
	err = s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		return tx.QueryRow(ctx, `SELECT app.banking_enrollment_exchange_saved($1,$2,$3,$4,$5)`, e.ID, exchanged.ItemID, connection, encrypted, version).Scan(&saved)
	})
	if err != nil {
		return enrollmentFailure(ctx, err)
	}
	if !saved {
		return s.Status(ctx, e.ID)
	}
	inventory, err := s.provider.Accounts(ctx, e.Environment, exchanged.AccessToken)
	if err != nil || inventory.ItemID != exchanged.ItemID {
		return s.cancel(ctx, e.ID, "CLEANUP_PENDING")
	}
	selected, valid := selectAccounts(inventory, input.AccountIDs)
	if !valid {
		return s.cancel(ctx, e.ID, "INVALID_SELECTION")
	}
	encoded, _ := json.Marshal(selected)
	err = s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		return tx.QueryRow(ctx, `SELECT app.banking_enrollment_activate($1,$2,$3)`, e.ID, encoded, inventory.InstitutionID).Scan(&code)
	})
	if err != nil {
		return enrollmentFailure(ctx, err)
	}
	if code != "AWAITING_INITIAL_IMPORT" {
		return s.cancel(ctx, e.ID, code)
	}
	return s.Status(ctx, e.ID)
}

// Account is the owner-only selected stream projection. RequestedHistoryDays is
// an initialization request, never actual coverage or a rolling retention promise.
type Account struct {
	ID, BindingID, ConnectionID uuid.UUID
	Name, Kind, Currency        string
	RequestedHistoryDays        int
}

// Accounts reads only selected, visible streams belonging to the enabled actor.
func (s *EnrollmentService) Accounts(ctx context.Context, connection uuid.UUID) ([]Account, Result) {
	result := []Account{}
	code := "NOT_FOUND"
	err := s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT FROM app.banking_connections WHERE id=$1)`, connection).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return nil
		}
		code = "READY"
		rows, err := tx.Query(ctx, `SELECT a.id,b.id,b.connection_id,m.display_name,a.kind,m.currency,m.requested_history_days FROM app.banking_accounts a JOIN app.banking_bindings b ON b.account_id=a.id JOIN app.banking_enrollment_accounts m ON m.binding_id=b.id WHERE b.connection_id=$1 AND a.selected ORDER BY a.id`, connection)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var a Account
			if err := rows.Scan(&a.ID, &a.BindingID, &a.ConnectionID, &a.Name, &a.Kind, &a.Currency, &a.RequestedHistoryDays); err != nil {
				return err
			}
			result = append(result, a)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, failure(ctx, err)
	}
	return result, Result{Code: code}
}

func (s *EnrollmentService) unknown(ctx context.Context, id uuid.UUID) EnrollmentOutcome {
	err := s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		_, err := tx.Exec(ctx, `SELECT app.banking_enrollment_unknown($1)`, id)
		return err
	})
	if err != nil {
		return enrollmentFailure(ctx, err)
	}
	return s.Status(ctx, id)
}

func (s *EnrollmentService) enrollmentGate() string {
	if !s.config.Enabled {
		return "FEATURE_DISABLED"
	}
	caps := s.provider.EnrollmentCapabilities()
	if !caps.UserScopedDiscovery || !caps.UserScopedRemoval {
		return "NEEDS_ATTENTION"
	}
	return ""
}
