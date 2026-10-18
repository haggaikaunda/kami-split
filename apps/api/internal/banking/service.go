// Package banking owns private storage primitives with private lifecycle worker and ingress
// adapters. Live enrollment remains a separately gated capability.
package banking

import (
	"context"
	"crypto/hmac"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database/bankingquery"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Service binds storage to verified requests and an independent banking keyring.
// It borrows both dependencies; callers own their lifetimes.
type Service struct {
	db        *database.DB
	protector *Protector
}

// New constructs private operations without starting provider or worker runtime.
func New(db *database.DB, p *Protector) (*Service, error) {
	if db == nil || p == nil {
		return nil, errors.New("banking storage unavailable")
	}
	return &Service{db: db, protector: p}, nil
}

// Result contains safe status and opaque identity only. Receipts retain neither
// financial facts nor credentials, including after history deletion.
type Result struct {
	Code string
	ID   uuid.UUID
}

// ConnectionInput stores a private connection without enrollment or token
// exchange. AttemptID must be known before the first request.
type ConnectionInput struct {
	AttemptID                                uuid.UUID
	Environment, ProviderItemID, AccessToken string
}

// String redacts the credential and provider identity from diagnostics.
func (ConnectionInput) String() string { return "[redacted banking connection input]" }

// GoString also redacts Go-syntax diagnostics.
func (i ConnectionInput) GoString() string { return i.String() }

// SourceInput appends an immutable source under lifecycle/revision guards. Amount
// is canonical signed int64 USD cents; BankDate is a real ISO calendar date.
type SourceInput struct {
	AttemptID, BindingID                                             uuid.UUID
	ProviderTransactionID                                            string
	ConnectionGeneration, BindingGeneration, ExpectedRevision        int64
	AmountMinor, Currency, BankDate, ProcessingState, MappingVersion string
}

// FenceInput stops writes or hides history behind a durable deletion barrier.
// Provider teardown and physical purge are separate downstream responsibilities.
type FenceInput struct {
	AttemptID, ConnectionID uuid.UUID
	ExpectedGeneration      int64
}

func pgID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: id != uuid.Nil} }
func safeID(id pgtype.UUID) uuid.UUID {
	if !id.Valid {
		return uuid.Nil
	}
	return uuid.UUID(id.Bytes)
}

// CreateConnection persists a pending operation before protected credentials,
// then atomically commits the connection and opaque completion receipt.
func (s *Service) CreateConnection(ctx context.Context, input ConnectionInput) Result {
	if input.AttemptID == uuid.Nil || (input.Environment != "sandbox" && input.Environment != "production") || len(input.ProviderItemID) < 1 || len(input.ProviderItemID) > 256 || len(input.AccessToken) < 1 || len(input.AccessToken) > 8192 {
		return Result{Code: "INVALID_INPUT"}
	}
	return s.run(ctx, input.AttemptID, "create_connection", input, func(tx pgx.Tx, actor auth.Actor) (Result, error) {
		id := uuid.New()
		protected, version, err := s.protector.encrypt([]byte(input.AccessToken), safeID(actor.ID).String(), id.String(), input.Environment)
		if err != nil {
			return Result{}, err
		}
		var saved pgtype.UUID
		err = tx.QueryRow(ctx, `SELECT app.banking_create_connection($1,$2,$3,$4,$5)`, pgID(id), input.Environment, input.ProviderItemID, version, protected).Scan(&saved)
		if err == nil && !saved.Valid {
			return Result{Code: "CONFLICT"}, nil
		}
		return Result{Code: "READY", ID: safeID(saved)}, err
	})
}

// RecordSource creates or appends one source revision without shared expenses.
// A stopped, deleted or superseded generation cannot be revived by an old job.
func (s *Service) RecordSource(ctx context.Context, input SourceInput) Result {
	amount, err := strconv.ParseInt(input.AmountMinor, 10, 64)
	date, dateErr := time.Parse("2006-01-02", input.BankDate)
	if input.AttemptID == uuid.Nil || input.BindingID == uuid.Nil || err != nil || strconv.FormatInt(amount, 10) != input.AmountMinor || dateErr != nil || date.Year() < 1 || date.Year() > 9999 || input.Currency != "USD" || input.MappingVersion == "" || input.ExpectedRevision < 0 || input.ExpectedRevision == int64(^uint64(0)>>1) || len(input.ProviderTransactionID) < 1 || len(input.ProviderTransactionID) > 256 || (input.ProcessingState != "pending" && input.ProcessingState != "posted" && input.ProcessingState != "removed") {
		return Result{Code: "INVALID_INPUT"}
	}
	return s.run(ctx, input.AttemptID, "record_source", input, func(tx pgx.Tx, _ auth.Actor) (Result, error) {
		var code string
		var id pgtype.UUID
		err := tx.QueryRow(ctx, `SELECT code,source_id FROM app.banking_record_source($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, pgID(input.BindingID), pgID(uuid.New()), input.ProviderTransactionID, input.ConnectionGeneration, input.BindingGeneration, input.ExpectedRevision, input.AmountMinor, input.Currency, pgtype.Date{Time: date, Valid: true}, input.ProcessingState, input.MappingVersion).Scan(&code, &id)
		return Result{Code: code, ID: safeID(id)}, err
	})
}

// Stop advances connection and binding generations while retaining private data.
func (s *Service) Stop(ctx context.Context, input FenceInput) Result {
	return s.fence(ctx, input, false)
}

// DeleteHistory immediately hides affected facts, annotations and captures and
// advances a durable barrier. It leaves cleanup intent and makes no claim that
// provider teardown, backup erasure or physical purge has completed.
func (s *Service) DeleteHistory(ctx context.Context, input FenceInput) Result {
	return s.fence(ctx, input, true)
}
func (s *Service) fence(ctx context.Context, input FenceInput, erase bool) Result {
	if input.AttemptID == uuid.Nil || input.ConnectionID == uuid.Nil || input.ExpectedGeneration < 1 {
		return Result{Code: "INVALID_INPUT"}
	}
	kind := "stop"
	if erase {
		kind = "delete_history"
	}
	return s.run(ctx, input.AttemptID, kind, input, func(tx pgx.Tx, _ auth.Actor) (Result, error) {
		var code string
		err := tx.QueryRow(ctx, `SELECT app.banking_fence($1,$2,$3)`, pgID(input.ConnectionID), input.ExpectedGeneration, erase).Scan(&code)
		return Result{Code: code}, err
	})
}

// The first transaction reserves an absent attempt across server processes. The
// second serializes effect+receipt; failure leaves durable pending recovery state.
func (s *Service) run(ctx context.Context, attempt uuid.UUID, kind string, input any, effect func(pgx.Tx, auth.Actor) (Result, error)) Result {
	canonical, err := json.Marshal(struct {
		Kind  string
		Input any
	}{kind, input})
	if err != nil {
		return failure(ctx, err)
	}
	var outcome Result
	pending := false
	err = auth.WithActor(ctx, s.db, func(tx pgx.Tx, actor auth.Actor) error {
		if _, err := tx.Exec(ctx, `SELECT app.lock_banking_owner()`); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, safeID(actor.ID).String()+"/"+attempt.String()); err != nil {
			return err
		}
		q := bankingquery.New(tx)
		saved, readErr := q.ReadOperation(ctx, pgID(attempt))
		if readErr != nil && !errors.Is(readErr, pgx.ErrNoRows) {
			return readErr
		}
		version := s.protector.current
		if readErr == nil {
			version = saved.KeyVersion
		}
		digest, digestErr := s.protector.digest(canonical, version)
		if digestErr != nil {
			return digestErr
		}
		if readErr == nil {
			if saved.Kind != kind || !hmac.Equal(saved.InputDigest, digest) {
				outcome.Code = "CONFLICT"
				return nil
			}
			if saved.State == "complete" {
				outcome = Result{Code: saved.ResultCode.String, ID: safeID(saved.ResultID)}
				return nil
			}
		} else if err := q.StartOperation(ctx, bankingquery.StartOperationParams{AttemptID: pgID(attempt), Kind: kind, InputDigest: digest, KeyVersion: version}); err != nil {
			return err
		}
		pending = true
		return nil
	})
	if err != nil {
		return failure(ctx, err)
	}
	if !pending {
		return outcome
	}
	err = auth.WithActor(ctx, s.db, func(tx pgx.Tx, actor auth.Actor) error {
		if _, err := tx.Exec(ctx, `SELECT app.lock_banking_owner()`); err != nil {
			return err
		}
		q := bankingquery.New(tx)
		saved, err := q.ReadOperation(ctx, pgID(attempt))
		if err != nil {
			return err
		}
		if saved.State == "complete" {
			outcome = Result{Code: saved.ResultCode.String, ID: safeID(saved.ResultID)}
			return nil
		}
		outcome, err = effect(tx, actor)
		if err != nil {
			return err
		}
		return q.CompleteOperation(ctx, bankingquery.CompleteOperationParams{AttemptID: pgID(attempt), ResultCode: pgtype.Text{String: outcome.Code, Valid: true}, ResultID: pgID(outcome.ID)})
	})
	if err != nil {
		return failure(ctx, err)
	}
	return outcome
}
func failure(ctx context.Context, err error) Result {
	code := "UNAVAILABLE"
	switch {
	case errors.Is(err, auth.Unauthenticated):
		code = "UNAUTHENTICATED"
	case errors.Is(err, auth.Disabled), errors.Is(err, auth.Unprovisioned):
		code = "FORBIDDEN"
	}
	if code == "UNAVAILABLE" {
		diagnostic.Report(ctx, diagnostic.Wrap(errors.New("banking storage unavailable"), err, "banking.storage"))
	}
	return Result{Code: code}
}

// Connection exposes lifecycle state without provider credentials.
type Connection struct {
	ID                             uuid.UUID
	Environment, State             string
	Generation, DeletionGeneration int64
}

// ReadConnection masks absent and other-owner identifiers with NOT_FOUND.
func (s *Service) ReadConnection(ctx context.Context, id uuid.UUID) (Connection, Result) {
	var result Connection
	outcome := Result{Code: "NOT_FOUND"}
	err := auth.WithActor(ctx, s.db, func(tx pgx.Tx, _ auth.Actor) error {
		if _, err := tx.Exec(ctx, `SELECT app.lock_banking_owner()`); err != nil {
			return err
		}
		row, err := bankingquery.New(tx).ReadConnection(ctx, pgID(id))
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		result = Connection{ID: safeID(row.ID), Environment: row.Environment, State: row.State, Generation: row.Generation, DeletionGeneration: row.DeletionGeneration}
		outcome = Result{Code: "READY", ID: result.ID}
		return nil
	})
	if err != nil {
		return Connection{}, failure(ctx, err)
	}
	return result, outcome
}

// Credential holds a temporary server-only secret; formatting is always redacted.
type Credential struct{ raw []byte }

// Bytes returns an independent copy for its owning provider adapter; consumers
// must never log it or publish it in operation results or shared Activity.
func (c Credential) Bytes() []byte { return append([]byte(nil), c.raw...) }

// String redacts secrets from diagnostics.
func (Credential) String() string { return "[redacted banking credential]" }

// GoString redacts secrets from Go-syntax diagnostics.
func (c Credential) GoString() string { return c.String() }

// ReadCredential reauthorizes ownership and authenticates owner, environment,
// record and purpose before returning server-only token bytes.
func (s *Service) ReadCredential(ctx context.Context, id uuid.UUID) (Credential, Result) {
	var secret Credential
	outcome := Result{Code: "NOT_FOUND"}
	err := auth.WithActor(ctx, s.db, func(tx pgx.Tx, actor auth.Actor) error {
		var environment, version string
		var protected []byte
		err := tx.QueryRow(ctx, `SELECT environment,key_version,ciphertext FROM app.banking_credential($1)`, pgID(id)).Scan(&environment, &version, &protected)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		secret.raw, err = s.protector.decrypt(protected, version, safeID(actor.ID).String(), id.String(), environment)
		if err == nil {
			outcome.Code = "READY"
		}
		return err
	})
	if err != nil {
		return Credential{}, failure(ctx, err)
	}
	return secret, outcome
}

// OperationStatus reauthorizes a durable attempt and returns only its pending or
// original opaque outcome. It never treats a missing browser response as failure.
func (s *Service) OperationStatus(ctx context.Context, attempt uuid.UUID) Result {
	outcome := Result{Code: "NOT_FOUND"}
	err := auth.WithActor(ctx, s.db, func(tx pgx.Tx, _ auth.Actor) error {
		if _, err := tx.Exec(ctx, `SELECT app.lock_banking_owner()`); err != nil {
			return err
		}
		row, err := bankingquery.New(tx).ReadOperation(ctx, pgID(attempt))
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		outcome.Code = "PENDING"
		if row.State == "complete" {
			outcome = Result{Code: row.ResultCode.String, ID: safeID(row.ResultID)}
		}
		return nil
	})
	if err != nil {
		return failure(ctx, err)
	}
	return outcome
}

// Source exposes immutable current facts. This storage projection performs no
// spending classification, aggregation or reporting-plan activation.
type Source struct {
	ID, BindingID                                    uuid.UUID
	Revision                                         int64
	AmountMinor, Currency, BankDate, ProcessingState string
}

// ReadSource masks inaccessible, deleted and absent identifiers identically.
func (s *Service) ReadSource(ctx context.Context, id uuid.UUID) (Source, Result) {
	var source Source
	outcome := Result{Code: "NOT_FOUND"}
	err := auth.WithActor(ctx, s.db, func(tx pgx.Tx, _ auth.Actor) error {
		if _, err := tx.Exec(ctx, `SELECT app.lock_banking_owner()`); err != nil {
			return err
		}
		row, err := bankingquery.New(tx).ReadSource(ctx, pgID(id))
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		source = Source{ID: safeID(row.ID), BindingID: safeID(row.BindingID), Revision: row.Revision.Int64, AmountMinor: strconv.FormatInt(row.AmountMinor, 10), Currency: row.Currency, BankDate: row.BankDate.Time.Format("2006-01-02"), ProcessingState: row.ProcessingState}
		outcome = Result{Code: "READY", ID: source.ID}
		return nil
	})
	if err != nil {
		return Source{}, failure(ctx, err)
	}
	return source, outcome
}
