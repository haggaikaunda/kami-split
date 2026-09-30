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
)

func TestIndependentFinancialRecoveryAndPagination(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	runtime, adminURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_DATABASE_ADMIN_URL")
	if runtime == "" || adminURL == "" {
		t.Fatal("run make db-test")
	}
	admin, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close(ctx)
	id := func(n int) string { return fmt.Sprintf("82990000-0000-4000-8000-%012d", n) }
	pub := func(kind string, n int) string { return ledger.PublicID(kind, id(n)) }
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := admin.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(fmt.Sprintf(`INSERT INTO auth.users(id,email) VALUES('%s','independent82a@example.invalid'),('%s','independent82b@example.invalid'); BEGIN;SET LOCAL ROLE kami_migrator;
 INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES('%s','%s','%s','Tester A'),('%s','%s','%s','Tester B');
 INSERT INTO app.groups(id,name,owner_membership_id) VALUES('%s','Independent','%s');
 INSERT INTO app.memberships(id,group_id,user_id) VALUES('%s','%s','%s'),('%s','%s','%s');COMMIT;`, id(1), id(2), id(101), id(1), id(1), id(102), id(2), id(2), id(201), id(301), id(301), id(201), id(101), id(302), id(201), id(102)))
	exec(fmt.Sprintf(`INSERT INTO auth.users(id,email) VALUES('%s','independent82c@example.invalid'); BEGIN; SET LOCAL ROLE kami_migrator; INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES('%s','%s','%s','Tester C'); INSERT INTO app.memberships(id,group_id,user_id) VALUES('%s','%s','%s'); COMMIT;`, id(3), id(103), id(3), id(3), id(303), id(201), id(103)))
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	encode := func(v []byte) string { return base64.RawURLEncoding.EncodeToString(v) }
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []any{map[string]any{"kty": "EC", "crv": "P-256", "kid": "independent82", "alg": "ES256", "use": "sig", "x": encode(key.X.FillBytes(make([]byte, 32))), "y": encode(key.Y.FillBytes(make([]byte, 32)))}}})
	}))
	defer jwks.Close()
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
		service = &expense.Service{DB: db}
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
	defer func() { endpoint.Close(); db.Close() }()
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
	var original expense.Outcome
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
	t.Run("simultaneous first attempts have one atomic effect", func(t *testing.T) {
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
		if e := admin.QueryRow(ctx, `SELECT (SELECT count(*) FROM app.expenses WHERE group_id=$1),(SELECT count(*) FROM app.allocations WHERE group_id=$1),(SELECT count(*) FROM app.expense_audit WHERE group_id=$1),(SELECT count(*) FROM app.expense_operations WHERE group_id=$1)`, id(201)).Scan(&expenses, &allocations, &audits, &receipts); e != nil {
			t.Fatal(e)
		}
		if expenses != 1 || allocations != 2 || audits != 1 || receipts != 1 {
			t.Fatalf("effects %d %d %d %d", expenses, allocations, audits, receipts)
		}
	})
	t.Run("later transaction cannot add same-group zero allocation", func(t *testing.T) {
		raw, _ := ledger.ParseID(original.Record.ExpenseID, "Expense")
		err := db.WithIdentity(ctx, id(1), func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `INSERT INTO app.allocations(expense_id,group_id,participant_id,amount_minor) VALUES($1,$2,$3,0)`, raw, id(201), id(303))
			return err
		})
		if err == nil {
			t.Fatal("old expense accepted a new zero-share participant in a later transaction")
		}
		var count int
		if err = admin.QueryRow(ctx, `SELECT count(*) FROM app.allocations WHERE expense_id=$1`, raw).Scan(&count); err != nil || count != 2 {
			t.Fatalf("history changed: %d %v", count, err)
		}
	})
	t.Run("zero-share participant matches filter", func(t *testing.T) {
		var view expense.Snapshot
		if e := request("/read", input, expense.PageRequest{First: 10, ParticipantID: pub("Membership", 302)}, &view); e != nil {
			t.Fatal(e)
		}
		if len(view.Records) != 1 || len(view.Records[0].Allocations) != 2 {
			t.Fatalf("zero-share lost %+v", view)
		}
	})
	t.Run("anchor excludes later backdated write while balances refresh", func(t *testing.T) {
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
	})
	t.Run("new pool service and endpoint recover original historical revision beyond 90 days", func(t *testing.T) {
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
	})
	t.Run("canceled group-lock wait ends and same-key retry is safe", func(t *testing.T) {
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
	})
	t.Run("revision exhaustion is durable and has no financial effect", func(t *testing.T) {
		// Admin-only fault fixture reaches the otherwise impractical int64 boundary.
		injectAdminFixture(t, "expenses", `UPDATE app.expenses SET revision=9223372036854775807 WHERE group_id=$1 AND revision=4`, id(201))
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
	})
}
