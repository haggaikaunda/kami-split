//go:build integration

package expense_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type repaymentCaller func(int, string, ledger.RepaymentInput, any) int

func repaymentEndpoint(t *testing.T, f *expenseFixture, db *database.DB) repaymentCaller {
	t.Helper()
	service := expense.New(db)
	endpoint := httptest.NewServer(f.verifier.Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in ledger.RepaymentInput
		if e := json.NewDecoder(r.Body).Decode(&in); e != nil {
			http.Error(w, "bad input", 400)
			return
		}
		var out any
		var e error
		switch r.URL.Path {
		case "/record":
			out, e = service.RecordRepayment(r.Context(), in)
		case "/recover":
			out, e = service.RecoverRepayment(r.Context(), in.GroupID, in.Key)
		case "/read":
			out, e = service.Read(r.Context(), in.GroupID, expense.PageRequest{First: 1})
		default:
			http.NotFound(w, r)
			return
		}
		if e != nil {
			w.WriteHeader(409)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": e.Error()})
			return
		}
		_ = json.NewEncoder(w).Encode(out)
	})))
	t.Cleanup(endpoint.Close)
	return func(actor int, path string, in ledger.RepaymentInput, out any) int {
		t.Helper()
		body, _ := json.Marshal(in)
		req, e := http.NewRequestWithContext(f.ctx, "POST", endpoint.URL+path, bytes.NewReader(body))
		if e != nil {
			t.Error(e)
			return 0
		}
		if actor > 0 {
			req.Header.Set("Authorization", "Bearer "+f.token(actor))
		}
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Error(e)
			return 0
		}
		defer res.Body.Close()
		data, _ := io.ReadAll(res.Body)
		if res.StatusCode == 200 && out != nil {
			if e = json.Unmarshal(data, out); e != nil {
				t.Errorf("decode %s: %v", data, e)
			}
		}
		return res.StatusCode
	}
}
func repaymentInput(f *expenseFixture) ledger.RepaymentInput {
	return ledger.RepaymentInput{GroupID: f.input.GroupID, Key: uuid.NewString(), SenderID: f.public("Membership", 301), RecipientID: f.public("Membership", 302), Amount: 500, Currency: "USD", EffectiveDate: "2026-09-30", Note: " actual transfer "}
}
func repaymentRecord(t *testing.T, call repaymentCaller, actor int, in ledger.RepaymentInput) expense.Outcome {
	t.Helper()
	var out expense.Outcome
	if status := call(actor, "/record", in, &out); status != 200 {
		t.Fatalf("record status %d", status)
	}
	return out
}
func repaymentSnapshot(t *testing.T, call repaymentCaller, in ledger.RepaymentInput) expense.Snapshot {
	t.Helper()
	var out expense.Snapshot
	if status := call(1, "/read", in, &out); status != 200 {
		t.Fatalf("read status %d", status)
	}
	return out
}
func repaymentCounts(t *testing.T, f *expenseFixture) [4]int {
	t.Helper()
	var n [4]int
	if e := f.admin.QueryRow(f.ctx, `SELECT(
  SELECT count(*)
  FROM app.repayments
  WHERE group_id = $1
), (
  SELECT count(*)
  FROM app.repayment_audit
  WHERE group_id = $1
), (
  SELECT count(*)
  FROM app.expense_operations
  WHERE group_id = $1
  AND operation_kind = 'RECORD_REPAYMENT'
), (
  SELECT count(*)
  FROM app.financial_records
  WHERE group_id = $1
)`, f.id(201)).Scan(&n[0], &n[1], &n[2], &n[3]); e != nil {
		t.Fatal(e)
	}
	return n
}

func TestRepaymentThirdPartyActualTransferAndMixedRevisions(t *testing.T) {
	f := newExpenseFixture(t)
	call := repaymentEndpoint(t, f, f.db)
	in := repaymentInput(f)
	before := repaymentSnapshot(t, call, in)
	out := repaymentRecord(t, call, 3, in)
	if out.Kind != "COMMITTED" || out.Repayment == nil {
		t.Fatal(out)
	}
	r := out.Repayment
	if r.CreatorMembershipID != f.public("Membership", 303) || r.SenderMembershipID != in.SenderID || r.RecipientMembershipID != in.RecipientID || r.Note != in.Note || r.Revision != before.Revision+1 || r.AmountMinor != 500 {
		t.Fatalf("wrong record %+v", r)
	}
	after := repaymentSnapshot(t, call, in)
	if after.Total != before.Total || after.Revision != r.Revision {
		t.Fatal("spending/revision changed incorrectly")
	}
	old := map[string]ledger.Position{}
	for _, p := range before.Positions {
		old[p.MemberID] = p
	}
	for _, p := range after.Positions {
		want := old[p.MemberID]
		if p.MemberID == in.SenderID {
			want.Sent += 500
		}
		if p.MemberID == in.RecipientID {
			want.Received += 500
		}
		if p != want {
			t.Fatalf("effect %+v want %+v", p, want)
		}
	}
	next := f.input
	next.Key = uuid.NewString()
	exp := f.create(1, next)
	if exp.Kind != "COMMITTED" || exp.Record.Revision != r.Revision+1 {
		t.Fatal(exp)
	}
	var recovered expense.Outcome
	if call(3, "/recover", in, &recovered) != 200 || !reflect.DeepEqual(recovered, out) {
		t.Fatal("receipt changed", recovered)
	}
	if counts := repaymentCounts(t, f); counts != [4]int{1, 1, 1, 3} {
		t.Fatal(counts)
	}
}
func TestRepaymentConcurrentRetryMismatchRestartAndActorIsolation(t *testing.T) {
	f := newExpenseFixture(t)
	call := repaymentEndpoint(t, f, f.db)
	in := repaymentInput(f)
	const workers = 8
	results := make(chan expense.Outcome, workers)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var out expense.Outcome
			if call(3, "/record", in, &out) != 200 {
				t.Error("concurrent request failed")
			}
			results <- out
		}()
	}
	wg.Wait()
	close(results)
	var original expense.Outcome
	for out := range results {
		if out.Kind != "COMMITTED" || out.Repayment == nil {
			t.Fatal(out)
		}
		if original.Repayment == nil {
			original = out
		} else if !reflect.DeepEqual(original, out) {
			t.Fatal("retry changed receipt")
		}
	}
	changed := in
	changed.Amount++
	if got := repaymentRecord(t, call, 3, changed); got.Kind != "MISMATCH" {
		t.Fatalf("changed input %+v", got)
	}
	restarted, e := database.Open(f.ctx, database.Config{URL: f.runtime, MaxConns: 2, Timeout: time.Second})
	if e != nil {
		t.Fatal(e)
	}
	defer restarted.Close()
	fresh := repaymentEndpoint(t, f, restarted)
	var recovered expense.Outcome
	if fresh(3, "/recover", in, &recovered) != 200 || !reflect.DeepEqual(recovered, original) {
		t.Fatal("restart", recovered)
	}
	var other expense.Outcome
	if call(1, "/recover", in, &other) != 200 || other.Kind != "NOT_OBSERVED" {
		t.Fatal("cross actor leak", other)
	}
	if got := repaymentCounts(t, f); got != [4]int{1, 1, 1, 2} {
		t.Fatal(got)
	}
}
func TestRepaymentCommitAcknowledgementLoss(t *testing.T) {
	f := newExpenseFixture(t)
	proxyURL, dropped := commitLossProxy(t, f.runtime)
	db, e := database.Open(f.ctx, database.Config{URL: proxyURL, MaxConns: 2, Timeout: time.Second})
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	call := repaymentEndpoint(t, f, db)
	in := repaymentInput(f)
	out := repaymentRecord(t, call, 3, in)
	if out.Kind != "UNKNOWN" {
		t.Fatalf("lost COMMIT reply %+v", out)
	}
	select {
	case <-dropped:
	case <-time.After(2 * time.Second):
		t.Fatal("COMMIT reply not dropped")
	}
	direct := repaymentEndpoint(t, f, f.db)
	var recovered expense.Outcome
	if direct(3, "/recover", in, &recovered) != 200 || recovered.Kind != "COMMITTED" {
		t.Fatal(recovered)
	}
	if retry := repaymentRecord(t, direct, 3, in); !reflect.DeepEqual(retry, recovered) {
		t.Fatal("retry duplicated effect")
	}
	if got := repaymentCounts(t, f); got != [4]int{1, 1, 1, 2} {
		t.Fatal(got)
	}
}
func TestRepaymentAuthorizationAndHistoricalReplay(t *testing.T) {
	f := newExpenseFixture(t)
	call := repaymentEndpoint(t, f, f.db)
	in := repaymentInput(f)
	for _, actor := range []int{0, 4} {
		if status := call(actor, "/record", in, nil); status == 200 {
			t.Fatalf("unauthorized actor %d", actor)
		}
	}
	foreign := in
	foreign.RecipientID = f.public("Membership", 304)
	if got := repaymentRecord(t, call, 3, foreign); got.Kind != "VALIDATION" {
		t.Fatal(got)
	}
	in.Key = uuid.NewString()
	saved := repaymentRecord(t, call, 3, in)
	if saved.Kind != "COMMITTED" {
		t.Fatal(saved)
	}
	injectHistoricalDeparture(t, f, f.id(302))
	if retry := repaymentRecord(t, call, 3, in); !reflect.DeepEqual(retry, saved) {
		t.Fatal("historical replay failed", retry)
	}
	next := in
	next.Key = uuid.NewString()
	if got := repaymentRecord(t, call, 3, next); got.Kind != "VALIDATION" {
		t.Fatal("inactive counterparty accepted", got)
	}
	f.exec(fmt.Sprintf("SET ROLE kami_migrator; UPDATE app.users SET enabled=false WHERE id='%s'; RESET ROLE", f.id(103)))
	if call(3, "/recover", in, nil) == 200 {
		t.Fatal("disabled creator recovered result")
	}
	if call(2, "/record", next, nil) == 200 {
		t.Fatal("inactive actor wrote")
	}
	wrong := in
	wrong.GroupID = f.public("Group", 202)
	if call(1, "/recover", wrong, nil) == 200 {
		t.Fatal("cross group lookup")
	}
}
func TestRepaymentFailureAtEachStoredComponentRollsBack(t *testing.T) {
	for _, table := range []string{"repayments", "repayment_audit", "financial_records", "expense_operations"} {
		t.Run(table, func(t *testing.T) {
			f := newExpenseFixture(t)
			call := repaymentEndpoint(t, f, f.db)
			in := repaymentInput(f)
			before := repaymentCounts(t, f)
			fn := "test_repayment_failure_" + table
			f.exec(fmt.Sprintf(`SET ROLE kami_migrator; CREATE FUNCTION app.%s() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected repayment failure'; END $$; CREATE TRIGGER %s BEFORE INSERT ON app.%s FOR EACH ROW EXECUTE FUNCTION app.%s(); RESET ROLE`, fn, fn, table, fn))
			cleanup := fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; DROP TRIGGER IF EXISTS %s ON app.%s; DROP FUNCTION IF EXISTS app.%s(); COMMIT`, fn, table, fn)
			t.Cleanup(func() {
				if _, e := f.admin.Exec(context.Background(), cleanup); e != nil {
					t.Error(e)
				}
			})
			out := repaymentRecord(t, call, 3, in)
			if out.Kind == "COMMITTED" {
				t.Fatal("failure committed")
			}
			if got := repaymentCounts(t, f); got != before {
				t.Fatalf("partial effect %v vs %v", got, before)
			}
			f.exec(cleanup)
			var recovered expense.Outcome
			if call(3, "/recover", in, &recovered) != 200 || recovered.Kind != "NOT_OBSERVED" {
				t.Fatal(recovered)
			}
			if got := repaymentRecord(t, call, 3, in); got.Kind != "COMMITTED" {
				t.Fatal(got)
			}
		})
	}
}

func TestRepaymentRestrictedOrphanSuccessAndDurableRejection(t *testing.T) {
	f := newExpenseFixture(t)
	call := repaymentEndpoint(t, f, f.db)
	in := repaymentInput(f)
	_, canonical, hash, e := ledger.NormalizeRepayment(in)
	if e != nil {
		t.Fatal(e)
	}
	err := f.db.WithIdentity(f.ctx, f.id(1), func(tx pgx.Tx) error {
		_, e := tx.Exec(f.ctx, `INSERT INTO app.expense_operations(
  actor_user_id, group_id, operation_kind, key, canonical_version, canonical, canonical_hash,
  outcome
)
VALUES(
  $1, $2, 'RECORD_REPAYMENT', $3, 'record-repayment-v1', $4, $5, '{"Kind":"COMMITTED"}'::jsonb
)`, f.id(101), f.id(201), in.Key, canonical, hash[:])
		return e
	})
	if err == nil {
		t.Fatal("restricted role committed orphan success")
	}
	if counts := repaymentCounts(t, f); counts != [4]int{0, 0, 0, 1} {
		t.Fatal(counts)
	}
	in.Amount = 0
	out := repaymentRecord(t, call, 1, in)
	if out.Kind != "VALIDATION" {
		t.Fatal(out)
	}
	var recovered expense.Outcome
	if call(1, "/recover", in, &recovered) != 200 || !reflect.DeepEqual(recovered, out) {
		t.Fatal("rejection not durable", recovered)
	}
	in.Amount = 1
	if got := repaymentRecord(t, call, 1, in); got.Kind != "MISMATCH" {
		t.Fatal("rejected attempt can change intent", got)
	}
	if counts := repaymentCounts(t, f); counts != [4]int{0, 0, 1, 1} {
		t.Fatal(counts)
	}
}

func TestRepaymentSettledOverpaymentAndD4(t *testing.T) {
	f := newExpenseFixture(t)
	call := repaymentEndpoint(t, f, f.db)
	// Clear the original 334/333 debts, then prove an actual transfer can reopen a settled group.
	for _, v := range []struct {
		sender int
		amount int64
	}{{301, 334}, {302, 333}} {
		in := repaymentInput(f)
		in.SenderID = f.public("Membership", v.sender)
		in.RecipientID = f.public("Membership", 303)
		in.Amount = v.amount
		if out := repaymentRecord(t, call, 3, in); out.Kind != "COMMITTED" {
			t.Fatal(out)
		}
	}
	in := repaymentInput(f)
	if !repaymentSnapshot(t, call, in).Balance.Settled {
		t.Fatal("initial debts not cleared")
	}
	in.Amount = 100
	out := repaymentRecord(t, call, 3, in)
	if out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	state := repaymentSnapshot(t, call, in)
	if state.Balance.Settled || state.Total != 1000 || state.Balance.Positions[0].Net != 100 || state.Balance.Positions[1].Net != -100 {
		t.Fatal(state.Balance)
	}
	reverse := in
	reverse.Key = uuid.NewString()
	reverse.SenderID, reverse.RecipientID = in.RecipientID, in.SenderID
	if out := repaymentRecord(t, call, 3, reverse); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	for _, v := range []struct{ payer, owes int }{{302, 301}, {303, 302}} {
		exp := f.input
		exp.Key = uuid.NewString()
		exp.Total = 2000
		exp.PayerID = f.public("Membership", v.payer)
		exp.ParticipantIDs = []string{f.public("Membership", v.owes)}
		if out := f.create(1, exp); out.Kind != "COMMITTED" {
			t.Fatal(out)
		}
	}
	state = repaymentSnapshot(t, call, in)
	if len(state.Balance.Obligations) != 1 || state.Balance.Obligations[0] != (ledger.Obligation{From: f.public("Membership", 301), To: f.public("Membership", 303), Amount: 2000}) {
		t.Fatal(state.Balance)
	}
	direct := in
	direct.Key = uuid.NewString()
	direct.RecipientID = f.public("Membership", 303)
	direct.Amount = 2500
	if out := repaymentRecord(t, call, 2, direct); out.Kind != "COMMITTED" {
		t.Fatal("D4 overpayment rejected", out)
	}
	state = repaymentSnapshot(t, call, in)
	if state.Total != 5000 || state.Balance.Positions[0].Net != 500 || state.Balance.Positions[1].Net != 0 || state.Balance.Positions[2].Net != -500 {
		t.Fatal(state.Balance)
	}
}

func TestRepaymentEligibilityChangeWinsWriteRace(t *testing.T) {
	for _, kind := range []string{"membership", "account"} {
		t.Run(kind, func(t *testing.T) {
			f := newExpenseFixture(t)
			call := repaymentEndpoint(t, f, f.db)
			in := repaymentInput(f)
			if kind == "membership" {
				// A real departure begins at exactly zero. The subsequent attempted
				// repayment must observe the completed transition and reject it.
				settle := repaymentInput(f)
				settle.SenderID = f.public("Membership", 302)
				settle.RecipientID = f.public("Membership", 303)
				settle.Amount = 333
				if out := repaymentRecord(t, call, 3, settle); out.Kind != "COMMITTED" {
					t.Fatal(out)
				}
			}
			held, e := f.admin.Begin(f.ctx)
			if e != nil {
				t.Fatal(e)
			}
			defer held.Rollback(context.Background())
			if _, e = held.Exec(f.ctx, "SET LOCAL ROLE kami_migrator"); e != nil {
				t.Fatal(e)
			}
			if kind == "account" {
				_, e = held.Exec(f.ctx, `UPDATE app.users SET enabled=false WHERE id=$1`, f.id(102))
			} else {
				// Administrative membership writers must use the documented
				// affected-user-before-group protocol, not a bare UPDATE.
				_, e = held.Exec(f.ctx, `SELECT id FROM app.users WHERE id=$1 FOR UPDATE`, f.id(102))
				if e == nil {
					_, e = held.Exec(f.ctx, `SELECT id FROM app.groups WHERE id=$1 FOR UPDATE`, f.id(201))
				}
				if e == nil {
					_, e = held.Exec(f.ctx, `UPDATE app.memberships SET active=false WHERE id=$1`, f.id(302))
				}
			}
			if e != nil {
				t.Fatal(e)
			}
			done := make(chan expense.Outcome, 1)
			go func() {
				var out expense.Outcome
				if call(3, "/record", in, &out) != 200 {
					t.Error("race request failed")
				}
				done <- out
			}()
			select {
			case got := <-done:
				t.Fatalf("write bypassed held eligibility lock: %+v", got)
			case <-time.After(100 * time.Millisecond):
			}
			if e = held.Commit(f.ctx); e != nil {
				t.Fatal(e)
			}
			select {
			case got := <-done:
				if got.Kind != "VALIDATION" {
					t.Fatalf("stale eligibility committed: %+v", got)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("write did not resume")
			}
			want := [4]int{0, 0, 1, 1}
			if kind == "membership" {
				want = [4]int{1, 1, 2, 2}
			}
			if got := repaymentCounts(t, f); got != want {
				t.Fatal(got)
			}
		})
	}
}

func TestRepaymentCandidateOverflowRejectsBothFinancialWrites(t *testing.T) {
	f := newExpenseFixture(t)
	call := repaymentEndpoint(t, f, f.db)
	in := repaymentInput(f)
	in.SenderID = f.public("Membership", 303)
	in.RecipientID = f.public("Membership", 301)
	in.Amount = 100
	saved := repaymentRecord(t, call, 2, in)
	if saved.Kind != "COMMITTED" {
		t.Fatal(saved)
	}
	raw, e := ledger.ParseID(saved.Repayment.RepaymentID, "Repayment")
	if e != nil {
		t.Fatal(e)
	}
	// Synthetic admin-only fixture: reaching this aggregate with bounded records
	// would require billions of inserts. Restore the ordinary record and validate
	// its original bound before fixture cleanup; tests in this package are serial.
	cleanup := fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; ALTER TABLE app.repayments NO FORCE ROW LEVEL SECURITY; UPDATE app.repayments SET amount_minor=100 WHERE id='%s'; ALTER TABLE app.repayments FORCE ROW LEVEL SECURITY; ALTER TABLE app.repayments VALIDATE CONSTRAINT repayments_amount_minor_check; COMMIT`, raw)
	t.Cleanup(func() {
		if _, e := f.admin.Exec(context.Background(), cleanup); e != nil {
			t.Error(e)
		}
	})
	f.exec(fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; ALTER TABLE app.repayments NO FORCE ROW LEVEL SECURITY; ALTER TABLE app.repayments DROP CONSTRAINT repayments_amount_minor_check; UPDATE app.repayments SET amount_minor=9223372036854775140 WHERE id='%s'; ALTER TABLE app.repayments ADD CONSTRAINT repayments_amount_minor_check CHECK(amount_minor BETWEEN 1 AND 999999999) NOT VALID; ALTER TABLE app.repayments FORCE ROW LEVEL SECURITY; COMMIT`, raw))
	before := repaymentSnapshot(t, call, in)
	if before.BalanceError != "" || before.Balance.Positions[2].Net != 9223372036854775807 {
		t.Fatalf("synthetic boundary not readable %+v", before)
	}
	newPayment := in
	newPayment.Key = uuid.NewString()
	newPayment.Amount = 1
	rejected := repaymentRecord(t, call, 2, newPayment)
	if rejected.Kind != "VALIDATION" || len(rejected.Fields) != 1 || rejected.Fields[0].Code != "AMOUNT_OVERFLOW" {
		t.Fatal("repayment net overflow", rejected)
	}
	exp := f.input
	exp.Key = uuid.NewString()
	exp.Total = 1
	exp.PayerID = f.public("Membership", 303)
	exp.ParticipantIDs = []string{f.public("Membership", 301)}
	rejectedExpense := f.create(2, exp)
	if rejectedExpense.Kind != "VALIDATION" || len(rejectedExpense.Fields) != 1 || rejectedExpense.Fields[0].Code != "AMOUNT_OVERFLOW" {
		t.Fatal("expense net overflow", rejectedExpense)
	}
	after := repaymentSnapshot(t, call, in)
	if !reflect.DeepEqual(before.Balance, after.Balance) || before.Revision != after.Revision {
		t.Fatal("overflow changed financial history")
	}
	var recovered expense.Outcome
	if call(2, "/recover", newPayment, &recovered) != 200 || !reflect.DeepEqual(recovered, rejected) {
		t.Fatal("overflow rejection not durable")
	}
	if got := repaymentCounts(t, f); got != [4]int{1, 1, 2, 2} {
		t.Fatal(got)
	}
}

func TestRepaymentRestrictedRegistryAndImmutableStorage(t *testing.T) {
	f := newExpenseFixture(t)
	tests := []struct {
		name, sql, code string
		args            []any
	}{
		{"cross-kind revision", `INSERT INTO app.repayments(
  id, group_id, creator_id, sender_id, recipient_id, amount_minor, currency, effective_date,
  note, revision
)
VALUES($1, $2, $3, $3, $4, 1, 'USD', '2026-09-30', '', 1)`, "23505", []any{uuid.NewString(), f.id(201), f.id(301), f.id(302)}},
		{"direct registry", `INSERT INTO app.financial_records(group_id,revision,kind,record_id) VALUES($1,2,'RECORD_REPAYMENT',$2)`, "42501", []any{f.id(201), uuid.NewString()}},
		{"repayment update", `UPDATE app.repayments SET note='tampered' WHERE group_id=$1`, "42501", []any{f.id(201)}},
		{"repayment delete", `DELETE FROM app.repayments WHERE group_id=$1`, "42501", []any{f.id(201)}},
		{"audit delete", `DELETE FROM app.repayment_audit WHERE group_id=$1`, "42501", []any{f.id(201)}},
		{"registry delete", `DELETE FROM app.financial_records WHERE group_id=$1`, "42501", []any{f.id(201)}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := f.db.WithIdentity(f.ctx, f.id(1), func(tx pgx.Tx) error { _, e := tx.Exec(f.ctx, tt.sql, tt.args...); return e })
			var pe *pgconn.PgError
			if !errors.As(err, &pe) || pe.Code != tt.code {
				t.Fatalf("expected %s, got %v", tt.code, err)
			}
		})
	}
	if got := repaymentCounts(t, f); got != [4]int{0, 0, 0, 1} {
		t.Fatal(got)
	}
}

func TestRepaymentDistinctConcurrentFinancialRevisions(t *testing.T) {
	f := newExpenseFixture(t)
	call := repaymentEndpoint(t, f, f.db)
	in := repaymentInput(f)
	start := make(chan struct{})
	results := make(chan expense.Outcome, 3)
	for i := 0; i < 2; i++ {
		p := in
		p.Key = uuid.NewString()
		go func() {
			<-start
			var out expense.Outcome
			if call(3, "/record", p, &out) != 200 {
				t.Error("repayment failed")
			}
			results <- out
		}()
	}
	go func() {
		<-start
		exp := f.input
		exp.Key = uuid.NewString()
		status, body := f.request(1, "/create", exp)
		var out expense.Outcome
		if status != 200 || json.Unmarshal(body, &out) != nil {
			t.Error("expense failed")
		}
		results <- out
	}()
	close(start)
	revisions := map[int64]bool{}
	for range 3 {
		out := <-results
		if out.Kind != "COMMITTED" {
			t.Fatal(out)
		}
		var rev int64
		if out.Repayment != nil {
			rev = out.Repayment.Revision
		} else {
			rev = out.Record.Revision
		}
		if rev < 2 || rev > 4 || revisions[rev] {
			t.Fatalf("duplicate/skipped revision %d", rev)
		}
		revisions[rev] = true
	}
	if got := repaymentCounts(t, f); got != [4]int{2, 2, 2, 4} {
		t.Fatal(got)
	}
	state := repaymentSnapshot(t, call, in)
	if state.Revision != 4 || state.Total != 2000 {
		t.Fatal(state)
	}
}

func TestRepaymentPreservesOldSignedExpenseCursor(t *testing.T) {
	f := newExpenseFixture(t)
	f.addSecondExpense(t)
	call := repaymentEndpoint(t, f, f.db)
	query := func(after any) map[string]any {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"query": `query ($id: ID!, $after: String) {
  group(id: $id) {
    ... on Group {
      expenses(first: 1, after: $after) {
        revision
        edges {
          node {
            id
          }
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
      balances {
        ... on GroupBalances {
          revision
          totalExpenseMinor
        }
      }
    }
  }
}`, "variables": map[string]any{"id": f.input.GroupID, "after": after}})
		req, _ := http.NewRequestWithContext(f.ctx, "POST", f.endpoint.URL+"/graphql", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+f.token(1))
		req.Header.Set("Content-Type", "application/json")
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		var decoded map[string]any
		if e = json.NewDecoder(res.Body).Decode(&decoded); e != nil || res.StatusCode != 200 || decoded["errors"] != nil {
			t.Fatalf("GraphQL %+v %v", decoded, e)
		}
		return decoded["data"].(map[string]any)["group"].(map[string]any)
	}
	first := query(nil)
	connection := first["expenses"].(map[string]any)
	cursor := connection["pageInfo"].(map[string]any)["endCursor"]
	if out := repaymentRecord(t, call, 3, repaymentInput(f)); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	next := f.input
	next.Key = uuid.NewString()
	next.EffectiveDate = "0001-01-01"
	if out := f.create(1, next); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	second := query(cursor)
	page := second["expenses"].(map[string]any)
	if page["revision"] != "2" || len(page["edges"].([]any)) != 1 || page["pageInfo"].(map[string]any)["hasNextPage"] != false || second["balances"].(map[string]any)["revision"] != "4" {
		t.Fatalf("old anchor changed %+v", second)
	}
	if page["edges"].([]any)[0].(map[string]any)["node"].(map[string]any)["id"] != f.original.Record.ExpenseID {
		t.Fatal("cursor admitted new backdated expense")
	}
}

func TestRepaymentWriteWinsEligibilityRace(t *testing.T) {
	for _, kind := range []string{"membership", "account"} {
		t.Run(kind, func(t *testing.T) {
			f := newExpenseFixture(t)
			call := repaymentEndpoint(t, f, f.db)
			in := repaymentInput(f)
			lockKey := time.Now().UnixNano()
			fn := "test_pause_repayment"
			f.exec(fmt.Sprintf(`SET ROLE kami_migrator; CREATE FUNCTION app.%s() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(%d); RETURN NEW; END $$; CREATE TRIGGER %s BEFORE INSERT ON app.repayments FOR EACH ROW EXECUTE FUNCTION app.%s(); RESET ROLE`, fn, lockKey, fn, fn))
			t.Cleanup(func() {
				_, e := f.admin.Exec(context.Background(), fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; DROP TRIGGER IF EXISTS %s ON app.repayments; DROP FUNCTION IF EXISTS app.%s(); COMMIT`, fn, fn))
				if e != nil {
					t.Error(e)
				}
			})
			if _, e := f.admin.Exec(f.ctx, `SELECT pg_advisory_lock($1)`, lockKey); e != nil {
				t.Fatal(e)
			}
			defer f.admin.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, lockKey)
			written := make(chan expense.Outcome, 1)
			go func() {
				var out expense.Outcome
				if call(3, "/record", in, &out) != 200 {
					t.Error("write failed")
				}
				written <- out
			}()
			deadline := time.Now().Add(5 * time.Second)
			for {
				var waiting bool
				if e := f.admin.QueryRow(f.ctx, `SELECT EXISTS(SELECT FROM pg_locks WHERE locktype='advisory' AND NOT granted)`).Scan(&waiting); e != nil {
					t.Fatal(e)
				}
				if waiting {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("writer did not reach post-authorization insert")
				}
				time.Sleep(10 * time.Millisecond)
			}
			// The trigger is reached only after participant user and group write locks.
			changer, e := pgx.Connect(f.ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
			if e != nil {
				t.Fatal(e)
			}
			defer changer.Close(context.Background())
			changed := make(chan error, 1)
			go func() {
				var query string
				if kind == "account" {
					query = `UPDATE app.users SET enabled=false WHERE id=$1`
				} else {
					query = `UPDATE app.memberships SET active=false WHERE id=$1`
				}
				tx, e := changer.Begin(f.ctx)
				if e != nil {
					changed <- e
					return
				}
				_, e = tx.Exec(f.ctx, "SET LOCAL ROLE kami_migrator")
				if e == nil {
					target := f.id(302)
					if kind == "account" {
						target = f.id(102)
					}
					if kind == "membership" {
						_, e = tx.Exec(f.ctx, `SELECT id FROM app.users WHERE id=$1 FOR UPDATE`, f.id(102))
						if e == nil {
							_, e = tx.Exec(f.ctx, `SELECT id FROM app.groups WHERE id=$1 FOR UPDATE`, f.id(201))
						}
					}
					if e == nil {
						_, e = tx.Exec(f.ctx, query, target)
					}
				}
				if e == nil {
					e = tx.Commit(f.ctx)
				}
				_ = tx.Rollback(context.Background())
				changed <- e
			}()
			select {
			case e := <-changed:
				t.Fatalf("eligibility change bypassed write locks: %v", e)
			case <-time.After(100 * time.Millisecond):
			}
			if _, e = f.admin.Exec(f.ctx, `SELECT pg_advisory_unlock($1)`, lockKey); e != nil {
				t.Fatal(e)
			}
			out := <-written
			if out.Kind != "COMMITTED" {
				t.Fatal(out)
			}
			e = <-changed
			if kind == "membership" {
				var pgerr *pgconn.PgError
				if !errors.As(e, &pgerr) || pgerr.Code != "23514" {
					t.Fatalf("departure did not reject resulting nonzero balance: %v", e)
				}
			} else if e != nil {
				t.Fatal(e)
			}
			var recovered expense.Outcome
			if call(3, "/recover", in, &recovered) != 200 || !reflect.DeepEqual(recovered, out) {
				t.Fatal("write winner not recoverable")
			}
			if got := repaymentCounts(t, f); got != [4]int{1, 1, 1, 2} {
				t.Fatal(got)
			}
		})
	}
}

func TestRepaymentHistoryRetainedForFullBackupRestore(t *testing.T) {
	f := newExpenseFixture(t)
	call := repaymentEndpoint(t, f, f.db)
	in := repaymentInput(f)
	out := repaymentRecord(t, call, 3, in)
	if out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	if got := repaymentCounts(t, f); got != [4]int{1, 1, 1, 2} {
		t.Fatal(got)
	}
	f.retainForBackup()
}

func TestRepaymentRevisionExhaustionIsDurable(t *testing.T) {
	f := newExpenseFixture(t)
	call := repaymentEndpoint(t, f, f.db)
	in := repaymentInput(f)
	original := repaymentRecord(t, call, 3, in)
	if original.Kind != "COMMITTED" {
		t.Fatal(original)
	}
	// Privileged synthetic fixture reaches the shared sequence's final value;
	// record and registry stay aligned. Runtime never receives mutation grants.
	f.exec(fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; ALTER TABLE app.repayments NO FORCE ROW LEVEL SECURITY; ALTER TABLE app.financial_records NO FORCE ROW LEVEL SECURITY; UPDATE app.repayments SET revision=9223372036854775807 WHERE group_id='%s'; UPDATE app.financial_records SET revision=9223372036854775807 WHERE group_id='%s' AND kind='RECORD_REPAYMENT'; ALTER TABLE app.repayments FORCE ROW LEVEL SECURITY; ALTER TABLE app.financial_records FORCE ROW LEVEL SECURITY; COMMIT`, f.id(201), f.id(201)))
	next := in
	next.Key = uuid.NewString()
	out := repaymentRecord(t, call, 3, next)
	if out.Kind != "VALIDATION" || len(out.Fields) != 1 || out.Fields[0].Code != "AMOUNT_OVERFLOW" {
		t.Fatalf("revision exhaustion %+v", out)
	}
	var recovered expense.Outcome
	if call(3, "/recover", next, &recovered) != 200 || !reflect.DeepEqual(recovered, out) {
		t.Fatal("exhaustion result not durable", recovered)
	}
	if retry := repaymentRecord(t, call, 3, next); !reflect.DeepEqual(retry, out) {
		t.Fatal("exhausted same attempt changed", retry)
	}
	state := repaymentSnapshot(t, call, in)
	if state.Revision != 9223372036854775807 || state.Total != 1000 {
		t.Fatal("exhaustion mutated revision/spending", state)
	}
	if got := repaymentCounts(t, f); got != [4]int{1, 1, 2, 2} {
		t.Fatal("exhaustion has financial effect", got)
	}
}
