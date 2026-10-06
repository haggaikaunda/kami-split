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
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
	"github.com/haggaikaunda/kami-split/apps/api/internal/group"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/haggaikaunda/kami-split/apps/api/internal/server"
	"github.com/jackc/pgx/v5"
)

type expenseFixture struct {
	retainForBackup func()
	ctx             context.Context
	runtime         string
	admin           *pgx.Conn
	db              *database.DB
	id              func(int) string
	public          func(string, int) string
	exec            func(string)
	verifier        *auth.Verifier
	endpoint        *httptest.Server
	token           func(int) string
	request         func(int, string, ledger.Input) (int, []byte)
	create          func(int, ledger.Input) expense.Outcome
	input           ledger.Input
	original        expense.Outcome
}

func newExpenseFixture(t *testing.T) *expenseFixture {
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
	db, err := database.Open(ctx, database.Config{URL: runtime, MaxConns: 8, Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	prefix := uuid.NewString()[:24]
	id := func(n int) string { return fmt.Sprintf("%s%012d", prefix, n) }
	retainForBackup := registerExpenseCleanup(t, admin, id, []int{201, 202, 203}, []int{1, 2, 3, 4})
	public := func(kind string, n int) string { return ledger.PublicID(kind, id(n)) }
	exec := func(sql string) {
		t.Helper()
		if _, e := admin.Exec(ctx, sql); e != nil {
			t.Fatal(e)
		}
	}
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
	for n := 1; n <= 4; n++ {
		seedExec(`INSERT INTO auth.users(id,email) VALUES($1,$2)`, id(n), id(n)+"@example.invalid")
	}
	seedExec("SET LOCAL ROLE kami_migrator")
	for n := 1; n <= 4; n++ {
		seedExec(`INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES($1,$2,$2,$3)`, id(n+100), id(n), fmt.Sprintf("Actor %d", n))
	}
	seedExec(`INSERT INTO app.groups(id,name,owner_membership_id) VALUES($1,$2,$3)`, id(201), "First", id(301))
	seedExec(`INSERT INTO app.groups(id,name,owner_membership_id) VALUES($1,$2,$3)`, id(202), "Second", id(304))
	seedExec(`INSERT INTO app.memberships(id,group_id,user_id,active) VALUES($1,$2,$3,$4)`, id(301), id(201), id(101), true)
	seedExec(`INSERT INTO app.memberships(id,group_id,user_id,active) VALUES($1,$2,$3,$4)`, id(302), id(201), id(102), true)
	seedExec(`INSERT INTO app.memberships(id,group_id,user_id,active) VALUES($1,$2,$3,$4)`, id(303), id(201), id(103), true)
	seedExec(`INSERT INTO app.memberships(id,group_id,user_id,active) VALUES($1,$2,$3,$4)`, id(304), id(202), id(104), true)
	if err := seed.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	// Each scenario has its own ledger; history remains available until cleanup.
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	encode := func(v []byte) string { return base64.RawURLEncoding.EncodeToString(v) }
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []any{map[string]any{"kty": "EC", "crv": "P-256", "kid": "expense-test", "alg": "ES256", "use": "sig", "x": encode(key.X.FillBytes(make([]byte, 32))), "y": encode(key.Y.FillBytes(make([]byte, 32)))}}})
	}))
	t.Cleanup(jwks.Close)
	verifier, err := auth.New(auth.Config{Issuer: jwks.URL, Audience: "authenticated", JWKSURL: jwks.URL})
	if err != nil {
		t.Fatal(err)
	}
	if err = verifier.Warm(ctx); err != nil {
		t.Fatal(err)
	}
	service := expense.NewWithPercentageWrites(db, true)
	codec, e := ledger.NewCursorCodec("test", map[string][]byte{"test": bytes.Repeat([]byte{1}, 32)})
	if e != nil {
		t.Fatal(e)
	}
	graphqlServer := server.NewWithAuthentication(config.Config{ShutdownTimeout: time.Second}, graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{Expenses: service, Groups: group.New(db), Cursors: codec}}), slog.New(slog.NewTextHandler(io.Discard, nil)), verifier)
	endpoint := httptest.NewServer(verifier.Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/graphql" {
			graphqlServer.Handler().ServeHTTP(w, r)
			return
		}
		var in ledger.Input
		_ = json.NewDecoder(r.Body).Decode(&in)
		var result any
		var e error
		switch r.URL.Path {
		case "/create", "/lose":
			result, e = service.Create(r.Context(), in)
		case "/recover":
			result, e = service.Recover(r.Context(), in.GroupID, in.Key)
		case "/read":
			result, e = service.Read(r.Context(), in.GroupID, expense.PageRequest{First: 1})
		case "/viewer":
			result, e = service.ReadViewer(r.Context())
		}
		if r.URL.Path == "/lose" && e == nil {
			connection, _, hijackErr := w.(http.Hijacker).Hijack()
			if hijackErr == nil {
				_ = connection.Close()
			}
			return
		}
		if e != nil {
			w.WriteHeader(409)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": e.Error()})
			return
		}
		_ = json.NewEncoder(w).Encode(result)
	})))
	t.Cleanup(endpoint.Close)
	token := func(actor int) string {
		t.Helper()
		now := time.Now()
		tok := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{"iss": jwks.URL, "aud": "authenticated", "sub": id(actor), "role": "authenticated", "iat": now.Unix(), "exp": now.Add(time.Hour).Unix()})
		tok.Header["kid"] = "expense-test"
		signed, e := tok.SignedString(key)
		if e != nil {
			t.Fatal(e)
		}
		return signed
	}
	request := func(actor int, path string, in ledger.Input) (int, []byte) {
		payload, _ := json.Marshal(in)
		req, _ := http.NewRequestWithContext(ctx, "POST", endpoint.URL+path, bytes.NewReader(payload))
		if actor > 0 {
			req.Header.Set("Authorization", "Bearer "+token(actor))
		}
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Error(e)
			return 0, nil
		}
		defer res.Body.Close()
		body, _ := io.ReadAll(res.Body)
		return res.StatusCode, body
	}
	create := func(actor int, in ledger.Input) expense.Outcome {
		t.Helper()
		status, body := request(actor, "/create", in)
		var out expense.Outcome
		if status != 200 || json.Unmarshal(body, &out) != nil {
			t.Fatalf("create %d: %s", status, body)
		}
		return out
	}
	input := ledger.Input{GroupID: public("Group", 201), Key: uuid.NewString(), Total: 1000, Currency: "USD", Description: " Dinner ", EffectiveDate: "2026-09-29", Category: "DINING", PayerID: public("Membership", 303), ParticipantIDs: []string{public("Membership", 303), public("Membership", 301), public("Membership", 302)}, Split: "EQUAL"}
	original := create(1, input)
	if original.Kind != "COMMITTED" || original.Record.CreatorMembershipID != public("Membership", 301) || original.Record.PayerMembershipID != public("Membership", 303) {
		t.Fatalf("first write: %+v", original)
	}
	if len(original.Record.Allocations) != 3 || original.Record.Allocations[0].Amount != 334 || original.Record.Allocations[1].Amount != 333 {
		t.Fatalf("split: %+v", original.Record)
	}
	return &expenseFixture{retainForBackup: retainForBackup, ctx: ctx, runtime: runtime, admin: admin, db: db, id: id, public: public, exec: exec, verifier: verifier, endpoint: endpoint, token: token, request: request, create: create, input: input, original: original}
}

func (f *expenseFixture) addSecondExpense(t *testing.T) {
	t.Helper()
	second := f.input
	second.Key = uuid.NewString()
	second.Total = 2000
	second.PayerID = f.public("Membership", 302)
	second.ParticipantIDs = []string{f.public("Membership", 301)}
	if out := f.create(1, second); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
}

func TestPersistedExpenseConcurrentRetriesAndMismatch(t *testing.T) {
	f := newExpenseFixture(t)
	create := f.create
	input := f.input
	original := f.original
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			out := create(1, input)
			if out.Kind != "COMMITTED" || out.Record.ExpenseID != original.Record.ExpenseID {
				t.Errorf("duplicate: %+v", out)
			}
		})
	}
	wg.Wait()
	changed := input
	changed.Note = "changed"
	if out := create(1, changed); out.Kind != "MISMATCH" {
		t.Fatal(out)
	}
}

func TestPersistedExpenseRejectionIsDurableAndChangedKeyIntentConflicts(t *testing.T) {
	f := newExpenseFixture(t)
	create := f.create
	input := f.input
	invalid := input
	invalid.Key = uuid.NewString()
	invalid.Total = 0
	if out := create(1, invalid); out.Kind != "VALIDATION" {
		t.Fatal(out)
	}
	invalid.Total = 999
	if out := create(1, invalid); out.Kind != "MISMATCH" {
		t.Fatal(out)
	}
}

func TestPersistedExpenseAuthorizationDeniesUnrelatedAndAbsentIdentity(t *testing.T) {
	f := newExpenseFixture(t)
	request := f.request
	input := f.input
	for _, path := range []string{"/create", "/recover", "/read"} {
		status, body := request(4, path, input)
		if status != 409 || !bytes.Contains(body, []byte("NOT_FOUND")) {
			t.Fatalf("cross-group %s %d %s", path, status, body)
		}
		status, _ = request(0, path, input)
		if status != 401 {
			t.Fatalf("anonymous: %d", status)
		}
	}
	status, body := request(2, "/recover", input)
	if status != 200 || !bytes.Contains(body, []byte("NOT_OBSERVED")) {
		t.Fatalf("unrelated actor receipt: %d %s", status, body)
	}
}

func TestPersistedExpenseReadCompleteBalancesIndependentOfOnePageLimit(t *testing.T) {
	f := newExpenseFixture(t)
	public := f.public
	request := f.request
	create := f.create
	input := f.input
	second := input
	second.Key = uuid.NewString()
	second.Total = 2000
	second.PayerID = public("Membership", 302)
	second.ParticipantIDs = []string{public("Membership", 301)}
	if out := create(1, second); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	status, body := request(1, "/read", input)
	var view expense.Snapshot
	if status != 200 || json.Unmarshal(body, &view) != nil {
		t.Fatalf("read %d %s", status, body)
	}
	if view.Total != 3000 || view.Revision != 2 || len(view.Records) != 1 || !view.HasNext || view.Balance.Settled || view.BalanceError != "" {
		t.Fatalf("complete balances %+v", view)
	}
	if len(view.Balance.Positions) != 3 || view.Balance.Positions[0].Net != -2334 || view.Balance.Positions[1].Net != 1667 || view.Balance.Positions[2].Net != 667 {
		t.Fatalf("positions %+v", view.Balance)
	}
}

func TestPersistedExpenseRecoverySurvivesPoolRestartAndInactiveHistoricalPayer(t *testing.T) {
	f := newExpenseFixture(t)
	f.addSecondExpense(t)
	db := f.db
	id := f.id
	exec := f.exec
	request := f.request
	create := f.create
	input := f.input
	original := f.original
	exec(fmt.Sprintf(`SET ROLE kami_migrator;UPDATE app.memberships SET active=false WHERE id='%s';RESET ROLE`, id(303)))
	database.IntegrationPool(db).Reset()
	replay := create(1, input)
	if replay.Kind != "COMMITTED" || replay.Record.ExpenseID != original.Record.ExpenseID {
		t.Fatal(replay)
	}
	newInput := input
	newInput.Key = uuid.NewString()
	if out := create(1, newInput); out.Kind != "VALIDATION" {
		t.Fatal(out)
	}
	status, body := request(1, "/read", input)
	var view expense.Snapshot
	if status != 200 || json.Unmarshal(body, &view) != nil || view.Balance.Positions[2].Net != 667 {
		t.Fatalf("history %d %s", status, body)
	}
	status, body = request(3, "/recover", input)
	if status != 409 || !bytes.Contains(body, []byte("NOT_FOUND")) {
		t.Fatalf("inactive actor %d %s", status, body)
	}
}

func TestPersistedExpenseRuntimeConstraintsRejectPartialEffectsAndLaterZeroAllocations(t *testing.T) {
	f := newExpenseFixture(t)
	ctx := f.ctx
	db := f.db
	id := f.id
	original := f.original
	err := db.WithIdentity(ctx, id(1), func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `SELECT app.lock_expense_write($1,'{}'::uuid[])`, id(201))
		if e != nil {
			return e
		}
		_, e = tx.Exec(ctx, `INSERT INTO app.expenses(id,group_id,creator_id,payer_id,total_minor,currency,description,effective_date,category,note,split,revision) VALUES($1,$2,$3,$3,1,'USD','partial','2026-01-01','OTHER','','EQUAL',3)`, uuid.NewString(), id(201), id(301))
		return e
	})
	if err == nil {
		t.Fatal("partial expense committed")
	}
	raw, _ := ledger.ParseID(original.Record.ExpenseID, "Expense")
	err = db.WithIdentity(ctx, id(1), func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `INSERT INTO app.allocations(expense_id,group_id,participant_id,amount_minor) VALUES($1,$2,$3,0)`, raw, id(201), id(304))
		return e
	})
	if err == nil {
		t.Fatal("cross-group allocation committed")
	}
}

func TestPersistedExpenseGraphqlProjectionNodesAndSignedPagination(t *testing.T) {
	f := newExpenseFixture(t)
	f.addSecondExpense(t)
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator;UPDATE app.memberships SET active=false WHERE id='%s';RESET ROLE`, f.id(303)))
	ctx := f.ctx
	public := f.public
	endpoint := f.endpoint
	token := f.token
	input := f.input
	original := f.original
	query := func(q string, variables map[string]any) map[string]any {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"query": q, "variables": variables})
		req, _ := http.NewRequestWithContext(ctx, "POST", endpoint.URL+"/graphql", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token(1))
		req.Header.Set("Content-Type", "application/json")
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		response, _ := io.ReadAll(res.Body)
		var data map[string]any
		if json.Unmarshal(response, &data) != nil || res.StatusCode != 200 {
			t.Fatalf("GraphQL %d %s", res.StatusCode, response)
		}
		return data
	}
	q := `query($id:ID!,$after:String){group(id:$id){__typename ... on Group{id viewerMembership{id} members{id canParticipate} expenses(first:1,after:$after){revision edges{cursor node{id totalMinor payer{id} creator{id} allocations{amountMinor participant{id}}}} pageInfo{hasNextPage hasPreviousPage startCursor endCursor}} balances{... on GroupBalances{revision totalExpenseMinor settled positions{netMinor member{id}}}}}}}`
	response := query(q, map[string]any{"id": input.GroupID})
	if response["errors"] != nil {
		t.Fatalf("first page: %+v", response)
	}
	group := response["data"].(map[string]any)["group"].(map[string]any)
	connection := group["expenses"].(map[string]any)
	pageInfo := connection["pageInfo"].(map[string]any)
	if connection["revision"] != "2" || !pageInfo["hasNextPage"].(bool) || group["balances"].(map[string]any)["totalExpenseMinor"] != "3000" {
		t.Fatalf("wire values: %+v", response)
	}
	response = query(q, map[string]any{"id": input.GroupID, "after": pageInfo["endCursor"]})
	if response["errors"] != nil {
		t.Fatalf("second page: %+v", response)
	}
	connection = response["data"].(map[string]any)["group"].(map[string]any)["expenses"].(map[string]any)
	if connection["pageInfo"].(map[string]any)["hasNextPage"].(bool) || !connection["pageInfo"].(map[string]any)["hasPreviousPage"].(bool) {
		t.Fatalf("second page boundary: %+v", response)
	}
	response = query(q, map[string]any{"id": input.GroupID, "after": "bad"})
	if response["errors"] == nil || response["data"].(map[string]any)["group"].(map[string]any)["expenses"] != nil {
		t.Fatalf("bad cursor: %+v", response)
	}
	response = query(`query($self:ID!,$peer:ID!,$record:ID!){a:node(id:$self){id} b:node(id:$peer){id} c:node(id:$record){id ... on Expense{totalMinor payer{id}}}}`, map[string]any{"self": public("Viewer", 101), "peer": public("Viewer", 102), "record": original.Record.ExpenseID})
	if response["errors"] != nil || response["data"].(map[string]any)["a"] == nil || response["data"].(map[string]any)["b"] != nil || response["data"].(map[string]any)["c"] == nil {
		t.Fatalf("nodes: %+v", response)
	}
}

func TestPersistedExpenseAuditFailureRollsBackAndSameKeySafelyRetries(t *testing.T) {
	f := newExpenseFixture(t)
	public := f.public
	exec := f.exec
	request := f.request
	create := f.create
	input := f.input
	exec(`SET ROLE kami_migrator;CREATE FUNCTION app.test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$;CREATE TRIGGER test_fail_audit BEFORE INSERT ON app.expense_audit FOR EACH ROW EXECUTE FUNCTION app.test_fail_audit();RESET ROLE`)
	t.Cleanup(func() {
		if _, err := f.admin.Exec(context.Background(), `BEGIN; SET LOCAL ROLE kami_migrator; DROP TRIGGER IF EXISTS test_fail_audit ON app.expense_audit;DROP FUNCTION IF EXISTS app.test_fail_audit(); COMMIT`); err != nil {
			t.Errorf("remove fault fixture: %v", err)
		}
	})
	failed := input
	failed.Key = uuid.NewString()
	failed.PayerID = public("Membership", 302)
	failed.ParticipantIDs = []string{public("Membership", 301)}
	if out := create(1, failed); out.Kind != "UNKNOWN" {
		t.Fatal(out)
	}
	status, body := request(1, "/recover", failed)
	if status != 200 || !bytes.Contains(body, []byte("NOT_OBSERVED")) {
		t.Fatalf("failed effect retained: %d %s", status, body)
	}
	exec(`SET ROLE kami_migrator;DROP TRIGGER test_fail_audit ON app.expense_audit;DROP FUNCTION app.test_fail_audit();RESET ROLE`)
	if out := create(1, failed); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
}

func TestPersistedExpenseCompleteSameGroupChainAndAllZeroCycle(t *testing.T) {
	f := newExpenseFixture(t)
	id := f.id
	public := f.public
	exec := f.exec
	request := f.request
	create := f.create
	input := f.input
	exec(fmt.Sprintf(`BEGIN;SET LOCAL ROLE kami_migrator;INSERT INTO app.groups(id,name,owner_membership_id) VALUES('%s','Chain','%s');INSERT INTO app.memberships(id,group_id,user_id) VALUES('%s','%s','%s'),('%s','%s','%s'),('%s','%s','%s');COMMIT`, id(203), id(311), id(311), id(203), id(101), id(312), id(203), id(102), id(313), id(203), id(103)))
	chain := input
	chain.GroupID = public("Group", 203)
	chain.Total = 2000
	chain.Key = uuid.NewString()
	chain.PayerID = public("Membership", 312)
	chain.ParticipantIDs = []string{public("Membership", 311)}
	if out := create(1, chain); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	chain.Key = uuid.NewString()
	chain.PayerID = public("Membership", 313)
	chain.ParticipantIDs = []string{public("Membership", 312)}
	if out := create(1, chain); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	read := func() expense.Snapshot {
		t.Helper()
		status, body := request(1, "/read", chain)
		var v expense.Snapshot
		if status != 200 || json.Unmarshal(body, &v) != nil {
			t.Fatalf("chain read %d %s", status, body)
		}
		return v
	}
	v := read()
	if v.Balance.Settled || len(v.Balance.Obligations) != 1 || v.Balance.Obligations[0].From != public("Membership", 311) || v.Balance.Obligations[0].To != public("Membership", 313) || v.Balance.Obligations[0].Amount != 2000 || v.Balance.Positions[1].Net != 0 {
		t.Fatalf("chain %+v", v.Balance)
	}
	exec(fmt.Sprintf(`SET ROLE kami_migrator;UPDATE app.memberships SET active=false WHERE id='%s';RESET ROLE`, id(312)))
	if next := read(); next.Balance.Positions[0].Net != v.Balance.Positions[0].Net || next.Balance.Positions[2].Net != v.Balance.Positions[2].Net {
		t.Fatal("departure redistributed history")
	}
	chain.Key = uuid.NewString()
	chain.PayerID = public("Membership", 311)
	chain.ParticipantIDs = []string{public("Membership", 313)}
	if out := create(1, chain); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	if v = read(); !v.Balance.Settled || len(v.Balance.Obligations) != 0 || v.Total != 6000 {
		t.Fatalf("zero cycle %+v", v)
	}
	other := chain
	other.GroupID = public("Group", 202)
	status, body := request(4, "/read", other)
	var empty expense.Snapshot
	if status != 200 || json.Unmarshal(body, &empty) != nil || empty.Total != 0 || !empty.Balance.Settled {
		t.Fatalf("cross-group contamination %d %s", status, body)
	}
}

func TestPersistedExpenseLostCommitResponseRecoversThroughNewPoolAndService(t *testing.T) {
	f := newExpenseFixture(t)
	ctx := f.ctx
	runtime := f.runtime
	public := f.public
	verifier := f.verifier
	endpoint := f.endpoint
	token := f.token
	create := f.create
	input := f.input
	lost := input
	lost.Key = uuid.NewString()
	lost.PayerID = public("Membership", 302)
	lost.ParticipantIDs = []string{public("Membership", 301)}
	payload, _ := json.Marshal(lost)
	req, _ := http.NewRequestWithContext(ctx, "POST", endpoint.URL+"/lose", bytes.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+token(1))
	response, requestErr := http.DefaultClient.Do(req)
	if requestErr == nil {
		response.Body.Close()
		t.Fatal("expected lost commit response")
	}
	restarted, e := database.Open(ctx, database.Config{URL: runtime, MaxConns: 2, Timeout: time.Second})
	if e != nil {
		t.Fatal(e)
	}
	defer restarted.Close()
	recovered := expense.New(restarted)
	recoveryServer := httptest.NewServer(verifier.Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		out, e := recovered.Recover(r.Context(), lost.GroupID, lost.Key)
		if e != nil {
			w.WriteHeader(500)
			return
		}
		_ = json.NewEncoder(w).Encode(out)
	})))
	defer recoveryServer.Close()
	req, _ = http.NewRequestWithContext(ctx, "GET", recoveryServer.URL, nil)
	req.Header.Set("Authorization", "Bearer "+token(1))
	response, e = http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer response.Body.Close()
	var out expense.Outcome
	if json.NewDecoder(response.Body).Decode(&out) != nil || out.Kind != "COMMITTED" {
		t.Fatalf("lost response recovery %+v", out)
	}
	replay := create(1, lost)
	if replay.Kind != "COMMITTED" || replay.Record.ExpenseID != out.Record.ExpenseID {
		t.Fatal("retry duplicated lost response effect")
	}
}

func TestPersistedExpenseDatabaseCommitAcknowledgementLossRemainsRecoverable(t *testing.T) {
	f := newExpenseFixture(t)
	ctx := f.ctx
	runtime := f.runtime
	public := f.public
	verifier := f.verifier
	token := f.token
	request := f.request
	create := f.create
	input := f.input
	proxyURL, dropped := commitLossProxy(t, runtime)
	uncertainDB, e := database.Open(ctx, database.Config{URL: proxyURL, MaxConns: 1, Timeout: time.Second})
	if e != nil {
		t.Fatal(e)
	}
	defer uncertainDB.Close()
	uncertainService := expense.New(uncertainDB)
	in := input
	in.Key = uuid.NewString()
	in.PayerID = public("Membership", 302)
	in.ParticipantIDs = []string{public("Membership", 301)}
	uncertainHTTP := httptest.NewServer(verifier.Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		out, e := uncertainService.Create(r.Context(), in)
		if e != nil {
			w.WriteHeader(500)
			return
		}
		_ = json.NewEncoder(w).Encode(out)
	})))
	defer uncertainHTTP.Close()
	req, _ := http.NewRequestWithContext(ctx, "POST", uncertainHTTP.URL, nil)
	req.Header.Set("Authorization", "Bearer "+token(1))
	response, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer response.Body.Close()
	var unknown expense.Outcome
	if json.NewDecoder(response.Body).Decode(&unknown) != nil || unknown.Kind != "UNKNOWN" {
		t.Fatalf("pgx uncertain commit %+v", unknown)
	}
	select {
	case <-dropped:
	default:
		t.Fatal("test did not intercept COMMIT acknowledgement")
	}
	status, body := request(1, "/recover", in)
	var committed expense.Outcome
	if status != 200 || json.Unmarshal(body, &committed) != nil || committed.Kind != "COMMITTED" {
		t.Fatalf("committed state not recovered %d %s", status, body)
	}
	replay := create(1, in)
	if replay.Kind != "COMMITTED" || replay.Record.ExpenseID != committed.Record.ExpenseID {
		t.Fatal("uncertain commit retry duplicated effect")
	}
}

func TestPersistedExpenseDisabledActorCannotRecoverReceipt(t *testing.T) {
	f := newExpenseFixture(t)
	id := f.id
	exec := f.exec
	request := f.request
	input := f.input
	exec(fmt.Sprintf(`SET ROLE kami_migrator;UPDATE app.users SET enabled=false WHERE id='%s';RESET ROLE`, id(101)))
	status, body := request(1, "/recover", input)
	if status != 409 || !bytes.Contains(body, []byte("NOT_FOUND")) {
		t.Fatalf("disabled %d %s", status, body)
	}
	status, body = request(1, "/viewer", input)
	if status != 200 || !bytes.Contains(body, []byte("DISABLED")) {
		t.Fatalf("viewer state %d %s", status, body)
	}
}

// The db-test runner dumps and restores financial history after the Go tests.
// Ownership of this one committed ledger passes to that disposable stack; all
// scenario fixtures clean up their own rows, including failed scenarios.
func TestPersistedExpenseFinancialBackupFixture(t *testing.T) {
	f := newExpenseFixture(t)
	f.retainForBackup()
}
