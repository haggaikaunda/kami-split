//go:build integration

package graph_test

import (
	"context"
	"fmt"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/banking"
	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
	"github.com/haggaikaunda/kami-split/apps/api/internal/server"
)

type institutionProvider struct{ *bankingHTTPProvider }

func (p institutionProvider) Accounts(ctx context.Context, env string, token banking.Credential) (banking.AccountInventory, error) {
	inventory, err := p.bankingHTTPProvider.Accounts(ctx, env, token)
	inventory.InstitutionName = "Example Community Credit Union with a long institution name"
	return inventory, err
}
func TestBankingInstitutionNameFollowsOwnerAndDeletion(t *testing.T) {
	f := newBankingHTTPFixture(t)
	enrollment, err := banking.NewEnrollment(f.storage, institutionProvider{f.provider}, banking.EnrollmentConfig{Enabled: true, Environment: "sandbox", WebhookOrigin: "https://bank-http.example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	h := server.NewWithAuthentication(config.Config{}, graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{Banking: enrollment, BankingStorage: f.storage}}), slog.New(slog.NewJSONHandler(&f.logs, nil)), f.verifier).Handler()
	token := f.token(f.owner)
	attempt := uuid.New()
	f.operation(h, bankingHTTPStart(attempt, "DIFFERENT"), token, "startBankingEnrollment", true)
	enrolled := f.operation(h, bankingHTTPFinish(attempt, "selected-checking"), token, "finishBankingEnrollment", false)
	if enrolled["code"] != "AWAITING_INITIAL_IMPORT" {
		t.Fatal("enrollment failed", enrolled["code"])
	}
	id := enrolled["connectionId"].(string)
	query := fmt.Sprintf(`query{bankingConnection(connectionId:%q){code connection{id generation institutionName accounts{id}}}}`, id)
	own := f.operation(h, query, token, "bankingConnection", false)
	row := own["connection"].(map[string]any)
	if row["institutionName"] != "Example Community Credit Union with a long institution name" {
		t.Fatal("server-observed name was not retained")
	}
	other := f.operation(h, query, f.token(f.other), "bankingConnection", false)
	if other["code"] != "NOT_FOUND" || other["connection"] != nil {
		t.Fatal("foreign actor saw institution metadata")
	}
	deleted := f.operation(h, fmt.Sprintf(`mutation{deleteBankingHistory(input:{attemptId:%q,connectionId:%q,expectedGeneration:%q}){code}}`, uuid.NewString(), id, row["generation"]), token, "deleteBankingHistory", false)
	if deleted["code"] != "READY" {
		t.Fatal("delete did not commit", deleted["code"])
	}
	var savedName *string
	if err := f.admin.QueryRow(context.Background(), `SELECT institution_name FROM app.banking_connections WHERE id=$1`, id).Scan(&savedName); err != nil || savedName != nil {
		t.Fatal("deleted institution name was not erased", err)
	}
	current := f.operation(h, query, token, "bankingConnection", false)
	erased := current["connection"].(map[string]any)
	if erased["institutionName"] != nil || len(erased["accounts"].([]any)) != 0 {
		t.Fatal("deleted metadata remained visible")
	}
}
