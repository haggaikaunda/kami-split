//go:build integration

package graph_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
)

func TestIndependentBankingHTTPReplacementForeignCancellationMasksBindingState(t *testing.T) {
	s := independentReplacementHTTP(t)
	f := s.f
	p := f.operation(s.handler, s.preview, s.owner, "bankingReplacementPreview", false)
	expected := replacementHTTPExpected(t, p)
	connection, account := uuid.NewString(), uuid.NewString()
	f.exec(`INSERT INTO app.banking_connections(id,owner_id,environment,provider,provider_item_id,permission_state) VALUES($1,$2,'sandbox','plaid','foreign-cancellation-fixture','granted')`, connection, f.other)
	f.exec(`INSERT INTO app.banking_accounts(id,owner_id,kind,selected) VALUES($1,$2,'checking',true)`, account, f.other)
	bindings := map[string]string{"absent": uuid.NewString()}
	for _, state := range []string{"staged", "current", "retired", "cancelled"} {
		id := uuid.NewString()
		bindings[state] = id
		f.exec(`INSERT INTO app.banking_bindings(id,owner_id,connection_id,account_id,provider_account_id,reporting_state,collection_stopped,import_state) VALUES($1,$2,$3,$4,$5,$5,$6,'usable')`, id, f.other, connection, account, state, state == "retired" || state == "cancelled")
	}
	snapshot := func() string {
		t.Helper()
		var digest string
		err := f.admin.QueryRow(context.Background(), `SELECT md5(jsonb_build_array(
   (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM app.banking_connections c WHERE owner_id IN($1,$2)),
   (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM app.banking_accounts a WHERE owner_id IN($1,$2)),
   (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM app.banking_bindings b WHERE owner_id IN($1,$2)),
   (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM app.banking_plans p WHERE owner_id IN($1,$2)),
   (SELECT jsonb_agg(to_jsonb(w) ORDER BY w.id) FROM app.banking_work w JOIN app.banking_connections c ON c.id=w.connection_id WHERE c.owner_id IN($1,$2))
   )::text)`, f.owner, f.other).Scan(&digest)
		if err != nil {
			t.Fatal("cannot inspect owned cancellation fixture", err)
		}
		return digest
	}
	before := snapshot()
	codes := map[string]any{}
	// The account and preview guards are valid for the caller. Only the supplied
	// binding differs, and every real binding here belongs to the other actor.
	for _, state := range []string{"absent", "current", "retired", "cancelled", "staged"} {
		request := fmt.Sprintf(`{accountId:%q,bindingId:%q,action:ACTIVATE,transitionDate:"2026-09-30"}`, s.account.String(), bindings[state])
		query := fmt.Sprintf(`mutation{cancelBankingReplacement(input:{attemptId:%q,request:%s,expected:%s}){code resultId}}`, uuid.NewString(), request, expected)
		result := f.operation(s.handler, query, s.owner, "cancelBankingReplacement", false)
		codes[state] = result["code"]
		if result["resultId"] != nil {
			t.Error("foreign cancellation disclosed successful binding identity", state)
		}
		if snapshot() != before {
			t.Fatal("foreign cancellation mutated persisted account/connection/stream/plan/work state", state)
		}
	}
	for _, state := range []string{"current", "retired", "cancelled", "staged"} {
		if codes[state] != codes["absent"] {
			t.Errorf("foreign binding state distinguishable from absence: absent=%v, %s=%v", codes["absent"], state, codes[state])
		}
	}
	if codes["absent"] != "CONFLICT" && codes["absent"] != "NOT_FOUND" {
		t.Error("invalid binding did not return safe expected denial", codes["absent"])
	}
}
