package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/banking"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
)

type ingressAcceptor struct{ calls int }

func (a *ingressAcceptor) AcceptWebhook(context.Context, uuid.UUID, banking.VerifiedWebhook) error {
	a.calls++
	return nil
}

func TestBankingIngressRoutesOnlyExplicitVerifierPath(t *testing.T) {
	provider, err := banking.NewPlaidProvider(banking.PlaidConfig{Environment: "sandbox", ClientID: "synthetic", Secret: "synthetic"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	verifier, err := banking.NewWebhookVerifier(provider, nil)
	if err != nil {
		t.Fatal(err)
	}
	acceptor := new(ingressAcceptor)
	handler, err := banking.NewWebhookHandler(verifier, acceptor)
	if err != nil {
		t.Fatal(err)
	}
	var logs strings.Builder
	mounted := bankingIngress(handler, slog.New(slog.NewTextHandler(&logs, nil)))(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusAccepted) }))
	for _, tc := range []struct {
		method, path string
		expected     int
	}{
		{http.MethodGet, "/health", http.StatusAccepted},
		{http.MethodPost, "/graphql", http.StatusAccepted},
		{http.MethodPost, "/banking/webhooks-other", http.StatusAccepted},
		{http.MethodGet, "/banking/webhooks/" + uuid.NewString(), http.StatusMethodNotAllowed},
		{http.MethodPost, "/banking/webhooks/not-a-uuid", http.StatusBadRequest},
		{http.MethodPost, "/banking/webhooks/" + uuid.NewString(), http.StatusBadRequest},
	} {
		response := httptest.NewRecorder()
		mounted.ServeHTTP(response, httptest.NewRequest(tc.method, tc.path, strings.NewReader(`{"item_id":"forged"}`)))
		if response.Code != tc.expected {
			t.Fatalf("%s %s = %d; want %d", tc.method, tc.path, response.Code, tc.expected)
		}
	}
	if acceptor.calls != 0 {
		t.Fatal("unverified webhook reached durable acceptor")
	}
	if logs.Len() != 0 {
		t.Fatal("invalid ingress generated unexpected failure diagnostics")
	}
}

func TestBankingIngressOwnsOneSafeDiagnostic(t *testing.T) {
	var logs strings.Builder
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		failure := diagnostic.Wrap(errors.New("safe outcome"), errors.New("private-driver-password"), "banking.webhook_accept")
		diagnostic.Report(r.Context(), failure)
		diagnostic.Report(r.Context(), failure)
		http.Error(w, "webhook unavailable", http.StatusServiceUnavailable)
	})
	mounted := bankingIngress(inner, slog.New(slog.NewJSONHandler(&logs, nil)))(http.NotFoundHandler())
	request := httptest.NewRequest(http.MethodPost, "/banking/webhooks/private-correlation", strings.NewReader("private-body"))
	request.Header.Set("Plaid-Verification", "private-signature")
	response := httptest.NewRecorder()
	mounted.ServeHTTP(response, request)
	lines := strings.Split(strings.TrimSpace(logs.String()), "\n")
	if len(lines) != 1 {
		t.Fatalf("got %d diagnostic events", len(lines))
	}
	var event map[string]any
	if json.Unmarshal([]byte(lines[0]), &event) != nil || event["operation"] != "banking.webhook_accept" || event["msg"] != "banking ingress unavailable" || len(event) != 4 {
		t.Fatal("missing safe static diagnostic")
	}
	if strings.Contains(response.Body.String()+logs.String(), "private-") {
		t.Fatal("ingress exposed private request or failure data")
	}
}
