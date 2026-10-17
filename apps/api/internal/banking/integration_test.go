//go:build integration

package banking

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database/bankingquery"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/jackc/pgx/v5"
)

type fixture struct {
	t            *testing.T
	db           *database.DB
	admin        *pgx.Conn
	service      *Service
	owner, other uuid.UUID
	verifier     *auth.Verifier
	key          *ecdsa.PrivateKey
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
	if err != nil {
		t.Fatal(err)
	}
	db, err := database.Open(ctx, database.Config{URL: os.Getenv("TEST_DATABASE_URL"), MaxConns: 10, Timeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{t: t, db: db, admin: admin, owner: uuid.New(), other: uuid.New()}
	t.Cleanup(func() {
		db.Close()
		if err := admin.Close(context.Background()); err != nil {
			t.Error(err)
		}
	})
	f.exec(`INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4)`, f.owner, f.owner.String()+"@bank-owner.example.invalid", f.other, f.other.String()+"@bank-other.example.invalid")
	f.exec(`SET ROLE kami_migrator`)
	f.exec(`INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES($1,$1,$1,'Bank owner'),($2,$2,$2,'Other owner')`, f.owner, f.other)
	// Shared group membership confers no private banking access.
	group, membership := uuid.New(), uuid.New()
	tx, err := admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO app.groups(id,name,owner_membership_id) VALUES($1,'Synthetic banking isolation',$2)`, group, membership); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO app.memberships(id,group_id,user_id) VALUES($1,$2,$3),($4,$2,$5)`, membership, group, f.owner, uuid.New(), f.other); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	f.key = key
	jwks, _ := json.Marshal(map[string]any{"keys": []any{map[string]string{"kty": "EC", "crv": "P-256", "kid": "bank-test", "alg": "ES256", "use": "sig", "x": base64.RawURLEncoding.EncodeToString(key.X.FillBytes(make([]byte, 32))), "y": base64.RawURLEncoding.EncodeToString(key.Y.FillBytes(make([]byte, 32)))}}})
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(jwks) }))
	t.Cleanup(remote.Close)
	f.verifier, err = auth.New(auth.Config{Issuer: "https://bank-auth.example.invalid", Audience: "authenticated", JWKSURL: remote.URL})
	if err != nil {
		t.Fatal(err)
	}
	if err = f.verifier.Warm(ctx); err != nil {
		t.Fatal(err)
	}
	p, _ := NewProtector("one", map[string][]byte{"one": bytes.Repeat([]byte{1}, 32)})
	f.service, err = New(db, p)
	if err != nil {
		t.Fatal(err)
	}
	// Fixture rows deliberately survive for the disposable harness dump/restore.
	return f
}
func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.admin.Exec(context.Background(), sql, args...); err != nil {
		f.t.Fatal(err)
	}
}
func (f *fixture) actor(subject uuid.UUID) context.Context {
	f.t.Helper()
	now := time.Now()
	token := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{"sub": subject.String(), "iss": "https://bank-auth.example.invalid", "aud": "authenticated", "exp": now.Add(time.Hour).Unix(), "iat": now.Unix(), "role": "authenticated"})
	token.Header["kid"] = "bank-test"
	raw, err := token.SignedString(f.key)
	if err != nil {
		f.t.Fatal(err)
	}
	req := httptest.NewRequest("POST", "/", nil)
	req.Header.Set("Authorization", "Bearer "+raw)
	var ctx context.Context
	f.verifier.Authenticate(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { ctx = r.Context() })).ServeHTTP(httptest.NewRecorder(), req)
	return ctx
}
func (f *fixture) connection(owner uuid.UUID, item string) uuid.UUID {
	f.t.Helper()
	result := f.service.CreateConnection(f.actor(owner), ConnectionInput{AttemptID: uuid.New(), Environment: "sandbox", ProviderItemID: item, AccessToken: "synthetic-bank-token"})
	if result.Code != "READY" {
		f.t.Fatalf("create connection: %s", result.Code)
	}
	return result.ID
}
func (f *fixture) binding(owner, connection uuid.UUID, providerID string) (uuid.UUID, uuid.UUID) {
	f.t.Helper()
	account, binding := uuid.New(), uuid.New()
	f.exec(`INSERT INTO app.banking_accounts(id,owner_id,kind,selected) VALUES($1,$2,'checking',true)`, account, owner)
	f.exec(`INSERT INTO app.banking_bindings(id,owner_id,connection_id,account_id,provider_account_id) VALUES($1,$2,$3,$4,$5)`, binding, owner, connection, account, providerID)
	return account, binding
}
func sourceInput(binding uuid.UUID) SourceInput {
	return SourceInput{AttemptID: uuid.New(), BindingID: binding, ProviderTransactionID: "provider-tx", ConnectionGeneration: 1, BindingGeneration: 1, AmountMinor: "-9223372036854775808", Currency: "USD", BankDate: "2024-02-29", ProcessingState: "posted", MappingVersion: "pfc-v2"}
}
func requireCode(t *testing.T, result Result, code string) {
	t.Helper()
	if result.Code != code {
		t.Fatalf("status = %s, want %s", result.Code, code)
	}
}

func TestPrivatePersistenceAndFences(t *testing.T) {
	f := newFixture(t)
	ctx := f.actor(f.owner)
	other := f.actor(f.other)
	connection := f.connection(f.owner, "joint-item")
	account, binding := f.binding(f.owner, connection, "same-provider-account")
	// Independent holders may use exactly the same provider identifiers.
	joint := f.connection(f.other, "joint-item")
	_, jointBinding := f.binding(f.other, joint, "same-provider-account")
	input := sourceInput(binding)
	created := f.service.RecordSource(ctx, input)
	requireCode(t, created, "READY")
	input2 := sourceInput(jointBinding)
	requireCode(t, f.service.RecordSource(other, input2), "READY")
	var saved bankingquery.ReadSourceRow
	err := f.db.WithIdentity(context.Background(), f.owner.String(), func(tx pgx.Tx) error {
		var err error
		saved, err = bankingquery.New(tx).ReadSource(context.Background(), pgID(created.ID))
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if saved.AmountMinor != -9223372036854775808 || saved.BankDate.Time.Format("2006-01-02") != "2024-02-29" || saved.Currency != "USD" {
		t.Fatal("exact amount/date round trip failed")
	}
	_, masked := f.service.ReadConnection(other, connection)
	requireCode(t, masked, "NOT_FOUND")
	_, masked = f.service.ReadCredential(other, connection)
	requireCode(t, masked, "NOT_FOUND")
	secret, read := f.service.ReadCredential(ctx, connection)
	requireCode(t, read, "READY")
	if string(secret.Bytes()) != "synthetic-bank-token" {
		t.Fatal("credential roundtrip")
	}
	// Fixtures include separate immutable annotations, a staged revision, a plan
	// and archive capture. They are migration-owned, not public editing APIs.
	plan, archive, batch := uuid.New(), uuid.New(), uuid.New()
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,note,excluded) VALUES($1,$2,1,1,'private fixture note',true)`, created.ID, f.owner)
	f.exec(`INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,amount_minor,currency,bank_date,processing_state,mapping_version,stage,batch_id) VALUES($1,$2,2,123,'USD','2024-03-01','posted','pfc-v2','staged',$3)`, created.ID, f.owner, batch)
	f.exec(`INSERT INTO app.banking_plans(id,owner_id,account_id,revision) VALUES($1,$2,$3,1)`, plan, f.owner, account)
	f.exec(`INSERT INTO app.banking_plan_intervals(plan_id,owner_id,binding_id) VALUES($1,$2,$3)`, plan, f.owner, binding)
	f.exec(`INSERT INTO app.banking_plan_sources(plan_id,owner_id,source_id,source_revision) VALUES($1,$2,$3,1)`, plan, f.owner, created.ID)
	f.exec(`INSERT INTO app.banking_archives(id,owner_id,plan_id,boundary_date) VALUES($1,$2,$3,'2024-02-29')`, archive, f.owner, plan)
	f.exec(`INSERT INTO app.banking_captures(archive_id,owner_id,source_id,source_revision,annotation_revision) VALUES($1,$2,$3,1,1)`, archive, f.owner, created.ID)
	for _, table := range []string{"connections", "accounts", "bindings", "sources", "source_revisions", "annotations", "plans", "plan_intervals", "plan_sources", "archives", "captures", "operations"} {
		var count int
		err := f.db.WithIdentity(context.Background(), f.other.String(), func(tx pgx.Tx) error {
			return tx.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_`+table+` WHERE owner_id=$1`, f.owner).Scan(&count)
		})
		if err != nil || count != 0 {
			t.Fatalf("%s cross-owner: count=%d error=%v", table, count, err)
		}
	}
	requireCode(t, f.service.RecordSource(ctx, input), "READY") // response-loss recovery
	changed := input
	changed.AmountMinor = "1"
	requireCode(t, f.service.RecordSource(ctx, changed), "CONFLICT")
	stop := FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}
	requireCode(t, f.service.Stop(ctx, stop), "READY")
	late := input
	late.AttemptID = uuid.New()
	late.ExpectedRevision = 1
	requireCode(t, f.service.RecordSource(ctx, late), "CONFLICT")
	_, read = f.service.ReadConnection(ctx, connection)
	requireCode(t, read, "READY")
	requireCode(t, f.service.DeleteHistory(ctx, FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 2}), "READY")
	_, read = f.service.ReadConnection(ctx, connection)
	requireCode(t, read, "NOT_FOUND")
	_, read = f.service.ReadCredential(ctx, connection)
	requireCode(t, read, "NOT_FOUND")
	for _, table := range []string{"sources", "source_revisions", "annotations", "captures"} {
		var count int
		err := f.db.WithIdentity(context.Background(), f.owner.String(), func(tx pgx.Tx) error {
			return tx.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_`+table+` WHERE owner_id=$1`, f.owner).Scan(&count)
		})
		if err != nil || count != 0 {
			t.Fatalf("deleted %s remains visible: %d %v", table, count, err)
		}
	}
	// Receipt recovery returns only an opaque source ID; financial data stays hidden.
	requireCode(t, f.service.RecordSource(ctx, input), "READY")
	var barrier int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_deletion_barriers WHERE connection_id=$1 AND generation=1 AND cleanup_state='pending'`, connection).Scan(&barrier); err != nil || barrier != 1 {
		t.Fatal("missing durable deletion barrier")
	}
	// The other joint holder's source and credentials are unaffected.
	_, read = f.service.ReadCredential(other, joint)
	requireCode(t, read, "READY")

	// Test-owned purge follows explicit provenance references, including staged
	// facts. Only opaque receipts/barriers survive; this is not a worker runtime.
	var revisions, annotations, captures, planSources int
	if err := f.admin.QueryRow(context.Background(), `SELECT
  (SELECT count(*) FROM app.banking_source_revisions WHERE source_id=$1),
  (SELECT count(*) FROM app.banking_annotations WHERE source_id=$1),
  (SELECT count(*) FROM app.banking_captures WHERE source_id=$1),
  (SELECT count(*) FROM app.banking_plan_sources WHERE source_id=$1)`, created.ID).Scan(&revisions, &annotations, &captures, &planSources); err != nil || revisions != 2 || annotations != 1 || captures != 1 || planSources != 1 {
		t.Fatal("incomplete retained-data enumeration")
	}
	purge, err := f.admin.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, command := range []struct {
		sql string
		id  uuid.UUID
	}{
		{`DELETE FROM app.banking_captures WHERE source_id=$1`, created.ID},
		{`DELETE FROM app.banking_plan_sources WHERE source_id=$1`, created.ID},
		{`DELETE FROM app.banking_archives WHERE id=$1`, archive},
		{`DELETE FROM app.banking_plan_intervals WHERE plan_id=$1`, plan},
		{`DELETE FROM app.banking_plans WHERE id=$1`, plan},
		{`DELETE FROM app.banking_annotations WHERE source_id=$1`, created.ID},
		{`DELETE FROM app.banking_source_revisions WHERE source_id=$1`, created.ID},
		{`DELETE FROM app.banking_sources WHERE id=$1`, created.ID},
	} {
		if _, err := purge.Exec(context.Background(), command.sql, command.id); err != nil {
			t.Fatal(err)
		}
	}
	if err := purge.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	_, read = f.service.ReadSource(ctx, created.ID)
	requireCode(t, read, "NOT_FOUND")
	requireCode(t, f.service.RecordSource(ctx, input), "READY")
	f.exec(`UPDATE app.users SET enabled=false WHERE id=$1`, f.owner)
	_, read = f.service.ReadConnection(ctx, connection)
	requireCode(t, read, "FORBIDDEN")
	requireCode(t, f.service.Stop(ctx, FenceInput{AttemptID: uuid.New(), ConnectionID: joint, ExpectedGeneration: 1}), "FORBIDDEN")
	requireCode(t, f.service.CreateConnection(context.Background(), ConnectionInput{AttemptID: uuid.New(), Environment: "sandbox", ProviderItemID: "missing", AccessToken: "secret"}), "UNAUTHENTICATED")
}

func TestConcurrentAttemptsAndRollback(t *testing.T) {
	f := newFixture(t)
	ctx := f.actor(f.owner)
	connection := f.connection(f.owner, "concurrency")
	_, binding := f.binding(f.owner, connection, "account")
	input := sourceInput(binding)
	var wg sync.WaitGroup
	results := make(chan Result, 8)
	for range 8 {
		wg.Add(1)
		go func() { defer wg.Done(); results <- f.service.RecordSource(ctx, input) }()
	}
	wg.Wait()
	close(results)
	var id uuid.UUID
	for result := range results {
		requireCode(t, result, "READY")
		if id == uuid.Nil {
			id = result.ID
		}
		if result.ID != id {
			t.Fatal("duplicate effect")
		}
	}
	var count int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_source_revisions WHERE source_id=$1`, id).Scan(&count); err != nil || count != 1 {
		t.Fatal("more than one committed revision")
	}
	// Different input on the same fresh attempt races to exactly one winner.
	a := input
	a.AttemptID = uuid.New()
	a.ExpectedRevision = 1
	a.AmountMinor = "5"
	b := a
	b.AmountMinor = "6"
	results = make(chan Result, 2)
	for _, command := range []SourceInput{a, b} {
		wg.Add(1)
		go func(command SourceInput) { defer wg.Done(); results <- f.service.RecordSource(ctx, command) }(command)
	}
	wg.Wait()
	close(results)
	codes := map[string]int{}
	for result := range results {
		codes[result.Code]++
	}
	if codes["READY"] != 1 || codes["CONFLICT"] != 1 {
		t.Fatalf("different-input race: %v", codes)
	}
	// A deterministic effect failure must roll back its source+revision and retain
	// the earlier pending attempt. Restore the dependency then retry the same input.
	retry := input
	retry.AttemptID = uuid.New()
	retry.ProviderTransactionID = "rollback"
	f.exec(`CREATE FUNCTION app.banking_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic bank payload must stay private'; END $$`)
	f.exec(`CREATE TRIGGER banking_test_fail BEFORE INSERT ON app.banking_source_revisions FOR EACH ROW EXECUTE FUNCTION app.banking_test_fail()`)
	var diagnostics []string
	failedCtx := diagnostic.WithReporter(ctx, func(label string) { diagnostics = append(diagnostics, label) })
	requireCode(t, f.service.RecordSource(failedCtx, retry), "UNAVAILABLE")
	if len(diagnostics) != 1 || diagnostics[0] != "banking.storage" {
		t.Fatalf("unsafe diagnostics: %v", diagnostics)
	}
	f.exec(`DROP TRIGGER banking_test_fail ON app.banking_source_revisions`)
	f.exec(`DROP FUNCTION app.banking_test_fail()`)
	var state string
	if err := f.admin.QueryRow(context.Background(), `SELECT state FROM app.banking_operations WHERE owner_id=$1 AND attempt_id=$2`, f.owner, retry.AttemptID).Scan(&state); err != nil || state != "pending" {
		t.Fatal("operation was not durable before effects")
	}
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_sources WHERE binding_id=$1 AND provider_transaction_id='rollback'`, binding).Scan(&count); err != nil || count != 0 {
		t.Fatal("partial source survived rollback")
	}
	requireCode(t, f.service.RecordSource(ctx, retry), "READY")
}

func TestRestrictedRolesInvalidFactsAndCredentials(t *testing.T) {
	f := newFixture(t)
	ctx := f.actor(f.owner)
	connection := f.connection(f.owner, "negative")
	_, binding := f.binding(f.owner, connection, "account")
	for _, change := range []func(*SourceInput){func(i *SourceInput) { i.AmountMinor = "1.2" }, func(i *SourceInput) { i.AmountMinor = "9223372036854775808" }, func(i *SourceInput) { i.AmountMinor = "-9223372036854775809" }, func(i *SourceInput) { i.AmountMinor = "01" }, func(i *SourceInput) { i.Currency = "EUR" }, func(i *SourceInput) { i.BankDate = "2023-02-29" }, func(i *SourceInput) { i.BankDate = "0000-01-01" }} {
		input := sourceInput(binding)
		change(&input)
		requireCode(t, f.service.RecordSource(ctx, input), "INVALID_INPUT")
	}
	// Browser and provider-service roles have neither banking data nor function access.
	for _, role := range []string{"anon", "authenticated", "service_role"} {
		f.exec(`RESET ROLE`)
		f.exec(`SET ROLE ` + role)
		for _, sql := range []string{`SELECT * FROM app.banking_connections`, `SELECT * FROM app.banking_credentials`, `SELECT app.banking_credential('` + connection.String() + `')`, `SELECT * FROM app.banking_operations`} {
			if _, err := f.admin.Exec(context.Background(), sql); err == nil {
				t.Fatalf("%s unexpectedly allowed banking access", role)
			}
		}
	}
	f.exec(`RESET ROLE`)
	f.exec(`SET ROLE kami_migrator`)
	err := f.db.WithIdentity(context.Background(), f.owner.String(), func(tx pgx.Tx) error {
		_, err := tx.Exec(context.Background(), `SELECT * FROM app.banking_credentials`)
		return err
	})
	if err == nil {
		t.Fatal("runtime raw credential read allowed")
	}
	// Ciphertext is protected even if storage is tampered with by its DDL owner.
	f.exec(`UPDATE app.banking_credentials SET ciphertext=set_byte(ciphertext,octet_length(ciphertext)-1,get_byte(ciphertext,octet_length(ciphertext)-1)#1) WHERE connection_id=$1`, connection)
	secret, result := f.service.ReadCredential(ctx, connection)
	requireCode(t, result, "UNAVAILABLE")
	if len(secret.Bytes()) != 0 {
		t.Fatal("failed decryption returned secret")
	}
	if strings.Contains(fmt.Sprint(result), "synthetic") {
		t.Fatal("public operation result disclosed payload")
	}
	// Fresh transaction-local context without a verified enabled identity is denied.
	err = f.db.WithIdentity(context.Background(), uuid.NewString(), func(tx pgx.Tx) error {
		_, err := tx.Exec(context.Background(), `SELECT app.lock_banking_owner()`)
		return err
	})
	if err == nil || errors.Is(err, pgx.ErrNoRows) {
		t.Fatal("unprovisioned identity was not denied")
	}
}

func TestBlockedWriteCannotCrossDeletionFence(t *testing.T) {
	f := newFixture(t)
	ctx := f.actor(f.owner)
	connection := f.connection(f.owner, "late-write")
	_, binding := f.binding(f.owner, connection, "account")
	tx, err := database.IntegrationPool(f.db).Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), `SELECT set_config('app.verified_sub',$1,true)`, f.owner.String()); err != nil {
		t.Fatal(err)
	}
	var code string
	if err = tx.QueryRow(context.Background(), `SELECT app.banking_fence($1,1,true)`, connection).Scan(&code); err != nil || code != "READY" {
		t.Fatalf("fence: %s %v", code, err)
	}
	var fencePID int
	if err := tx.QueryRow(context.Background(), `SELECT pg_backend_pid()`).Scan(&fencePID); err != nil {
		t.Fatal(err)
	}
	input := sourceInput(binding)
	done := make(chan Result, 1)
	go func() { done <- f.service.RecordSource(ctx, input) }()
	// Observe the actual PostgreSQL lock wait before releasing the fence. No
	// process-local mutex can make this test pass in place of the row protocol.
	deadline := time.Now().Add(5 * time.Second)
	blocked := false
	for time.Now().Before(deadline) {
		var count int
		err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM pg_locks WHERE NOT granted AND $1=ANY(pg_blocking_pids(pid))`, fencePID).Scan(&count)
		if err != nil {
			t.Fatal(err)
		}
		if count > 0 {
			blocked = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !blocked {
		t.Fatal("source writer never waited on database fence")
	}
	if err = tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	select {
	case result := <-done:
		requireCode(t, result, "CONFLICT")
	case <-time.After(5 * time.Second):
		t.Fatal("writer did not finish")
	}
	var count int
	if err = f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_sources WHERE binding_id=$1`, binding).Scan(&count); err != nil || count != 0 {
		t.Fatal("late source resurrected deleted data")
	}
}

func TestStoredKeyRotationAndRevocation(t *testing.T) {
	f := newFixture(t)
	ctx := f.actor(f.owner)
	input := ConnectionInput{AttemptID: uuid.New(), Environment: "sandbox", ProviderItemID: "rotate", AccessToken: "synthetic-rotation-token"}
	created := f.service.CreateConnection(ctx, input)
	requireCode(t, created, "READY")
	p, err := NewProtector("two", map[string][]byte{"one": bytes.Repeat([]byte{1}, 32), "two": bytes.Repeat([]byte{2}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	rotated, err := New(f.db, p)
	if err != nil {
		t.Fatal(err)
	}
	secret, result := rotated.ReadCredential(ctx, created.ID)
	requireCode(t, result, "READY")
	if string(secret.Bytes()) != input.AccessToken {
		t.Fatal("old credential unavailable after rotation")
	}
	requireCode(t, rotated.CreateConnection(ctx, input), "READY") // old digest key retained
	p, _ = NewProtector("two", map[string][]byte{"two": bytes.Repeat([]byte{2}, 32)})
	missing, _ := New(f.db, p)
	_, result = missing.ReadCredential(ctx, created.ID)
	requireCode(t, result, "UNAVAILABLE")
	requireCode(t, missing.CreateConnection(ctx, input), "UNAVAILABLE")
	requireCode(t, rotated.OperationStatus(f.actor(f.other), input.AttemptID), "NOT_FOUND")
	// Deleting the provider identity revokes access even while the request's JWT
	// remains cryptographically valid. Banking does not recreate application access.
	f.exec(`UPDATE app.users SET enabled=false WHERE id=$1`, f.owner)
	f.exec(`RESET ROLE`)
	f.exec(`DELETE FROM auth.users WHERE id=$1`, f.owner)
	f.exec(`SET ROLE kami_migrator`)
	_, result = rotated.ReadCredential(ctx, created.ID)
	requireCode(t, result, "FORBIDDEN")
	requireCode(t, rotated.OperationStatus(ctx, input.AttemptID), "FORBIDDEN")
}

func TestHistoricalIntegrityConstraints(t *testing.T) {
	f := newFixture(t)
	ctx := f.actor(f.owner)
	connection := f.connection(f.owner, "historical-integrity")
	account, binding := f.binding(f.owner, connection, "first")
	otherAccount, otherBinding := f.binding(f.owner, connection, "sibling")
	_ = otherAccount
	source := f.service.RecordSource(ctx, sourceInput(binding))
	requireCode(t, source, "READY")
	otherInput := sourceInput(otherBinding)
	otherSource := f.service.RecordSource(ctx, otherInput)
	requireCode(t, otherSource, "READY")
	plan, archive := uuid.New(), uuid.New()
	f.exec(`INSERT INTO app.banking_plans(id,owner_id,account_id,revision) VALUES($1,$2,$3,1)`, plan, f.owner, account)
	f.exec(`INSERT INTO app.banking_plan_intervals(plan_id,owner_id,binding_id,through_date) VALUES($1,$2,$3,'2026-09-30')`, plan, f.owner, binding)
	expectDenied := func(sql string, args ...any) {
		t.Helper()
		if _, err := f.admin.Exec(context.Background(), sql, args...); err == nil {
			t.Fatal("invalid historical mutation accepted")
		}
	}
	expectDenied(`INSERT INTO app.banking_plan_intervals(plan_id,owner_id,binding_id,after_date) VALUES($1,$2,$3,'2026-09-30')`, plan, f.owner, otherBinding)
	historicalBinding := uuid.New()
	f.exec(`INSERT INTO app.banking_bindings(id,owner_id,connection_id,account_id,provider_account_id) VALUES($1,$2,$3,$4,'replacement')`, historicalBinding, f.owner, connection, account)
	expectDenied(`INSERT INTO app.banking_plan_intervals(plan_id,owner_id,binding_id,after_date) VALUES($1,$2,$3,'2026-09-29')`, plan, f.owner, historicalBinding)
	f.exec(`INSERT INTO app.banking_plan_intervals(plan_id,owner_id,binding_id,after_date) VALUES($1,$2,$3,'2026-09-30')`, plan, f.owner, historicalBinding)
	f.exec(`INSERT INTO app.banking_archives(id,owner_id,plan_id,boundary_date) VALUES($1,$2,$3,'2026-09-30')`, archive, f.owner, plan)
	expectDenied(`INSERT INTO app.banking_captures(archive_id,owner_id,source_id,source_revision) VALUES($1,$2,$3,1)`, archive, f.owner, otherSource.ID)
	expectDenied(`INSERT INTO app.banking_plan_sources(plan_id,owner_id,source_id,source_revision) VALUES($1,$2,$3,1)`, plan, f.owner, otherSource.ID)
	expectDenied(`UPDATE app.banking_source_revisions SET amount_minor=1 WHERE source_id=$1`, source.ID)
	expectDenied(`UPDATE app.banking_archives SET boundary_date='2026-10-01' WHERE id=$1`, archive)
	// A changed source revision retains identity and appends a new immutable fact.
	next := sourceInput(binding)
	next.ExpectedRevision = 1
	next.AmountMinor = "9223372036854775807"
	next.BankDate = "9999-12-31"
	updated := f.service.RecordSource(ctx, next)
	requireCode(t, updated, "READY")
	if updated.ID != source.ID {
		t.Fatal("source identity changed")
	}
	saved, result := f.service.ReadSource(ctx, source.ID)
	requireCode(t, result, "READY")
	if saved.AmountMinor != next.AmountMinor || saved.BankDate != next.BankDate || saved.Revision != 2 {
		t.Fatal("source revision not preserved")
	}
	_, result = f.service.ReadSource(f.actor(f.other), source.ID)
	requireCode(t, result, "NOT_FOUND")
	// Another attempt cannot silently overwrite an already owned provider Item.
	duplicate := ConnectionInput{AttemptID: uuid.New(), Environment: "sandbox", ProviderItemID: "historical-integrity", AccessToken: "different-synthetic-token"}
	requireCode(t, f.service.CreateConnection(ctx, duplicate), "CONFLICT")
}
