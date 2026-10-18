package banking

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
)

type keyRecoveryFixture struct {
	*webhookFixture
	fetches            map[string]int
	negativeRetryAfter string
}

func newKeyRecoveryFixture(t *testing.T) *keyRecoveryFixture {
	t.Helper()
	f := &keyRecoveryFixture{webhookFixture: newWebhookFixture(t), fetches: make(map[string]int)}
	f.verifier.provider = testPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
		var input struct {
			ID string `json:"key_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			return nil, err
		}
		f.fetches[input.ID]++
		if strings.HasPrefix(input.ID, "unknown-") {
			response := plaidTestResponse(400, `{"error_code":"INVALID_FIELD"}`)
			response.Header.Set("Retry-After", f.negativeRetryAfter)
			return response, nil
		}
		key := maps.Clone(f.key)
		key["kid"] = input.ID
		raw, _ := json.Marshal(map[string]any{"key": key})
		return plaidTestResponse(200, string(raw)), nil
	}))
	return f
}
func (f *keyRecoveryFixture) verifyID(t *testing.T, id string) error {
	t.Helper()
	body := webhookBody("sandbox", "known-item")
	_, err := f.verifier.Verify(context.Background(), f.sign(t, body, f.now, func(token *jwt.Token) { token.Header["kid"] = id }), body)
	return err
}
func TestUnknownKeysCannotBlockColdExpiredOrRotatedKeys(t *testing.T) {
	for _, mode := range []string{"cold", "expired", "rotated"} {
		t.Run(mode, func(t *testing.T) {
			f := newKeyRecoveryFixture(t)
			if mode != "cold" {
				if err := f.verifyID(t, "key-1"); err != nil {
					t.Fatal(err)
				}
			}
			for round := 0; round < 3; round++ {
				valid := fmt.Sprintf("valid-%d", round)
				if mode == "expired" {
					valid = "key-1"
					f.now = f.now.Add(time.Hour + time.Second)
				}
				if mode == "rotated" {
					private, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
					if err != nil {
						t.Fatal(err)
					}
					f.private = private
					f.key["x"] = base64.RawURLEncoding.EncodeToString(private.X.FillBytes(make([]byte, 32)))
					f.key["y"] = base64.RawURLEncoding.EncodeToString(private.Y.FillBytes(make([]byte, 32)))
				}
				unknown := fmt.Sprintf("unknown-%d", round)
				for range 3 {
					if err := f.verifyID(t, unknown); !errors.Is(err, ErrWebhookMismatch) {
						t.Fatal("unknown key not rejected", err)
					}
				}
				if f.fetches[unknown] != 1 {
					t.Fatal("repeated negative lookup was not cached")
				}
				if err := f.verifyID(t, valid); err != nil {
					t.Fatal("unsigned unknown key blocked legitimate refresh", err)
				}
				f.now = f.now.Add(61 * time.Second)
			}
		})
	}
}
func TestNegativeKeyCacheBoundsConcurrencyAndScopedRetryGuidance(t *testing.T) {
	f := newKeyRecoveryFixture(t)
	f.negativeRetryAfter = "180"
	for n := range 24 {
		f.now = f.now.Add(time.Second)
		if err := f.verifyID(t, fmt.Sprintf("unknown-%d", n)); !errors.Is(err, ErrWebhookMismatch) {
			t.Fatal(err)
		}
		if len(f.verifier.rejected) > 16 {
			t.Fatal("negative cache grew beyond its bound")
		}
	}
	body := webhookBody("sandbox", "known-item")
	signed := f.sign(t, body, f.now, func(token *jwt.Token) { token.Header["kid"] = "unknown-23" })
	outcomes := make(chan error, 24)
	for range 24 {
		go func() { _, err := f.verifier.Verify(context.Background(), signed, body); outcomes <- err }()
	}
	for range 24 {
		if err := <-outcomes; !errors.Is(err, ErrWebhookMismatch) {
			t.Fatal(err)
		}
	}
	if f.fetches["unknown-23"] != 1 {
		t.Fatal("concurrent negative lookups reached provider")
	}
	if err := f.verifyID(t, "unrelated-valid"); err != nil {
		t.Fatal("negative Retry-After blocked unrelated key", err)
	}
	f.now = f.now.Add(179 * time.Second)
	if err := f.verifyID(t, "unknown-23"); !errors.Is(err, ErrWebhookMismatch) || f.fetches["unknown-23"] != 1 {
		t.Fatal("negative Retry-After minimum ignored")
	}
	f.now = f.now.Add(time.Second)
	if err := f.verifyID(t, "unknown-23"); !errors.Is(err, ErrWebhookMismatch) || f.fetches["unknown-23"] != 2 {
		t.Fatal("negative lookup did not recover at expiry")
	}
}
func TestProviderWideKeyCooldownRespectsMinimumAndKeepsCachedKeys(t *testing.T) {
	f := newWebhookFixture(t)
	status, calls := 200, 0
	f.verifier.provider = testPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		var input struct {
			ID string `json:"key_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			return nil, err
		}
		key := maps.Clone(f.key)
		key["kid"] = input.ID
		raw, _ := json.Marshal(map[string]any{"key": key})
		response := plaidTestResponse(status, string(raw))
		response.Header.Set("Retry-After", "180")
		return response, nil
	}))
	body := webhookBody("sandbox", "known-item")
	verify := func(id string) error {
		_, err := f.verifier.Verify(context.Background(), f.sign(t, body, f.now, func(token *jwt.Token) { token.Header["kid"] = id }), body)
		return err
	}
	if err := verify("key-1"); err != nil {
		t.Fatal(err)
	}
	status = 429
	if err := verify("next-key"); err == nil || errors.Is(err, ErrWebhookMismatch) {
		t.Fatal("rate failure not retryable", err)
	}
	if err := verify("key-1"); err != nil {
		t.Fatal("rate cooldown blocked trusted cached key", err)
	}
	status = 200
	f.now = f.now.Add(179 * time.Second)
	if err := verify("next-key"); err == nil || calls != 2 {
		t.Fatal("provider-wide Retry-After ignored", err, calls)
	}
	f.now = f.now.Add(time.Second)
	if err := verify("next-key"); err != nil || calls != 3 {
		t.Fatal("provider key recovery failed", err, calls)
	}
}
func TestWebhookTransportReportsOnlyUnexpectedVerificationFailures(t *testing.T) {
	for _, tc := range []struct {
		name             string
		status           int
		transportFailure bool
	}{
		{name: "transport", transportFailure: true}, {name: "credentials401", status: 401}, {name: "credentials403", status: 403},
		{name: "rate", status: 429}, {name: "server500", status: 500}, {name: "server503", status: 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newWebhookFixture(t)
			f.verifier.provider = testPlaid(t, bankingRoundTrip(func(*http.Request) (*http.Response, error) {
				if tc.transportFailure {
					return nil, errors.New("private provider transport, kid and secret")
				}
				return plaidTestResponse(tc.status, `{"private":"provider body"}`), nil
			}))
			acceptor := &recordingWebhookAcceptor{expected: uuid.New(), durable: make(map[[32]byte]bool)}
			handler, _ := NewWebhookHandler(f.verifier, acceptor)
			body := webhookBody("sandbox", "known-item")
			for range 2 {
				var operations []string
				request := httptest.NewRequest(http.MethodPost, "/banking/webhooks/"+acceptor.expected.String(), bytes.NewReader(body))
				request.Header.Set("Plaid-Verification", f.sign(t, body, f.now, nil))
				request = request.WithContext(diagnostic.WithReporter(request.Context(), func(operation string) { operations = append(operations, operation) }))
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, request)
				if response.Code != 503 || acceptor.calls != 0 || len(operations) != 1 || operations[0] != "banking.webhook_verify" {
					t.Fatal("missing exactly one static verifier diagnostic", response.Code, operations)
				}
				if strings.Contains(response.Body.String()+strings.Join(operations, ""), "private") {
					t.Fatal("verification failure disclosed private data")
				}
			}
		})
	}
}
func TestExpectedWebhookFailuresStayQuiet(t *testing.T) {
	for _, mode := range []string{"unknown", "forged", "tampered", "stale"} {
		t.Run(mode, func(t *testing.T) {
			f := newWebhookFixture(t)
			body := webhookBody("sandbox", "known-item")
			if mode == "unknown" {
				f.status = 400
			}
			if mode == "forged" {
				private, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
				if err != nil {
					t.Fatal(err)
				}
				f.private = private
			}
			issued := f.now
			if mode == "stale" {
				issued = issued.Add(-6 * time.Minute)
			}
			signed := f.sign(t, body, issued, nil)
			if mode == "tampered" {
				body = append(body, ' ')
			}
			acceptor := &recordingWebhookAcceptor{expected: uuid.New(), durable: make(map[[32]byte]bool)}
			handler, _ := NewWebhookHandler(f.verifier, acceptor)
			diagnostics := 0
			request := httptest.NewRequest(http.MethodPost, "/banking/webhooks/"+acceptor.expected.String(), bytes.NewReader(body))
			request.Header.Set("Plaid-Verification", signed)
			request = request.WithContext(diagnostic.WithReporter(request.Context(), func(string) { diagnostics++ }))
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != 400 || diagnostics != 0 || acceptor.calls != 0 {
				t.Fatal("expected rejection logged or accepted", response.Code, diagnostics)
			}
		})
	}
}

type reportingWebhookAcceptor struct{}

func (reportingWebhookAcceptor) AcceptWebhook(ctx context.Context, _ uuid.UUID, _ VerifiedWebhook) error {
	failure := diagnostic.Wrap(errors.New("banking ingress unavailable"), errors.New("private storage failure"), "banking.webhook_accept")
	diagnostic.Report(ctx, failure)
	return failure
}
func TestWebhookTransportDoesNotRepeatAcceptorDiagnostic(t *testing.T) {
	f := newWebhookFixture(t)
	handler, _ := NewWebhookHandler(f.verifier, reportingWebhookAcceptor{})
	body := webhookBody("sandbox", "known-item")
	request := httptest.NewRequest(http.MethodPost, "/banking/webhooks/"+uuid.NewString(), bytes.NewReader(body))
	request.Header.Set("Plaid-Verification", f.sign(t, body, f.now, nil))
	var operations []string
	request = request.WithContext(diagnostic.WithReporter(request.Context(), func(operation string) { operations = append(operations, operation) }))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != 503 || len(operations) != 1 || operations[0] != "banking.webhook_accept" {
		t.Fatal("acceptor failure reported twice", response.Code, operations)
	}
}
