//go:build integration

package graph_test

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/banking"
	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
	"github.com/haggaikaunda/kami-split/apps/api/internal/server"
)

func bankingConnectionsQuery(arguments string) string {
	selection := strings.Replace(bankingImportSelection, "{code connection{", "{code endCursor hasNextPage connections{", 1)
	return "query{bankingConnections" + arguments + selection + "}"
}

// Each separate institution authorization in this fixture exposes a distinct
// stable bank account. Production duplicate protection remains enabled.
type inventoryProvider struct{ *bankingHTTPProvider }

func (p inventoryProvider) Accounts(ctx context.Context, environment string, token banking.Credential) (banking.AccountInventory, error) {
	inventory, err := p.bankingHTTPProvider.Accounts(ctx, environment, token)
	for i := range inventory.Accounts {
		if inventory.Accounts[i].StableID != "" {
			inventory.Accounts[i].StableID += inventory.ItemID
		}
	}
	return inventory, err
}

func TestBankingHTTPConnectionsFreshSessionOwnerScopeAndStatus(t *testing.T) {
	f := newBankingHTTPFixture(t)
	handler := func(enabled bool) http.Handler {
		enrollment, err := banking.NewEnrollment(f.storage, inventoryProvider{f.provider}, banking.EnrollmentConfig{Enabled: enabled, Environment: "sandbox", WebhookOrigin: "https://bank-http.example.invalid"})
		if err != nil {
			t.Fatal(err)
		}
		return server.NewWithAuthentication(config.Config{}, graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{Banking: enrollment, BankingStorage: f.storage}}), slog.New(slog.NewJSONHandler(&f.logs, nil)), f.verifier).Handler()
	}
	h := handler(true)
	token := f.token(f.owner)
	enroll := func(ownerToken string) string {
		t.Helper()
		attempt := uuid.New()
		f.operation(h, bankingHTTPStart(attempt, "DIFFERENT"), ownerToken, "startBankingEnrollment", true)
		result := f.operation(h, bankingHTTPFinish(attempt, "selected-checking"), ownerToken, "finishBankingEnrollment", false)
		if result["code"] != "AWAITING_INITIAL_IMPORT" {
			t.Fatal("inventory enrollment fixture", result["code"])
		}
		return result["connectionId"].(string)
	}
	ids := []string{enroll(token), enroll(token), enroll(token)}
	sort.Strings(ids)
	other := f.token(f.other)
	otherID := enroll(other)
	f.exec(`UPDATE app.banking_bindings SET import_state='usable',last_local_commit='2026-10-21T12:00:00Z' WHERE connection_id=$1`, ids[0])
	stopped := f.operation(h, fmt.Sprintf(`mutation{disconnectBanking(input:{attemptId:%q,connectionId:%q,expectedGeneration:"1"}){code}}`, uuid.NewString(), ids[0]), token, "disconnectBanking", false)
	if stopped["code"] != "READY" {
		t.Fatal("stop fixture", stopped["code"])
	}
	preparations, exchanges := f.provider.counts()
	// A newly constructed handler with new enrollment disabled has no browser
	// remembered ID, and must still discover previously retained connections.
	fresh := handler(false)
	first := f.operation(fresh, bankingConnectionsQuery("(first:1)"), token, "bankingConnections", false)
	if first["code"] != "READY" || first["hasNextPage"] != true || first["endCursor"] == nil {
		t.Fatal("bounded first page")
	}
	rows := first["connections"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["id"] != ids[0] {
		t.Fatal("first connection order/scope")
	}
	known := f.operation(fresh, fmt.Sprintf(`query{bankingConnection(connectionId:%q)%s}`, ids[0], bankingImportSelection), token, "bankingConnection", false)
	if !reflect.DeepEqual(rows[0], known["connection"]) {
		t.Fatal("inventory introduced competing status projection")
	}
	status := rows[0].(map[string]any)["accounts"].([]any)[0].(map[string]any)["importStatus"].(map[string]any)
	requireStatusFields(t, status, map[string]any{"operation": "STOPPED", "collection": "DISCONNECTED", "usable": true, "freshness": "STALE", "coverage": "KNOWN_GAP"})
	// A deletion after page one must disappear from page two. The cursor is
	// only an ordering position; it cannot freeze or restore deleted authority.
	deleted := f.operation(h, fmt.Sprintf(`mutation{deleteBankingHistory(input:{attemptId:%q,connectionId:%q,expectedGeneration:"1"}){code}}`, uuid.NewString(), ids[1]), token, "deleteBankingHistory", false)
	if deleted["code"] != "READY" {
		t.Fatal("delete fixture", deleted["code"])
	}
	continuation := fmt.Sprintf("(first:1,after:%q)", first["endCursor"])
	second := f.operation(fresh, bankingConnectionsQuery(continuation), token, "bankingConnections", false)
	rows = second["connections"].([]any)
	if second["code"] != "READY" || second["hasNextPage"] != false || len(rows) != 1 || rows[0].(map[string]any)["id"] != ids[2] {
		t.Fatal("continuation leaked deleted or other-owner connection")
	}
	empty := f.operation(fresh, bankingConnectionsQuery(fmt.Sprintf("(after:%q)", second["endCursor"])), token, "bankingConnections", false)
	requireEmptyBankingInventory(t, empty, "READY")
	ownOther := f.operation(fresh, bankingConnectionsQuery(""), other, "bankingConnections", false)
	otherRows := ownOther["connections"].([]any)
	if len(otherRows) != 1 || otherRows[0].(map[string]any)["id"] != otherID {
		t.Fatal("shared group membership disclosed private inventory")
	}
	if p, e := f.provider.counts(); p != preparations || e != exchanges {
		t.Fatal("inventory read performed provider I/O")
	}
	f.exec(`UPDATE app.users SET enabled=false WHERE id=$1`, f.owner)
	denied := f.operation(fresh, bankingConnectionsQuery(continuation), token, "bankingConnections", false)
	requireEmptyBankingInventory(t, denied, "FORBIDDEN")
}

func requireEmptyBankingInventory(t *testing.T, result map[string]any, code string) {
	t.Helper()
	if result["code"] != code || len(result["connections"].([]any)) != 0 || result["endCursor"] != nil || result["hasNextPage"] != false {
		t.Fatalf("expected empty %s inventory, got %v", code, result)
	}
}

func TestBankingHTTPConnectionsDenialValidationAndFailure(t *testing.T) {
	f := newBankingHTTPFixture(t)
	h := f.handler(true)
	token := f.token(f.owner)
	requireEmptyBankingInventory(t, f.operation(h, bankingConnectionsQuery(""), token, "bankingConnections", false), "READY")
	for _, args := range []string{"(first:0)", "(first:-1)", "(first:51)", `(after:"")`, `(after:"not-a-cursor")`} {
		requireEmptyBankingInventory(t, f.operation(h, bankingConnectionsQuery(args), token, "bankingConnections", false), "INVALID_INPUT")
	}
	requireEmptyBankingInventory(t, f.operation(h, bankingConnectionsQuery(""), f.token(f.disabled), "bankingConnections", false), "FORBIDDEN")
	if f.post(h, bankingConnectionsQuery(""), "", false)["errors"] == nil {
		t.Fatal("unauthenticated inventory reached storage")
	}
	attempt := uuid.New()
	f.operation(h, bankingHTTPStart(attempt, "DIFFERENT"), token, "startBankingEnrollment", true)
	f.operation(h, bankingHTTPFinish(attempt, "selected-checking"), token, "finishBankingEnrollment", false)
	f.exec(`REVOKE EXECUTE ON FUNCTION app.banking_connection_status(uuid) FROM kami_api`)
	defer f.exec(`GRANT EXECUTE ON FUNCTION app.banking_connection_status(uuid) TO kami_api`)
	failed := f.operation(h, bankingConnectionsQuery(""), token, "bankingConnections", false)
	requireEmptyBankingInventory(t, failed, "UNAVAILABLE")
	logs := f.logs.String()
	if strings.Count(logs, `"operation":"banking.storage"`) != 1 || strings.Contains(logs, "permission denied") || strings.Contains(logs, "banking_connection_status") {
		t.Fatal("inventory error diagnostics duplicated or leaked storage cause")
	}
}
