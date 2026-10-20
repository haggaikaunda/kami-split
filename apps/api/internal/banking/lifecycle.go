package banking

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/jackc/pgx/v5"
)

// RepairProvider creates update-mode Link using an existing Item credential.
// Update mode never exchanges a public token or creates a replacement binding.
type RepairProvider interface {
	PrepareRepair(context.Context, string, string, Credential) (LinkPreparation, error)
}

// SelectionInput replaces the explicit local subset after checking current
// provider authorization. Empty selection retains history and stops every stream.
type SelectionInput struct {
	AttemptID, ConnectionID uuid.UUID
	ExpectedGeneration      int64
	AccountIDs              []string
}

// String prevents private selection references entering diagnostics.
func (SelectionInput) String() string { return "[redacted banking selection]" }

// GoString prevents Go-syntax diagnostics exposing selection references.
func (i SelectionInput) GoString() string { return i.String() }

// RepairInput reserves an expiring, actor-bound existing-Item repair handoff.
type RepairInput struct {
	AttemptID, ConnectionID uuid.UUID
	ExpectedGeneration      int64
}

// FinishRepairInput explicitly confirms the desired authorized subset. No public
// token is accepted: Plaid update mode preserves the existing access token.
type FinishRepairInput struct {
	AttemptID  uuid.UUID
	AccountIDs []string
}

// String prevents private provider references entering diagnostics.
func (FinishRepairInput) String() string { return "[redacted banking repair completion]" }

// GoString prevents Go-syntax diagnostics exposing provider references.
func (i FinishRepairInput) GoString() string { return i.String() }

type repairRecord struct {
	owner, connection                  uuid.UUID
	generation                         int64
	state, code, version, tokenVersion string
	expires                            time.Time
	link                               []byte
}

func readRepair(ctx context.Context, tx pgx.Tx, id uuid.UUID) (repairRecord, error) {
	var r repairRecord
	err := tx.QueryRow(ctx, `SELECT owner_id,connection_id,generation,state,result_code,key_version,coalesce(token_key_version,''),expires_at,CASE WHEN expires_at>clock_timestamp() THEN link_ciphertext ELSE NULL END FROM app.banking_repairs WHERE id=$1`, id).Scan(&r.owner, &r.connection, &r.generation, &r.state, &r.code, &r.version, &r.tokenVersion, &r.expires, &r.link)
	return r, err
}
func repairOutcome(id uuid.UUID, r repairRecord) EnrollmentOutcome {
	return EnrollmentOutcome{Code: r.code, State: r.state, AttemptID: id, ConnectionID: r.connection, ExpiresAt: r.expires}
}

// RepairStatus reauthorizes the current actor; it returns only safe operation
// status, never the encrypted handoff or private provider inventory.
func (s *EnrollmentService) RepairStatus(ctx context.Context, id uuid.UUID) EnrollmentOutcome {
	var r repairRecord
	err := s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error { var err error; r, err = readRepair(ctx, tx, id); return err })
	if errors.Is(err, pgx.ErrNoRows) {
		return EnrollmentOutcome{Code: "NOT_FOUND"}
	}
	if err != nil {
		return enrollmentFailure(ctx, err)
	}
	if r.state != "complete" {
		c, status := s.storage.ReadConnection(ctx, r.connection)
		if status.Code != "READY" {
			return EnrollmentOutcome{Code: status.Code}
		}
		if c.State != "active" || c.Generation != r.generation {
			r.code = "CONFLICT"
		} else if !r.expires.After(time.Now()) {
			r.code = "REPAIR_REQUIRED"
		}
	}
	return repairOutcome(id, r)
}

// StartRepair durably claims one update-mode handoff before provider I/O. A lost
// preparation response remains safe, visible and non-activating; a new attempt
// can retry repair without repeating any one-use token exchange.
func (s *EnrollmentService) StartRepair(ctx context.Context, input RepairInput) EnrollmentOutcome {
	if input.AttemptID == uuid.Nil || input.ConnectionID == uuid.Nil || input.ExpectedGeneration < 1 {
		return EnrollmentOutcome{Code: "INVALID_INPUT"}
	}
	provider, ok := s.provider.(RepairProvider)
	if !ok {
		return EnrollmentOutcome{Code: "REPAIR_UNAVAILABLE"}
	}
	canonical, _ := json.Marshal(input)
	code := ""
	err := s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		version := s.storage.protector.current
		existing, err := readRepair(ctx, tx, input.AttemptID)
		if err == nil {
			version = existing.version
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		digest, err := s.storage.protector.digest(canonical, version)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT app.banking_repair_start($1,$2,$3,$4,$5)`, input.AttemptID, input.ConnectionID, input.ExpectedGeneration, digest, version).Scan(&code)
	})
	if err != nil {
		return enrollmentFailure(ctx, err)
	}
	if code == "NOT_FOUND" || code == "CONFLICT" || code == "ATTEMPT_IN_PROGRESS" {
		return EnrollmentOutcome{Code: code}
	}
	if code == "CLAIMED" {
		var record repairRecord
		err = s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error {
			var err error
			record, err = readRepair(ctx, tx, input.AttemptID)
			return err
		})
		if err != nil {
			return enrollmentFailure(ctx, err)
		}
		c, status := s.storage.ReadConnection(ctx, input.ConnectionID)
		if status.Code != "READY" {
			return EnrollmentOutcome{Code: status.Code}
		}
		credential, status := s.storage.ReadCredential(ctx, input.ConnectionID)
		if status.Code != "READY" {
			return EnrollmentOutcome{Code: status.Code}
		}
		defer clear(credential.raw)
		prepared, providerErr := provider.PrepareRepair(ctx, c.Environment, "kami-"+record.owner.String()+"-"+c.Environment, credential)
		var encrypted []byte
		version := ""
		expiry := time.Now().Add(30 * time.Minute)
		if providerErr == nil {
			expiry = prepared.ExpiresAt
			encrypted, version, err = s.storage.protector.encrypt([]byte(prepared.LinkToken), record.owner.String(), "repair/"+input.AttemptID.String(), c.Environment)
			if err != nil {
				return enrollmentFailure(ctx, err)
			}
		}
		err = s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error {
			_, err := tx.Exec(ctx, `SELECT app.banking_repair_prepared($1,$2,$3,$4)`, input.AttemptID, encrypted, version, expiry)
			return err
		})
		if err != nil {
			return enrollmentFailure(ctx, err)
		}
	}
	result := s.RepairStatus(ctx, input.AttemptID)
	if result.Code != "PREPARED" {
		return result
	}
	var r repairRecord
	err = s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		var err error
		r, err = readRepair(ctx, tx, input.AttemptID)
		return err
	})
	if err != nil {
		return enrollmentFailure(ctx, err)
	}
	if len(r.link) > 0 {
		c, status := s.storage.ReadConnection(ctx, r.connection)
		if status.Code != "READY" {
			return EnrollmentOutcome{Code: status.Code}
		}
		raw, err := s.storage.protector.decrypt(r.link, r.tokenVersion, r.owner.String(), "repair/"+input.AttemptID.String(), c.Environment)
		if err != nil {
			return enrollmentFailure(ctx, err)
		}
		result.LinkToken = string(raw)
		clear(raw)
	}
	return result
}
func validSelection(ids []string) bool {
	if len(ids) > 100 {
		return false
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if !validProviderID(id) || seen[id] {
			return false
		}
		seen[id] = true
	}
	return true
}
func (s *EnrollmentService) inventory(ctx context.Context, connection uuid.UUID, ids []string) (AccountInventory, []selectedAccount, string) {
	c, status := s.storage.ReadConnection(ctx, connection)
	if status.Code != "READY" {
		return AccountInventory{}, nil, status.Code
	}
	if c.State != "active" {
		return AccountInventory{}, nil, "CONFLICT"
	}
	credential, status := s.storage.ReadCredential(ctx, connection)
	if status.Code != "READY" {
		return AccountInventory{}, nil, status.Code
	}
	defer clear(credential.raw)
	inventory, err := s.provider.Accounts(ctx, c.Environment, credential)
	if err != nil {
		saveErr := s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error {
			_, err := tx.Exec(ctx, `SELECT app.banking_repair_needed($1,$2)`, connection, c.Generation)
			return err
		})
		if saveErr != nil {
			return AccountInventory{}, nil, enrollmentFailure(ctx, saveErr).Code
		}
		return AccountInventory{}, nil, "REPAIR_REQUIRED"
	}
	selected, valid := selectAccounts(inventory, ids)
	if len(ids) == 0 {
		valid = inventory.CountryCode == "US" && inventory.ItemID != "" && inventory.InstitutionID != ""
		selected = []selectedAccount{}
	}
	if !valid {
		return AccountInventory{}, nil, "INVALID_SELECTION"
	}
	return inventory, selected, "READY"
}

// ChangeSelection checks current server-observed authorization outside the
// transaction, then atomically replaces the subset under lifecycle CAS. Replays
// recover the original receipt even when the provider is currently unavailable.
func (s *EnrollmentService) ChangeSelection(ctx context.Context, input SelectionInput) Result {
	if input.AttemptID == uuid.Nil || input.ConnectionID == uuid.Nil || input.ExpectedGeneration < 1 || !validSelection(input.AccountIDs) {
		return Result{Code: "INVALID_INPUT"}
	}
	input.AccountIDs = append([]string(nil), input.AccountIDs...)
	sort.Strings(input.AccountIDs)

	result, pending := s.storage.reserve(ctx, input.AttemptID, "selection", input)
	if !pending {
		return result
	}
	complete := func(code string) Result {
		return s.storage.run(ctx, input.AttemptID, "selection", input, func(pgx.Tx, auth.Actor) (Result, error) { return Result{Code: code}, nil })
	}
	connection, status := s.storage.ReadLifecycle(ctx, input.ConnectionID)
	if status.Code != "READY" {
		return complete(status.Code)
	}
	if connection.State != "active" || connection.Generation != input.ExpectedGeneration {
		return complete("CONFLICT")
	}
	inventory, selected, code := s.deselection(ctx, input.ConnectionID, input.AccountIDs)
	if code == "AUTHORIZATION_REQUIRED" {
		inventory, selected, code = s.inventory(ctx, input.ConnectionID, input.AccountIDs)
	}
	if code != "READY" {
		return complete(code)
	}
	encoded, _ := json.Marshal(selected)
	return s.storage.run(ctx, input.AttemptID, "selection", input, func(tx pgx.Tx, _ auth.Actor) (Result, error) {
		var code string
		err := tx.QueryRow(ctx, `SELECT app.banking_selection($1,$2,$3,$4,$5)`, input.ConnectionID, input.ExpectedGeneration, encoded, inventory.InstitutionID, inventory.ItemID).Scan(&code)
		return Result{Code: code, ID: input.ConnectionID}, err
	})
}

// FinishRepair rechecks provider account authorization and exact binding identity
// before CAS. Delayed completion cannot re-enable a stopped/deleted generation.
func (s *EnrollmentService) FinishRepair(ctx context.Context, input FinishRepairInput) EnrollmentOutcome {
	if input.AttemptID == uuid.Nil || !validSelection(input.AccountIDs) {
		return EnrollmentOutcome{Code: "INVALID_INPUT"}
	}
	input.AccountIDs = append([]string(nil), input.AccountIDs...)
	sort.Strings(input.AccountIDs)
	canonical, _ := json.Marshal(input)
	var r repairRecord
	var digest []byte
	err := s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		var err error
		r, err = readRepair(ctx, tx, input.AttemptID)
		if err != nil {
			return err
		}
		digest, err = s.storage.protector.digest(canonical, r.version)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return EnrollmentOutcome{Code: "NOT_FOUND"}
	}
	if err != nil {
		return enrollmentFailure(ctx, err)
	}

	claim := ""
	err = s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		return tx.QueryRow(ctx, `SELECT app.banking_repair_finish_claim($1,$2)`, input.AttemptID, digest).Scan(&claim)
	})
	if err != nil {
		return enrollmentFailure(ctx, err)
	}
	if claim == "CONFLICT" {
		return EnrollmentOutcome{Code: claim}
	}
	if claim != "CLAIMED" {
		return s.RepairStatus(ctx, input.AttemptID)
	}
	inventory := AccountInventory{}
	selected := []selectedAccount{}
	if r.state != "complete" {
		status := s.RepairStatus(ctx, input.AttemptID)
		if status.Code != "PREPARED" {
			return status
		}
		var code string
		inventory, selected, code = s.inventory(ctx, r.connection, input.AccountIDs)
		if code != "READY" {
			return EnrollmentOutcome{Code: code}
		}
	}
	encoded, _ := json.Marshal(selected)
	code := ""
	err = s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		return tx.QueryRow(ctx, `SELECT app.banking_repair_finish($1,$2,$3,$4,$5)`, input.AttemptID, digest, encoded, inventory.InstitutionID, inventory.ItemID).Scan(&code)
	})
	if err != nil {
		return enrollmentFailure(ctx, err)
	}
	if code == "CONFLICT" {
		return EnrollmentOutcome{Code: code}
	}
	return s.RepairStatus(ctx, input.AttemptID)
}

// deselection uses only already-selected streams, so an owner can stop collecting
// even during a provider outage. Any addition/reselection requires live authority.
func (s *EnrollmentService) deselection(ctx context.Context, connection uuid.UUID, ids []string) (AccountInventory, []selectedAccount, string) {
	inventory := AccountInventory{CountryCode: "US"}
	selected := []selectedAccount{}
	code := "AUTHORIZATION_REQUIRED"
	err := s.actor(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		if err := tx.QueryRow(ctx, `SELECT provider_item_id FROM app.banking_connections WHERE id=$1 AND state='active'`, connection).Scan(&inventory.ItemID); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT b.provider_account_id,m.display_name,a.kind,m.currency,m.stable_id,m.institution_id FROM app.banking_bindings b JOIN app.banking_accounts a ON a.id=b.account_id JOIN app.banking_enrollment_accounts m ON m.binding_id=b.id WHERE b.connection_id=$1 AND a.selected AND b.reporting_state IN('current','staged') AND NOT b.collection_stopped`, connection)
		if err != nil {
			return err
		}
		defer rows.Close()
		available := map[string]selectedAccount{}
		for rows.Next() {
			var a selectedAccount
			var institution string
			if err := rows.Scan(&a.ID, &a.Name, &a.Kind, &a.Currency, &a.StableID, &institution); err != nil {
				return err
			}
			available[a.ID] = a
			inventory.InstitutionID = institution
		}
		if err := rows.Err(); err != nil {
			return err
		}
		for _, id := range ids {
			a, ok := available[id]
			if !ok {
				return nil
			}
			selected = append(selected, a)
		}
		code = "READY"
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return inventory, nil, "NOT_FOUND"
	}
	if err != nil {
		return inventory, nil, enrollmentFailure(ctx, err).Code
	}
	return inventory, selected, code
}
