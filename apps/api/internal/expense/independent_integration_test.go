//go:build integration

package expense_test

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
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// This fixture deliberately retains its independent service/HTTP harness and
// exact-allocation inputs rather than sharing the primary journey's helpers.
type independentExpenseFixture struct {
	ctx                context.Context
	admin              *pgx.Conn
	db                 *database.DB
	id                 func(int) string
	pub                func(string, int) string
	endpoint           *httptest.Server
	signed             string
	start              func()
	canceledDone       chan struct{}
	request            func(string, ledger.Input, expense.PageRequest, any) error
	create             func(ledger.Input) expense.Outcome
	input              ledger.Input
	injectAdminFixture func(*testing.T, string, string, ...any)
}

func newIndependentExpenseFixture(t *testing.T) *independentExpenseFixture {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	t.Cleanup(cancel)
	runtime, adminURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_DATABASE_ADMIN_URL")
	if runtime == "" || adminURL == "" {
		t.Fatal("run make db-test")
	}
	admin, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.Close(context.Background()) })
	prefix := uuid.NewString()[:24]
	id := func(n int) string { return fmt.Sprintf("%s%012d", prefix, n) }
	registerExpenseCleanup(t, admin, id, []int{201}, []int{1, 2, 3})
	pub := func(kind string, n int) string { return ledger.PublicID(kind, id(n)) }
	seed, err := admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer seed.Rollback(context.Background())
	seedExec := func(query string, args ...any) {
		t.Helper()
		if _, err := seed.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	for n := 1; n <= 3; n++ {
		seedExec(`INSERT INTO auth.users(id,email) VALUES($1,$2)`, id(n), id(n)+"@example.invalid")
	}
	seedExec("SET LOCAL ROLE kami_migrator")
	for n := 1; n <= 3; n++ {
		seedExec(`INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES($1,$2,$2,$3)`, id(n+100), id(n), fmt.Sprintf("Actor %d", n))
	}
	seedExec(`INSERT INTO app.groups(id,name,owner_membership_id) VALUES($1,$2,$3)`, id(201), "Independent", id(301))
	seedExec(`INSERT INTO app.memberships(id,group_id,user_id,active) VALUES($1,$2,$3,$4)`, id(301), id(201), id(101), true)
	seedExec(`INSERT INTO app.memberships(id,group_id,user_id,active) VALUES($1,$2,$3,$4)`, id(302), id(201), id(102), true)
	seedExec(`INSERT INTO app.memberships(id,group_id,user_id,active) VALUES($1,$2,$3,$4)`, id(303), id(201), id(103), true)
	if err := seed.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	encode := func(v []byte) string { return base64.RawURLEncoding.EncodeToString(v) }
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []any{map[string]any{"kty": "EC", "crv": "P-256", "kid": "independent82", "alg": "ES256", "use": "sig", "x": encode(key.X.FillBytes(make([]byte, 32))), "y": encode(key.Y.FillBytes(make([]byte, 32)))}}})
	}))
	t.Cleanup(jwks.Close)
	verifier, err := auth.New(auth.Config{Issuer: jwks.URL, Audience: "authenticated", JWKSURL: jwks.URL})
	if err != nil {
		t.Fatal(err)
	}
	if err = verifier.Warm(ctx); err != nil {
		t.Fatal(err)
	}
	token := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{"iss": jwks.URL, "aud": "authenticated", "sub": id(1), "role": "authenticated", "iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix()})
	token.Header["kid"] = "independent82"
	signed, err := token.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	var db *database.DB
	var service *expense.Service
	var endpoint *httptest.Server
	canceledDone := make(chan struct{})
	start := func() {
		t.Helper()
		var e error
		db, e = database.Open(ctx, database.Config{URL: runtime, MaxConns: 8, Timeout: time.Second})
		if e != nil {
			t.Fatal(e)
		}
		service = expense.New(db)
		endpoint = httptest.NewServer(verifier.Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var req struct {
				Input ledger.Input
				Page  expense.PageRequest
			}
			if json.NewDecoder(r.Body).Decode(&req) != nil {
				w.WriteHeader(400)
				return
			}
			var result any
			var e error
			switch r.URL.Path {
			case "/create":
				result, e = service.Create(r.Context(), req.Input)
			case "/cancel-create":
				defer close(canceledDone)
				result, e = service.Create(r.Context(), req.Input)
			case "/read":
				result, e = service.Read(r.Context(), req.Input.GroupID, req.Page)
			case "/recover":
				result, e = service.Recover(r.Context(), req.Input.GroupID, req.Input.Key)
			}
			if e != nil {
				w.WriteHeader(409)
				_, _ = io.WriteString(w, e.Error())
				return
			}
			_ = json.NewEncoder(w).Encode(result)
		})))
	}
	start()
	t.Cleanup(func() { endpoint.Close(); db.Close() })
	request := func(path string, in ledger.Input, page expense.PageRequest, out any) error {
		body, _ := json.Marshal(struct {
			Input ledger.Input
			Page  expense.PageRequest
		}{in, page})
		req, _ := http.NewRequestWithContext(ctx, "POST", endpoint.URL+path, bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+signed)
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			return e
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			b, _ := io.ReadAll(res.Body)
			return fmt.Errorf("%d: %s", res.StatusCode, b)
		}
		return json.NewDecoder(res.Body).Decode(out)
	}
	create := func(in ledger.Input) expense.Outcome {
		t.Helper()
		var out expense.Outcome
		if e := request("/create", in, expense.PageRequest{}, &out); e != nil {
			t.Fatal(e)
		}
		return out
	}
	input := ledger.Input{GroupID: pub("Group", 201), Key: uuid.NewString(), Currency: "USD", Total: 1000, Description: "Concurrent first attempt", EffectiveDate: "2026-09-29", Category: "DINING", PayerID: pub("Membership", 302), ParticipantIDs: []string{pub("Membership", 301), pub("Membership", 302)}, Split: "EXACT", ExactAllocations: []ledger.Allocation{{ParticipantID: pub("Membership", 301), Amount: 1000}, {ParticipantID: pub("Membership", 302), Amount: 0}}}
	injectAdminFixture := func(t *testing.T, table, query string, args ...any) {
		t.Helper()
		tx, err := admin.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		// Force-RLS is restored before this transaction commits; its exclusive
		// table lock prevents any other session observing the fixture bypass.
		for _, statement := range []string{"SET LOCAL ROLE kami_migrator", "ALTER TABLE app." + table + " NO FORCE ROW LEVEL SECURITY"} {
			if _, err = tx.Exec(ctx, statement); err != nil {
				t.Fatal(err)
			}
		}
		if _, err = tx.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec(ctx, "ALTER TABLE app."+table+" FORCE ROW LEVEL SECURITY"); err != nil {
			t.Fatal(err)
		}
		if err = tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	return &independentExpenseFixture{ctx: ctx, admin: admin, db: db, id: id, pub: pub, endpoint: endpoint, signed: signed, start: start, canceledDone: canceledDone, request: request, create: create, input: input, injectAdminFixture: injectAdminFixture}
}

func TestIndependentExpenseSimultaneousFirstAttemptsHaveOneAtomicEffect(t *testing.T) {
	f := newIndependentExpenseFixture(t)
	var original expense.Outcome
	ctx := f.ctx
	admin := f.admin
	id := f.id
	request := f.request
	input := f.input
	barrier := make(chan struct{})
	results := make(chan expense.Outcome, 8)
	errs := make(chan error, 8)
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			<-barrier
			var out expense.Outcome
			err := request("/create", input, expense.PageRequest{}, &out)
			results <- out
			errs <- err
		})
	}
	close(barrier)
	wg.Wait()
	close(results)
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	for out := range results {
		if out.Kind != "COMMITTED" || out.Record == nil {
			t.Fatalf("%+v", out)
		}
		if original.Record == nil {
			original = out
		} else if out.Record.ExpenseID != original.Record.ExpenseID {
			t.Fatal("duplicate expense")
		}
	}
	var expenses, allocations, audits, receipts int
	if e := admin.QueryRow(ctx, `SELECT(
  SELECT count(*)
  FROM app.expenses
  WHERE group_id = $1
), (
  SELECT count(*)
  FROM app.allocations
  WHERE group_id = $1
), (
  SELECT count(*)
  FROM app.expense_audit
  WHERE group_id = $1
), (
  SELECT count(*)
  FROM app.expense_operations
  WHERE group_id = $1
)`, id(201)).Scan(&expenses, &allocations, &audits, &receipts); e != nil {
		t.Fatal(e)
	}
	if expenses != 1 || allocations != 2 || audits != 1 || receipts != 1 {
		t.Fatalf("effects %d %d %d %d", expenses, allocations, audits, receipts)
	}
}

func TestIndependentExpenseLaterTransactionCannotAddSameGroupZeroAllocation(t *testing.T) {
	f := newIndependentExpenseFixture(t)
	original := f.create(f.input)
	if original.Kind != "COMMITTED" {
		t.Fatal(original)
	}
	ctx := f.ctx
	admin := f.admin
	db := f.db
	id := f.id
	raw, _ := ledger.ParseID(original.Record.ExpenseID, "Expense")
	insertAccepted := false
	err := db.WithIdentity(ctx, id(1), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO app.allocations(expense_id,group_id,participant_id,amount_minor) VALUES($1,$2,$3,0)`, raw, id(201), id(303))
		insertAccepted = err == nil
		return err
	})
	var constraint *pgconn.PgError
	if !insertAccepted || !errors.As(err, &constraint) || constraint.Code != "23514" {
		t.Fatalf("expected deferred immutability constraint, got %v (insert accepted=%v)", err, insertAccepted)
	}
	var count int
	if err = admin.QueryRow(ctx, `SELECT count(*) FROM app.allocations WHERE expense_id=$1`, raw).Scan(&count); err != nil || count != 2 {
		t.Fatalf("history changed: %d %v", count, err)
	}
}

func TestIndependentExpenseZeroShareParticipantMatchesFilter(t *testing.T) {
	f := newIndependentExpenseFixture(t)
	if out := f.create(f.input); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	pub := f.pub
	request := f.request
	input := f.input
	var view expense.Snapshot
	if e := request("/read", input, expense.PageRequest{First: 10, ParticipantID: pub("Membership", 302)}, &view); e != nil {
		t.Fatal(e)
	}
	if len(view.Records) != 1 || len(view.Records[0].Allocations) != 2 {
		t.Fatalf("zero-share lost %+v", view)
	}
}

func TestIndependentExpenseAnchorExcludesLaterBackdatedWriteWhileBalancesRefresh(t *testing.T) {
	f := newIndependentExpenseFixture(t)
	if out := f.create(f.input); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	request := f.request
	create := f.create
	input := f.input
	second := input
	second.Key = uuid.NewString()
	second.Description = "Second"
	second.EffectiveDate = "2026-09-28"
	if out := create(second); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	var first expense.Snapshot
	if e := request("/read", input, expense.PageRequest{First: 1}, &first); e != nil {
		t.Fatal(e)
	}
	later := input
	later.Key = uuid.NewString()
	later.EffectiveDate = "2026-09-27"
	if out := create(later); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	last := first.Records[0]
	raw, _ := ledger.ParseID(last.ExpenseID, "Expense")
	page := expense.PageRequest{First: 10, Anchor: &first.Revision, LastDate: last.EffectiveDate, LastCreated: last.CommittedAt, LastID: raw}
	var next expense.Snapshot
	if e := request("/read", input, page, &next); e != nil {
		t.Fatal(e)
	}
	if len(next.Records) != 1 || next.Records[0].Description != "Second" || next.Revision != 3 || next.Total != 3000 || !next.HasPrevious || next.HasNext {
		t.Fatalf("anchor/current snapshot %+v", next)
	}
}

func TestIndependentExpenseNewPoolServiceAndEndpointRecoverOriginalHistoricalRevisionBeyond90Days(t *testing.T) {
	f := newIndependentExpenseFixture(t)
	original := f.create(f.input)
	if original.Kind != "COMMITTED" {
		t.Fatal(original)
	}
	later := f.input
	later.Key = uuid.NewString()
	if out := f.create(later); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	db := f.db
	id := f.id
	endpoint := f.endpoint
	start := f.start
	request := f.request
	create := f.create
	input := f.input
	injectAdminFixture := f.injectAdminFixture
	injectAdminFixture(t, "expense_operations", `UPDATE app.expense_operations SET created_at=clock_timestamp()-interval '400 days' WHERE group_id=$1 AND key=$2`, id(201), input.Key)
	endpoint.Close()
	db.Close()
	start()
	var recovered expense.Outcome
	if e := request("/recover", input, expense.PageRequest{}, &recovered); e != nil {
		t.Fatal(e)
	}
	if recovered.Kind != "COMMITTED" || recovered.Record.ExpenseID != original.Record.ExpenseID || recovered.Record.Revision != 1 {
		t.Fatalf("restart %+v", recovered)
	}
	if out := create(input); out.Record == nil || out.Record.ExpenseID != original.Record.ExpenseID {
		t.Fatal(out)
	}
}

func TestIndependentExpenseCanceledGroupLockWaitEndsAndSameKeyRetryIsSafe(t *testing.T) {
	f := newIndependentExpenseFixture(t)
	ctx := f.ctx
	admin := f.admin
	id := f.id
	endpoint := f.endpoint
	signed := f.signed
	canceledDone := f.canceledDone
	request := f.request
	create := f.create
	input := f.input
	held, err := admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer held.Rollback(ctx)
	if _, err = held.Exec(ctx, "SET LOCAL ROLE kami_migrator"); err != nil {
		t.Fatal(err)
	}
	if _, err = held.Exec(ctx, `SELECT id FROM app.groups WHERE id=$1 FOR UPDATE`, id(201)); err != nil {
		t.Fatal(err)
	}
	canceled := input
	canceled.Key = uuid.NewString()
	body, _ := json.Marshal(struct {
		Input ledger.Input
		Page  expense.PageRequest
	}{Input: canceled})
	short, stop := context.WithTimeout(ctx, 100*time.Millisecond)
	defer stop()
	req, _ := http.NewRequestWithContext(short, "POST", endpoint.URL+"/cancel-create", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+signed)
	response, err := http.DefaultClient.Do(req)
	if response != nil {
		response.Body.Close()
	}
	if err == nil {
		t.Fatal("held lock request unexpectedly completed")
	}
	select {
	case <-canceledDone:
	case <-time.After(2 * time.Second):
		t.Fatal("request canceled but database lock wait outlived request")
	}
	if err = held.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	var recovered expense.Outcome
	if err = request("/recover", canceled, expense.PageRequest{}, &recovered); err != nil {
		t.Fatal(err)
	}
	if recovered.Kind != "NOT_OBSERVED" {
		t.Fatalf("canceled attempt committed: %+v", recovered)
	}
	if out := create(canceled); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
}

func TestIndependentExpenseRevisionExhaustionIsDurableAndHasNoFinancialEffect(t *testing.T) {
	f := newIndependentExpenseFixture(t)
	if out := f.create(f.input); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	for range 3 {
		next := f.input
		next.Key = uuid.NewString()
		if out := f.create(next); out.Kind != "COMMITTED" {
			t.Fatal(out)
		}
	}
	ctx := f.ctx
	admin := f.admin
	id := f.id
	request := f.request
	create := f.create
	input := f.input
	injectAdminFixture := f.injectAdminFixture
	// Admin-only fault fixture reaches the otherwise impractical int64 boundary.
	injectAdminFixture(t, "expenses", `UPDATE app.expenses SET revision=9223372036854775807 WHERE group_id=$1 AND revision=4`, id(201))
	injectAdminFixture(t, "financial_records", `UPDATE app.financial_records SET revision=9223372036854775807 WHERE group_id=$1 AND revision=4`, id(201))
	exhausted := input
	exhausted.Key = uuid.NewString()
	out := create(exhausted)
	if out.Kind != "VALIDATION" || len(out.Fields) != 1 || out.Fields[0].Code != "AMOUNT_OVERFLOW" {
		t.Fatalf("exhaustion %+v", out)
	}
	var recovered expense.Outcome
	if e := request("/recover", exhausted, expense.PageRequest{}, &recovered); e != nil {
		t.Fatal(e)
	}
	if recovered.Kind != "VALIDATION" || recovered.Fields[0].Code != "AMOUNT_OVERFLOW" {
		t.Fatalf("recovery %+v", recovered)
	}
	var count int
	if e := admin.QueryRow(ctx, `SELECT count(*) FROM app.expenses WHERE group_id=$1`, id(201)).Scan(&count); e != nil || count != 4 {
		t.Fatalf("unexpected financial effect %d %v", count, e)
	}
}
