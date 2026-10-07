//go:build integration

package expense_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestSelfProfilePersistenceAndConcurrency(t *testing.T) {
	f := newExpenseFixture(t)
	financialSnapshot := func() string {
		t.Helper()
		var snapshot string
		err := f.db.WithIdentity(f.ctx, f.id(1), func(tx pgx.Tx) error {
			return tx.QueryRow(f.ctx, `SELECT jsonb_build_object(
    'expenses',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM app.expenses e WHERE group_id=$1),
    'allocations',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.participant_id) FROM app.allocations a WHERE group_id=$1),
    'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.expense_id) FROM app.expense_audit a WHERE group_id=$1),
    'operations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.key) FROM app.expense_operations o WHERE group_id=$1))::text`, f.id(201)).Scan(&snapshot)
		})
		if err != nil {
			t.Fatal(err)
		}
		// Runtime has only reviewed membership columns, so inspect the complete
		// fixture rows through the existing test administrator and transaction-local
		// owner role. Production grants and RLS are never altered.
		var memberships string
		err = pgx.BeginTxFunc(f.ctx, f.admin, pgx.TxOptions{}, func(tx pgx.Tx) error {
			if _, err := tx.Exec(f.ctx, "SET LOCAL ROLE kami_migrator"); err != nil {
				return err
			}
			return tx.QueryRow(f.ctx, `SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id)::text FROM app.memberships m WHERE group_id=$1`, f.id(201)).Scan(&memberships)
		})
		if err != nil {
			t.Fatal(err)
		}
		return snapshot + memberships
	}
	originalFinancial := financialSnapshot()
	request := func(actor int, query string, variables map[string]any) map[string]any {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"query": query, "variables": variables})
		req, _ := http.NewRequest(http.MethodPost, f.endpoint.URL+"/graphql", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if actor != 0 {
			req.Header.Set("Authorization", "Bearer "+f.token(actor))
		}
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, _ := io.ReadAll(response.Body)
		var result map[string]any
		if err := json.Unmarshal(raw, &result); err != nil {
			t.Fatalf("decode: %s", raw)
		}
		return result
	}
	query := `query { currentProfile { __typename ... on Profile { id displayName } ... on ProfileProblem { code } } }`
	mutation := `mutation($name:String!,$expected:String!) { updateMyProfile(displayName:$name,expectedDisplayName:$expected) { __typename ... on Profile { id displayName } ... on ProfileProblem { code } } }`
	operation := func(actor int, name, expected string) map[string]any {
		return request(actor, mutation, map[string]any{"name": name, "expected": expected})
	}
	result := func(data map[string]any, field string) map[string]any {
		t.Helper()
		value, ok := data["data"].(map[string]any)
		if !ok {
			t.Fatalf("missing data: %+v", data)
		}
		return value[field].(map[string]any)
	}
	before := result(request(2, query, nil), "currentProfile")
	if before["id"] != f.public("Profile", 102) {
		t.Fatal("profile ID must be globally distinct from Viewer", before)
	}
	if before["displayName"] != "Actor 2" {
		t.Fatal(before)
	}
	// The invited ordinary member has no group-creation capability.
	saved := result(operation(2, "\u0085\u3000 Zoë 李 😀 \u00a0", "Actor 2"), "updateMyProfile")
	if saved["displayName"] != "Zoë 李 😀" || saved["id"] != before["id"] {
		t.Fatal(saved)
	}
	read := result(request(2, query, nil), "currentProfile")
	if read["displayName"] != saved["displayName"] {
		t.Fatal(read)
	}
	var projectedName string
	if err := f.db.WithIdentity(f.ctx, f.id(1), func(tx pgx.Tx) error {
		return tx.QueryRow(f.ctx, `SELECT display_name FROM app.group_members($1) WHERE id=$2`, f.id(201), f.id(302)).Scan(&projectedName)
	}); err != nil {
		t.Fatal(err)
	}
	if projectedName != "Zoë 李 😀" {
		t.Fatal("authorized member name did not refresh", projectedName)
	}
	retry := result(operation(2, "Zoë 李 😀", "Actor 2"), "updateMyProfile")
	if retry["displayName"] != saved["displayName"] {
		t.Fatal(retry)
	}
	stale := result(operation(2, "Overwrite", "Actor 2"), "updateMyProfile")
	if stale["code"] != "CONFLICT" {
		t.Fatal(stale)
	}
	for _, invalid := range []string{"", "\t\u0085\u3000", strings.Repeat("😀", 121)} {
		rejected := result(operation(2, invalid, "Zoë 李 😀"), "updateMyProfile")
		if rejected["code"] != "INVALID_INPUT" {
			t.Fatal(rejected)
		}
	}
	boundary := result(operation(2, strings.Repeat("😀", 120), "Zoë 李 😀"), "updateMyProfile")
	if boundary["displayName"] != strings.Repeat("😀", 120) {
		t.Fatal(boundary)
	}
	restored := result(operation(2, "Zoë 李 😀", strings.Repeat("😀", 120)), "updateMyProfile")
	if restored["displayName"] != "Zoë 李 😀" {
		t.Fatal(restored)
	}
	var wg sync.WaitGroup
	outcomes := make(chan map[string]any, 2)
	for _, name := range []string{"Concurrent A", "Concurrent B"} {
		wg.Add(1)
		go func(name string) { defer wg.Done(); outcomes <- operation(2, name, "Zoë 李 😀") }(name)
	}
	wg.Wait()
	close(outcomes)
	successes, conflicts := 0, 0
	for value := range outcomes {
		out := result(value, "updateMyProfile")
		if out["__typename"] == "Profile" {
			successes++
		} else if out["code"] == "CONFLICT" {
			conflicts++
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("success=%d conflicts=%d", successes, conflicts)
	}
	if financialSnapshot() != originalFinancial {
		t.Fatal("profile edit changed financial history or memberships")
	}
	unprovisioned := result(operation(5, "Unprovisioned", ""), "updateMyProfile")
	if unprovisionedRead := result(request(5, query, nil), "currentProfile"); unprovisionedRead["code"] != "FORBIDDEN" {
		t.Fatal(unprovisionedRead)
	}
	if unprovisioned["code"] != "FORBIDDEN" {
		t.Fatal(unprovisioned)
	}
	injected := request(1, `mutation { updateMyProfile(displayName:"Cross-user",expectedDisplayName:"Actor 2",id:"`+f.public("Viewer", 102)+`") { __typename } }`, nil)
	if injected["errors"] == nil {
		t.Fatal("cross-user target argument accepted", injected)
	}
	// A different authenticated account can update only itself; no target ID exists.
	other := result(request(1, query, nil), "currentProfile")
	if other["displayName"] != "Actor 1" {
		t.Fatal(other)
	}
	var identity, history string
	f.exec("SET ROLE kami_migrator")
	if err := f.admin.QueryRow(f.ctx, `SELECT auth_subject::text,display_name FROM app.users WHERE id=$1`, f.id(102)).Scan(&identity, &history); err != nil {
		t.Fatal(err)
	}
	f.exec("RESET ROLE")
	if identity != f.id(2) {
		t.Fatal(identity)
	}
	// Financial allocations, audit and recovery receipts retain the original values.
	recovered := f.create(1, f.input)
	if recovered.Record.ExpenseID != f.original.Record.ExpenseID || recovered.Record.TotalMinor != f.original.Record.TotalMinor {
		t.Fatalf("financial receipt changed: %+v", recovered)
	}
	if anonymous := request(0, query, nil); anonymous["errors"] == nil {
		t.Fatal("anonymous accepted", anonymous)
	}
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.users SET enabled=false WHERE id='%s'; RESET ROLE`, f.id(102)))
	if disabled := result(operation(2, "Disabled", history), "updateMyProfile"); disabled["code"] != "FORBIDDEN" {
		t.Fatal(disabled)
	}
	if disabledRead := result(request(2, query, nil), "currentProfile"); disabledRead["code"] != "FORBIDDEN" {
		t.Fatal(disabledRead)
	}
	// The restricted runtime still has no arbitrary users table write privilege.
	if err := f.db.WithIdentity(f.ctx, f.id(1), func(tx pgx.Tx) error {
		_, err := tx.Exec(f.ctx, `UPDATE app.users SET display_name='Cross-user' WHERE id=$1`, f.id(102))
		return err
	}); err == nil {
		t.Fatal("runtime table write allowed")
	}
}
