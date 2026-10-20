//go:build integration

package graph_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/banking"
)

func TestBankingHTTPReplacementSelectionOmission(t *testing.T) {
	for _, subset := range []bool{false, true} {
		t.Run(fmt.Sprint(subset), func(t *testing.T) {
			s := independentReplacementHTTP(t)
			f := s.f
			var connection uuid.UUID
			var cg, bg int64
			observe := func() {
				t.Helper()
				if err := f.admin.QueryRow(context.Background(), `SELECT c.id,c.generation,b.generation FROM app.banking_bindings b JOIN app.banking_connections c ON c.id=b.connection_id WHERE b.id=$1`, s.binding).Scan(&connection, &cg, &bg); err != nil {
					t.Fatal(err)
				}
			}
			observe()
			ids := ""
			if subset {
				r := f.operation(s.handler, lifecycleHTTPSelection(uuid.New(), connection, cg, `"selected-checking","unselected-savings"`), s.owner, "changeBankingSelection", false)
				if r["code"] != "READY" {
					t.Fatal(r["code"])
				}
				observe()
				ids = `"unselected-savings"`
			}
			r := f.operation(s.handler, lifecycleHTTPSelection(uuid.New(), connection, cg, ids), s.owner, "changeBankingSelection", false)
			if r["code"] != "READY" {
				t.Fatal(r["code"])
			}
			observe()
			read := f.operation(s.handler, lifecycleHTTPRead(connection), s.owner, "bankingConnection", false)
			if read["code"] != "READY" {
				t.Fatal(read["code"])
			}
			found := false
			for _, raw := range read["connection"].(map[string]any)["accounts"].([]any) {
				account := raw.(map[string]any)
				if account["streamId"] == s.binding.String() {
					found = true
					if account["selected"] != false {
						t.Error("public read advertises omitted staged stream selected")
					}
				} else if subset && account["selected"] != true {
					t.Error("public read lost retained sibling selection")
				}
			}
			if !found {
				t.Fatal("public read hid retained staged stream")
			}
			// The source-write contract is internal to the future importer. Exercise it
			// with a verified owner and the post-HTTP generations, rather than stale CAS.
			var result banking.Result
			request := httptest.NewRequest(http.MethodPost, "/controlled-import", nil)
			request.Header.Set("Authorization", "Bearer "+s.owner)
			f.verifier.Protect(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				result = f.storage.RecordSource(r.Context(), banking.SourceInput{AttemptID: uuid.New(), BindingID: s.binding, ConnectionGeneration: cg, BindingGeneration: bg, ProviderTransactionID: uuid.NewString(), AmountMinor: "100", Currency: "USD", BankDate: "2026-10-02", ProcessingState: "posted", MappingVersion: "controlled-pfc-v2"})
			})).ServeHTTP(httptest.NewRecorder(), request)
			if result.Code != "CONFLICT" {
				t.Fatal("successful public omission retained collection", result.Code)
			}
			var selected bool
			if err := f.admin.QueryRow(context.Background(), `SELECT a.selected AND NOT b.collection_stopped FROM app.banking_bindings b JOIN app.banking_accounts a ON a.id=b.account_id WHERE b.id=$1`, s.original).Scan(&selected); err != nil {
				t.Fatal(err)
			}
			if !selected {
				t.Fatal("public omission stopped predecessor on another Item")
			}
		})
	}
}
