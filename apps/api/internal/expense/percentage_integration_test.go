//go:build integration

package expense_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/jackc/pgx/v5"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"
	"time"
)

func TestPercentagePersistReadRecoverAndReplay(t *testing.T) {
	f := newExpenseFixture(t)
	in := f.input
	in.Key = uuid.NewString()
	in.Split = "PERCENTAGE"
	in.Total = 1001
	in.ParticipantIDs = []string{f.public("Membership", 302), f.public("Membership", 301)}
	in.Percentages = []ledger.Percentage{{ParticipantID: in.ParticipantIDs[0], Hundredths: 4000}, {ParticipantID: in.ParticipantIDs[1], Hundredths: 6000}}
	var wg sync.WaitGroup
	outcomes := make(chan expense.Outcome, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); outcomes <- f.create(1, in) }()
	}
	wg.Wait()
	close(outcomes)
	var original expense.Outcome
	for out := range outcomes {
		if out.Kind != "COMMITTED" {
			t.Fatal(out)
		}
		if original.Record == nil {
			original = out
		}
		if !reflect.DeepEqual(out, original) {
			t.Fatal("duplicate outcome differs")
		}
	}
	if original.Record.Allocations[0].Amount != 601 || original.Record.Allocations[1].Amount != 400 {
		t.Fatal(original)
	}
	status, body := f.request(1, "/recover", in)
	var recovered expense.Outcome
	if status != 200 || json.Unmarshal(body, &recovered) != nil || !reflect.DeepEqual(original, recovered) {
		t.Fatal("recovery lost intent", string(body))
	}
	status, body = f.request(1, "/read", in)
	var snapshot expense.Snapshot
	if status != 200 || json.Unmarshal(body, &snapshot) != nil || len(snapshot.Records) != 1 || !reflect.DeepEqual(snapshot.Records[0].Percentages, original.Record.Percentages) {
		t.Fatal("read lost intent", string(body))
	}
	var count int
	raw, _ := ledger.ParseID(original.Record.ExpenseID, "Expense")
	if err := f.admin.QueryRow(f.ctx, `SELECT count(*) FROM app.expenses WHERE id=$1`, raw).Scan(&count); err != nil || count != 1 {
		t.Fatal("duplicate financial effect", err, count)
	}
	// Same key, same normalized intent despite ordering returns original after eligibility changes.
	in.Percentages[0], in.Percentages[1] = in.Percentages[1], in.Percentages[0]
	in.ParticipantIDs[0], in.ParticipantIDs[1] = in.ParticipantIDs[1], in.ParticipantIDs[0]
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator;UPDATE app.memberships SET active=false WHERE id='%s';RESET ROLE`, f.id(302)))
	if out := f.create(1, in); !reflect.DeepEqual(out, original) {
		t.Fatal("historical replay invalidated", out)
	}
	status, _ = f.request(4, "/recover", in)
	if status == 200 {
		t.Fatal("cross-group recovered private intent")
	}
	status, _ = f.request(2, "/recover", in)
	if status == 200 {
		t.Fatal("inactive actor recovered intent")
	}
	// Exact cents match but distinct intent cannot overwrite the operation.
	tiny := f.input
	tiny.Key = uuid.NewString()
	tiny.Total = 1
	tiny.Split = "PERCENTAGE"
	tiny.ParticipantIDs = []string{f.public("Membership", 301), f.public("Membership", 303)}
	tiny.Percentages = []ledger.Percentage{{ParticipantID: tiny.ParticipantIDs[0], Hundredths: 6000}, {ParticipantID: tiny.ParticipantIDs[1], Hundredths: 4000}}
	if out := f.create(1, tiny); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	tiny.Percentages[0].Hundredths = 7000
	tiny.Percentages[1].Hundredths = 3000
	if out := f.create(1, tiny); out.Kind != "MISMATCH" {
		t.Fatal("same cents lost intent", out)
	}
}

func TestPercentageDurableRejectionAndDatabaseConstraints(t *testing.T) {
	f := newExpenseFixture(t)
	in := f.input
	in.Key = uuid.NewString()
	in.Split = "PERCENTAGE"
	for _, id := range in.ParticipantIDs {
		in.Percentages = append(in.Percentages, ledger.Percentage{ParticipantID: id, Hundredths: 3333})
	}
	rejected := f.create(1, in)
	if rejected.Kind != "VALIDATION" {
		t.Fatal("accepted 99.99", rejected)
	}
	status, body := f.request(1, "/recover", in)
	var recovered expense.Outcome
	if status != 200 || json.Unmarshal(body, &recovered) != nil || !reflect.DeepEqual(rejected, recovered) {
		t.Fatal("rejection not durable")
	}
	in.Key = uuid.NewString()
	in.Percentages[0].Hundredths = 3334
	out := f.create(1, in)
	if out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	raw, _ := ledger.ParseID(out.Record.ExpenseID, "Expense")
	// Even a privileged direct caller cannot insert inconsistent historical metadata.
	tx, err := f.admin.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(f.ctx)
	if _, err = tx.Exec(f.ctx, `UPDATE app.allocations SET percentage_hundredths=10001 WHERE expense_id=$1`, raw); err == nil {
		t.Fatal("database accepted out of range")
	}
	// Actual GraphQL authorized read contains null on old Equal and intended values on Percentage.
	query := fmt.Sprintf(`query { node(id:%q) { ... on Expense { split allocations { amountMinor percentageHundredths } } } }`, out.Record.ExpenseID)
	payload, _ := json.Marshal(map[string]any{"query": query})
	req, _ := http.NewRequestWithContext(f.ctx, "POST", f.endpoint.URL+"/graphql", bytes.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+f.token(1))
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var result map[string]any
	if json.NewDecoder(res.Body).Decode(&result) != nil || result["errors"] != nil {
		t.Fatal(result)
	}
	node := result["data"].(map[string]any)["node"].(map[string]any)
	if node["split"] != "PERCENTAGE" || len(node["allocations"].([]any)) != 3 {
		t.Fatal(node)
	}
}

func TestPercentageRollbackDoesNotInvalidateCommittedRecovery(t *testing.T) {
	f := newExpenseFixture(t)
	in := f.input
	in.Split = "PERCENTAGE"
	in.Key = uuid.NewString()
	in.ParticipantIDs = []string{f.public("Membership", 301), f.public("Membership", 302)}
	in.Percentages = []ledger.Percentage{{ParticipantID: in.ParticipantIDs[0], Hundredths: 0}, {ParticipantID: in.ParticipantIDs[1], Hundredths: 10000}}
	committed := f.create(1, in)
	if committed.Kind != "COMMITTED" {
		t.Fatal(committed)
	}
	// Verify explicit zero survives database filters and complete balances.
	req, _ := http.NewRequestWithContext(f.ctx, "POST", f.endpoint.URL+"/read", bytes.NewReader([]byte(fmt.Sprintf(`{"GroupID":%q}`, in.GroupID))))
	req.Header.Set("Authorization", "Bearer "+f.token(1))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var snapshot expense.Snapshot
	if json.NewDecoder(res.Body).Decode(&snapshot) != nil || snapshot.Total != 2000 {
		t.Fatal(snapshot)
	}
	var net int64
	for _, p := range snapshot.Balance.Positions {
		net += p.Net
	}
	if net != 0 {
		t.Fatal("unbalanced")
	}
	if snapshot.Records[0].Allocations[0].Amount != 0 || snapshot.Records[0].Percentages[0].Hundredths != 0 {
		t.Fatal("zero lost")
	}
	// Fresh writes can be disabled without removing previously committed outcomes.
	// The HTTP fixture enables writes; use the same verified actor boundary below.
	disabled := expense.New(f.db)

	endpoint := httptest.NewServer(f.verifier.Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input ledger.Input
		_ = json.NewDecoder(r.Body).Decode(&input)
		out, err := disabled.Create(r.Context(), input)
		if err != nil {
			w.WriteHeader(500)
			return
		}
		_ = json.NewEncoder(w).Encode(out)
	})))
	defer endpoint.Close()
	create := func(input ledger.Input) expense.Outcome {
		body, _ := json.Marshal(input)
		request, _ := http.NewRequestWithContext(f.ctx, "POST", endpoint.URL, bytes.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+f.token(1))
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var out expense.Outcome
		if response.StatusCode != 200 || json.NewDecoder(response.Body).Decode(&out) != nil {
			t.Fatal("failed disabled service")
		}
		return out
	}
	if out := create(in); !reflect.DeepEqual(out, committed) {
		t.Fatal("rollback lost original", out)
	}
	in.Key = uuid.NewString()
	if out := create(in); out.Kind != "VALIDATION" {
		t.Fatal("rollback allowed new write", out)
	}
}

func TestPercentageDeferredConstraintsRejectAtomically(t *testing.T) {
	f := newExpenseFixture(t)
	in := f.input
	in.Key = uuid.NewString()
	in.Split = "PERCENTAGE"
	in.Total = 1001
	in.ParticipantIDs = []string{f.public("Membership", 301), f.public("Membership", 302)}
	in.Percentages = []ledger.Percentage{{ParticipantID: in.ParticipantIDs[0], Hundredths: 6000}, {ParticipantID: in.ParticipantIDs[1], Hundredths: 4000}}
	original := f.create(1, in)
	if original.Kind != "COMMITTED" {
		t.Fatal(original)
	}
	for _, scenario := range []string{"missing percentage", "sum mismatch", "wrong rounding", "outcome mismatch", "mixed mode"} {
		t.Run(scenario, func(t *testing.T) {
			conn, err := pgx.Connect(f.ctx, f.runtime)
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close(f.ctx)
			tx, err := conn.Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(f.ctx)
			if _, err = tx.Exec(f.ctx, `SELECT set_config('app.verified_sub',$1,true)`, f.id(1)); err != nil {
				t.Fatal(err)
			}
			id, key := uuid.NewString(), uuid.NewString()
			mode := "PERCENTAGE"
			if scenario == "mixed mode" {
				mode = "EQUAL"
			}
			record := *original.Record
			record.ExpenseID = ledger.PublicID("Expense", id)
			record.Revision++
			record.Split = mode
			var committed time.Time
			err = tx.QueryRow(f.ctx, `INSERT INTO app.expenses(id,group_id,creator_id,payer_id,total_minor,currency,description,effective_date,category,note,split,revision) VALUES($1,$2,$3,$4,1001,'USD','Constraint probe','2026-10-05','OTHER','',$5,$6) RETURNING created_at`, id, f.id(201), f.id(301), f.id(303), mode, record.Revision).Scan(&committed)
			if err != nil {
				t.Fatal(err)
			}
			record.CommittedAt = committed.UTC().Format("2006-01-02T15:04:05.000000Z")
			for i, share := range record.Allocations {
				raw, _ := ledger.ParseID(share.ParticipantID, "Membership")
				amount := share.Amount
				var percentage any = record.Percentages[i].Hundredths
				if scenario == "missing percentage" && i == 0 {
					percentage = nil
				}
				if scenario == "sum mismatch" && i == 0 {
					percentage = int64(5999)
				}
				if scenario == "wrong rounding" {
					if i == 0 {
						amount = 600
					} else {
						amount = 401
					}
				}
				if _, err = tx.Exec(f.ctx, `INSERT INTO app.allocations(expense_id,group_id,participant_id,amount_minor,percentage_hundredths) VALUES($1,$2,$3,$4,$5)`, id, f.id(201), raw, amount, percentage); err != nil {
					t.Fatal(err)
				}
			}
			if _, err = tx.Exec(f.ctx, `INSERT INTO app.expense_audit(expense_id,group_id,actor_user_id,creator_id,event,committed_at) VALUES($1,$2,$3,$4,'CREATE_EXPENSE',$5)`, id, f.id(201), f.id(101), f.id(301), committed); err != nil {
				t.Fatal(err)
			}
			record.Percentages = append([]ledger.Percentage(nil), record.Percentages...)
			if scenario == "outcome mismatch" {
				record.Percentages[0].Hundredths = 7000
				record.Percentages[1].Hundredths = 3000
			}
			payload, _ := json.Marshal(expense.Outcome{Kind: "COMMITTED", Key: key, Record: &record})
			_, canonical, hash, err := ledger.Normalize(in)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = tx.Exec(f.ctx, `INSERT INTO app.expense_operations(actor_user_id,group_id,operation_kind,key,canonical_version,canonical,canonical_hash,expense_id,outcome) VALUES($1,$2,'CREATE_EXPENSE',$3,'create-expense-percentage-v2',$4,$5,$6,$7)`, f.id(101), f.id(201), key, canonical, hash[:], id, payload); err != nil {
				t.Fatal(err)
			}
			if err = tx.Commit(f.ctx); err == nil {
				t.Fatal("committed invalid percentage history")
			}
			var count int
			if err = f.admin.QueryRow(f.ctx, `SELECT (SELECT count(*) FROM app.expenses WHERE id=$1)+(SELECT count(*) FROM app.expense_operations WHERE expense_id=$1)+(SELECT count(*) FROM app.allocations WHERE expense_id=$1)+(SELECT count(*) FROM app.expense_audit WHERE expense_id=$1)+(SELECT count(*) FROM app.financial_records WHERE record_id=$1)`, id).Scan(&count); err != nil || count != 0 {
				t.Fatal("partial effect", count, err)
			}
		})
	}
}

func TestPercentageGraphQLCreateTransport(t *testing.T) {
	f := newExpenseFixture(t)
	key := uuid.NewString()
	query := fmt.Sprintf(`mutation { createExpense(input:{groupId:%q,key:%q,totalMinor:"1001",currency:USD,description:"Coffee stop",effectiveDate:"2026-10-05",category:DINING,note:"",payerId:%q,participantIds:[%q,%q],split:PERCENTAGE,percentages:[{participantId:%q,hundredths:6000},{participantId:%q,hundredths:4000}]}) { __typename ... on ExpenseCommitted { record { split allocations { amountMinor percentageHundredths } } } } }`, f.public("Group", 201), key, f.public("Membership", 303), f.public("Membership", 301), f.public("Membership", 302), f.public("Membership", 301), f.public("Membership", 302))
	payload, _ := json.Marshal(map[string]any{"query": query})
	req, _ := http.NewRequestWithContext(f.ctx, "POST", f.endpoint.URL+"/graphql", bytes.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+f.token(1))
	req.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result map[string]any
	if err = json.NewDecoder(response.Body).Decode(&result); err != nil || result["errors"] != nil {
		t.Fatal(result, err)
	}
	outcome := result["data"].(map[string]any)["createExpense"].(map[string]any)
	if outcome["__typename"] != "ExpenseCommitted" {
		t.Fatal(outcome)
	}
	shares := outcome["record"].(map[string]any)["allocations"].([]any)
	if shares[0].(map[string]any)["amountMinor"] != "601" || shares[0].(map[string]any)["percentageHundredths"] != float64(6000) {
		t.Fatal(shares)
	}
}

func TestPercentageStructuredReadPreservesZeroIntent(t *testing.T) {
	f := newExpenseFixture(t)
	in := f.input
	in.Key = uuid.NewString()
	in.Split = "PERCENTAGE"
	in.Total = 1
	in.ParticipantIDs = []string{f.public("Membership", 301), f.public("Membership", 302)}
	in.Percentages = []ledger.Percentage{{ParticipantID: in.ParticipantIDs[0], Hundredths: 0}, {ParticipantID: in.ParticipantIDs[1], Hundredths: 10000}}
	out := f.create(1, in)
	if out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	query := fmt.Sprintf(`query { groupExpenses(groupId:%q,first:20,filter:{memberId:%q}) { ... on ExpenseView { edges { node { id split allocations { participant { id } amountMinor percentageHundredths } } } } } }`, in.GroupID, in.ParticipantIDs[0])
	payload, _ := json.Marshal(map[string]any{"query": query})
	request, _ := http.NewRequestWithContext(f.ctx, "POST", f.endpoint.URL+"/graphql", bytes.NewReader(payload))
	request.Header.Set("Authorization", "Bearer "+f.token(1))
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result map[string]any
	if json.NewDecoder(response.Body).Decode(&result) != nil || result["errors"] != nil {
		t.Fatal(result)
	}
	edges := result["data"].(map[string]any)["groupExpenses"].(map[string]any)["edges"].([]any)
	var found bool
	for _, edge := range edges {
		node := edge.(map[string]any)["node"].(map[string]any)
		if node["id"] != out.Record.ExpenseID {
			continue
		}
		found = true
		shares := node["allocations"].([]any)
		if len(shares) != 2 {
			t.Fatal(node)
		}
		zero := shares[0].(map[string]any)
		if zero["percentageHundredths"] != float64(0) || zero["amountMinor"] != "0" || zero["participant"].(map[string]any)["id"] != in.ParticipantIDs[0] {
			t.Fatal("structured projection lost zero intent", node)
		}
	}
	if !found {
		t.Fatal("zero-share expense excluded by participant filter")
	}
}
