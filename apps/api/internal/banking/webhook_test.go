package banking

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type webhookFixture struct {
	now      time.Time
	private  *ecdsa.PrivateKey
	verifier *WebhookVerifier
	calls    int
	key      map[string]any
	status   int
}

func newWebhookFixture(t *testing.T) *webhookFixture {
	t.Helper()
	private, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	f := &webhookFixture{private: private, now: time.Date(2026, 10, 18, 0, 0, 0, 0, time.UTC), status: 200}
	f.key = map[string]any{"alg": "ES256", "crv": "P-256", "kid": "key-1", "kty": "EC", "use": "sig", "x": base64.RawURLEncoding.EncodeToString(private.X.FillBytes(make([]byte, 32))), "y": base64.RawURLEncoding.EncodeToString(private.Y.FillBytes(make([]byte, 32))), "created_at": f.now.Add(-time.Hour).Unix(), "expired_at": nil}
	provider := testPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
		f.calls++
		if r.URL.Path != "/webhook_verification_key/get" || r.Header.Get("PLAID-SECRET") != "secret-private" {
			t.Error("unprotected verification key request")
		}
		var request map[string]string
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request["key_id"] == "" || len(request) != 1 {
			t.Error("invalid verification key request")
		}
		raw, _ := json.Marshal(map[string]any{"key": f.key})
		return plaidTestResponse(f.status, string(raw)), nil
	}))
	f.verifier, err = NewWebhookVerifier(provider, func() time.Time { return f.now })
	if err != nil {
		t.Fatal(err)
	}
	return f
}
func webhookBody(environment, item string) []byte {
	raw, _ := json.Marshal(map[string]any{"environment": environment, "item_id": item, "webhook_type": "ITEM", "webhook_code": "USER_PERMISSION_REVOKED", "private_financial_payload": "never retain"})
	return raw
}
func (f *webhookFixture) sign(t *testing.T, body []byte, issued time.Time, mutate func(*jwt.Token)) string {
	t.Helper()
	hash := sha256.Sum256(body)
	token := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{"iat": issued.Unix(), "request_body_sha256": hex.EncodeToString(hash[:])})
	token.Header["kid"] = "key-1"
	if mutate != nil {
		mutate(token)
	}
	var key any = f.private
	if token.Method == jwt.SigningMethodHS256 {
		key = []byte("fake")
	}
	signed, err := token.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return signed
}
func TestWebhookAuthenticatesExactBodyAndTime(t *testing.T) {
	for _, tc := range []struct {
		name              string
		delta             time.Duration
		environment, item string
		alterBody         bool
		mutate            func(*jwt.Token)
		valid             bool
	}{
		{name: "valid", environment: "sandbox", item: "known-item", valid: true},
		{name: "oldest valid", delta: -5 * time.Minute, environment: "sandbox", item: "known-item", valid: true},
		{name: "stale", delta: -5*time.Minute - time.Second, environment: "sandbox", item: "known-item"},
		{name: "future", delta: time.Second, environment: "sandbox", item: "known-item"},
		{name: "tampered whitespace", environment: "sandbox", item: "known-item", alterBody: true},
		{name: "wrong environment", environment: "production", item: "known-item"},
		{name: "missing environment", item: "known-item"},
		{name: "missing item", environment: "sandbox"},
		{name: "unexpected algorithm", environment: "sandbox", item: "known-item", mutate: func(token *jwt.Token) { token.Method = jwt.SigningMethodHS256 }},
		{name: "missing kid", environment: "sandbox", item: "known-item", mutate: func(token *jwt.Token) { delete(token.Header, "kid") }},
		{name: "nonstring kid", environment: "sandbox", item: "known-item", mutate: func(token *jwt.Token) { token.Header["kid"] = 1 }},
		{name: "missing iat", environment: "sandbox", item: "known-item", mutate: func(token *jwt.Token) { delete(token.Claims.(jwt.MapClaims), "iat") }},
		{name: "invalid hash", environment: "sandbox", item: "known-item", mutate: func(token *jwt.Token) { token.Claims.(jwt.MapClaims)["request_body_sha256"] = "bogus" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newWebhookFixture(t)
			body := webhookBody(tc.environment, tc.item)
			signed := f.sign(t, body, f.now.Add(tc.delta), tc.mutate)
			if tc.alterBody {
				body = append(body, ' ')
			}
			event, err := f.verifier.Verify(context.Background(), signed, body)
			if tc.valid {
				if err != nil || event.Environment != "sandbox" || event.ItemID != "known-item" || event.WebhookCode != "USER_PERMISSION_REVOKED" || event.BodySHA256 != sha256.Sum256(body) {
					t.Fatalf("valid event failed: %+v %v", event, err)
				}
			} else if !errors.Is(err, ErrWebhookMismatch) {
				t.Fatalf("invalid event accepted/classified incorrectly: %+v %v", event, err)
			}
		})
	}
	f := newWebhookFixture(t)
	body := webhookBody("sandbox", "known-item")
	signed := f.sign(t, body, f.now, nil)
	other, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	f.private = other
	if _, err = f.verifier.Verify(context.Background(), f.sign(t, body, f.now, nil), body); !errors.Is(err, ErrWebhookMismatch) {
		t.Error("forged signature accepted")
	}
	if _, err = f.verifier.Verify(context.Background(), signed, body); err != nil {
		t.Error("forged signature poisoned key cache")
	}
}
func TestWebhookKeyConstraintsAndExpiration(t *testing.T) {
	for _, tc := range []struct {
		name, field string
		value       any
	}{
		{"algorithm", "alg", "RS256"}, {"curve", "crv", "P-384"}, {"ID", "kid", "different"}, {"type", "kty", "RSA"}, {"use", "use", "enc"}, {"x", "x", "invalid"}, {"y", "y", "invalid"}, {"expired", "expired_at", int64(1)}, {"future created", "created_at", int64(9999999999)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newWebhookFixture(t)
			f.key[tc.field] = tc.value
			body := webhookBody("sandbox", "item")
			if _, err := f.verifier.Verify(context.Background(), f.sign(t, body, f.now, nil), body); !errors.Is(err, ErrWebhookMismatch) {
				t.Fatalf("untrusted key accepted: %v", err)
			}
		})
	}
	for _, expiry := range []bool{false, true} {
		t.Run(map[bool]string{false: "TTL", true: "explicit expiry"}[expiry], func(t *testing.T) {
			f := newWebhookFixture(t)
			body := webhookBody("sandbox", "item")
			if expiry {
				f.key["expired_at"] = f.now.Add(time.Minute).Unix()
			}
			signed := f.sign(t, body, f.now, nil)
			for range 2 {
				if _, err := f.verifier.Verify(context.Background(), signed, body); err != nil {
					t.Fatal(err)
				}
			}
			if f.calls != 1 {
				t.Fatal("cache did not reuse verified key")
			}
			if expiry {
				f.now = f.now.Add(time.Minute)
			} else {
				f.now = f.now.Add(time.Hour)
			}
			_, err := f.verifier.Verify(context.Background(), f.sign(t, body, f.now, nil), body)
			if f.calls != 2 {
				t.Error("expired key was reused")
			}
			if expiry && !errors.Is(err, ErrWebhookMismatch) {
				t.Error("provider-expired key accepted")
			}
			if !expiry && err != nil {
				t.Error("TTL refresh failed")
			}
		})
	}
}
func TestWebhookCacheBoundAndProviderBackoff(t *testing.T) {
	f := newWebhookFixture(t)
	body := webhookBody("sandbox", "item")
	for i := range 20 {
		kid := uuid.NewString()
		f.key["kid"] = kid
		signed := f.sign(t, body, f.now, func(token *jwt.Token) { token.Header["kid"] = kid })
		if _, err := f.verifier.Verify(context.Background(), signed, body); err != nil {
			t.Fatal(err)
		}
		if len(f.verifier.keys) > 16 {
			t.Fatal("unbounded key cache")
		}
		f.now = f.now.Add(time.Duration(i+1) * time.Second)
	}
	f = newWebhookFixture(t)
	f.status = 429
	signed := f.sign(t, body, f.now, nil)
	for range 2 {
		if _, err := f.verifier.Verify(context.Background(), signed, body); err == nil || errors.Is(err, ErrWebhookMismatch) {
			t.Error("provider failure not retryable")
		}
	}
	if f.calls != 1 {
		t.Error("ignored key-fetch backoff")
	}
	f.now = f.now.Add(time.Minute)
	f.status = 200
	if _, err := f.verifier.Verify(context.Background(), f.sign(t, body, f.now, nil), body); err != nil || f.calls != 2 {
		t.Error("key fetch did not recover")
	}
	f.verifier.keyLock <- struct{}{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := f.verifier.Verify(ctx, signed, body); err == nil {
		t.Error("cache wait ignored cancellation")
	}
	<-f.verifier.keyLock
}

type recordingWebhookAcceptor struct {
	expected uuid.UUID
	calls    int
	durable  map[[32]byte]bool
	failure  error
}

func (a *recordingWebhookAcceptor) AcceptWebhook(ctx context.Context, id uuid.UUID, event VerifiedWebhook) error {
	a.calls++
	if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > 8*time.Second {
		return errors.New("unbounded ingress persistence")
	}
	if id != a.expected || event.ItemID != "known-item" || event.Environment != "sandbox" {
		return ErrWebhookMismatch
	}
	if a.failure != nil {
		return a.failure
	}
	a.durable[event.BodySHA256] = true
	return nil
}
func TestWebhookIngressDurableAcceptanceOnly(t *testing.T) {
	f := newWebhookFixture(t)
	correlation := uuid.New()
	acceptor := &recordingWebhookAcceptor{expected: correlation, durable: make(map[[32]byte]bool)}
	handler, err := NewWebhookHandler(f.verifier, acceptor)
	if err != nil {
		t.Fatal(err)
	}
	body := webhookBody("sandbox", "known-item")
	send := func(path string, body []byte, signed string) int {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
		request.Header.Set("Plaid-Verification", signed)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if strings.Contains(recorder.Body.String(), "private") {
			t.Error("private error details leaked")
		}
		return recorder.Code
	}
	path := "/banking/webhooks/" + correlation.String()
	signed := f.sign(t, body, f.now, nil)
	for range 2 {
		if code := send(path, body, signed); code != 204 {
			t.Fatalf("valid/duplicate status %d", code)
		}
	}
	if len(acceptor.durable) != 1 {
		t.Error("duplicate created another receipt")
	}
	acceptor.failure = errors.New("private storage details")
	if code := send(path, body, signed); code != 503 {
		t.Error("acknowledged persistence failure")
	}
	acceptor.failure = nil
	for _, invalidPath := range []string{"/banking/webhooks/" + uuid.NewString(), "/banking/webhooks/bad", "/banking/webhooks/" + uuid.Nil.String(), "/unrelated/" + correlation.String(), path + "/extra"} {
		if code := send(invalidPath, body, signed); code != 400 {
			t.Errorf("correlation mismatch accepted: %d", code)
		}
	}
	mismatch := webhookBody("sandbox", "another-item")
	if code := send(path, mismatch, f.sign(t, mismatch, f.now, nil)); code != 400 {
		t.Error("Item mismatch accepted")
	}
	calls := acceptor.calls
	for _, invalid := range []struct {
		body   []byte
		signed string
	}{
		{body, ""}, {append(append([]byte(nil), body...), ' '), signed}, {webhookBody("production", "known-item"), f.sign(t, webhookBody("production", "known-item"), f.now, nil)}, {bytes.Repeat([]byte("x"), 64*1024+1), signed}, {body, f.sign(t, body, f.now.Add(-6*time.Minute), nil)},
	} {
		if code := send(path, invalid.body, invalid.signed); code != 400 {
			t.Errorf("invalid delivery status %d", code)
		}
	}
	if acceptor.calls != calls {
		t.Error("unverified body reached durable boundary")
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
	if recorder.Code != 405 {
		t.Error("accepted non-POST webhook")
	}
	for digest := range acceptor.durable {
		if digest != sha256.Sum256(body) {
			t.Error("unexpected durable receipt")
		}
	}
}
func TestWebhookIngressKeyInfrastructureFailure(t *testing.T) {
	f := newWebhookFixture(t)
	f.status = 503
	acceptor := &recordingWebhookAcceptor{expected: uuid.New(), durable: make(map[[32]byte]bool)}
	handler, err := NewWebhookHandler(f.verifier, acceptor)
	if err != nil {
		t.Fatal(err)
	}
	body := webhookBody("sandbox", "known-item")
	request := httptest.NewRequest(http.MethodPost, "/banking/webhooks/"+acceptor.expected.String(), bytes.NewReader(body))
	request.Header.Set("Plaid-Verification", f.sign(t, body, f.now, nil))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != 503 || acceptor.calls != 0 {
		t.Error("acknowledged unavailable key verification")
	}
}

func TestWebhookConcurrentVerificationReusesKey(t *testing.T) {
	f := newWebhookFixture(t)
	body := webhookBody("sandbox", "item")
	signed := f.sign(t, body, f.now, nil)
	outcomes := make(chan error, 24)
	for range 24 {
		go func() { _, err := f.verifier.Verify(context.Background(), signed, body); outcomes <- err }()
	}
	for range 24 {
		if err := <-outcomes; err != nil {
			t.Error(err)
		}
	}
	if f.calls != 1 {
		t.Fatalf("concurrent cache misses made %d provider calls", f.calls)
	}
}

func TestWebhookProviderAuthFailureStaysRetryable(t *testing.T) {
	for _, status := range []int{401, 403, 429, 500} {
		f := newWebhookFixture(t)
		f.status = status
		body := webhookBody("sandbox", "item")
		_, err := f.verifier.Verify(context.Background(), f.sign(t, body, f.now, nil), body)
		if err == nil || errors.Is(err, ErrWebhookMismatch) {
			t.Errorf("provider infrastructure status %d treated as invalid delivery", status)
		}
	}
}
