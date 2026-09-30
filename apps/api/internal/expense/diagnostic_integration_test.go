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
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/haggaikaunda/kami-split/apps/api/internal/server"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestIndependentGraphQLDiagnosticFailures(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	runtime := os.Getenv("TEST_DATABASE_URL")
	if runtime == "" {
		t.Fatal("run make db-test")
	}
	id := func(n int) string { return fmt.Sprintf("11800000-0000-4000-8000-%012d", n) }
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	encode := func(v []byte) string { return base64.RawURLEncoding.EncodeToString(v) }
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []any{map[string]any{"kty": "EC", "crv": "P-256", "kid": "expense-test", "alg": "ES256", "use": "sig", "x": encode(key.X.FillBytes(make([]byte, 32))), "y": encode(key.Y.FillBytes(make([]byte, 32)))}}})
	}))
	defer jwks.Close()
	verifier, err := auth.New(auth.Config{Issuer: jwks.URL, Audience: "authenticated", JWKSURL: jwks.URL})
	if err != nil {
		t.Fatal(err)
	}
	if err = verifier.Warm(ctx); err != nil {
		t.Fatal(err)
	}
	codec, e := ledger.NewCursorCodec("test", map[string][]byte{"test": bytes.Repeat([]byte{1}, 32)})
	if e != nil {
		t.Fatal(e)
	}
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
	input := ledger.Input{GroupID: ledger.PublicID("Group", id(201)), Key: uuid.NewString(), PayerID: ledger.PublicID("Membership", id(301))}
	failedDB, err := database.Open(ctx, database.Config{URL: runtime, MaxConns: 1, Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	failedDB.Close()
	var logs bytes.Buffer
	failedServer := server.NewWithAuthentication(config.Config{}, graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{Expenses: &expense.Service{DB: failedDB}, Cursors: codec}}), slog.New(slog.NewJSONHandler(&logs, nil)), verifier)
	for _, tc := range []struct{ query, want string }{
		{`{ viewer { __typename ... on Problem { code } } }`, `"code":"UNAVAILABLE"`},
		{fmt.Sprintf(`{ expenseOperation(groupId: %q, key: %q) { __typename ... on OperationProgress { key state } } }`, input.GroupID, input.Key), `"state":"UNKNOWN"`},
		{fmt.Sprintf(`mutation { createExpense(input: {groupId: %q, key: %q, totalMinor: "1000", currency: USD, description: "Diagnostic", effectiveDate: "2026-09-29", category: DINING, payerId: %q, participantIds: [%q], split: EQUAL}) { __typename ... on OperationProgress { key state } } }`, input.GroupID, input.Key, input.PayerID, input.PayerID), `"state":"UNKNOWN"`},
	} {
		logs.Reset()
		payload, _ := json.Marshal(map[string]string{"query": tc.query})
		req := httptest.NewRequest("POST", "/graphql", bytes.NewReader(payload))
		bearer := token(1)
		req.Header.Set("Authorization", "Bearer "+bearer)
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		failedServer.Handler().ServeHTTP(response, req)
		if !strings.Contains(response.Body.String(), tc.want) {
			t.Fatalf("unexpected response: %s", response.Body)
		}
		if strings.Count(logs.String(), "graphql execution failed") != 1 || !strings.Contains(logs.String(), response.Header().Get("X-Request-ID")) || !strings.Contains(logs.String(), "expense.transaction") {
			t.Fatalf("missing/duplicate safe event: %s", logs.String())
		}
		for _, private := range []string{bearer, runtime, input.GroupID, input.Key, "closed pool", "SELECT"} {
			if strings.Contains(logs.String(), private) {
				t.Fatalf("private data in log: %s", logs.String())
			}
		}
		if strings.Contains(response.Body.String(), "closed pool") {
			t.Fatal("raw cause in response")
		}
	}
}
