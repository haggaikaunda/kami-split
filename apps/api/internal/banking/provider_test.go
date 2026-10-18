package banking

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

type bankingRoundTrip func(*http.Request) (*http.Response, error)

func (f bankingRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func testPlaid(t *testing.T, transport http.RoundTripper) *PlaidProvider {
	t.Helper()
	p, err := NewPlaidProvider(PlaidConfig{Environment: "sandbox", ClientID: "client-private", Secret: "secret-private"}, &http.Client{Transport: transport})
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func plaidTestResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}
}
func TestPlaidRemovalKnownTargetOnly(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "POST" || r.URL.Path != "/item/remove" {
			t.Errorf("unexpected endpoint: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("PLAID-SECRET") != "secret-private" || r.Header.Get("PLAID-CLIENT-ID") != "client-private" || r.Header.Get("Plaid-Version") != "2020-09-14" {
			t.Error("missing protected provider headers")
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if len(body) != 1 || body["access_token"] != "known-item-token" {
			t.Error("removal not scoped to known credential")
		}
		_, _ = io.WriteString(w, `{"request_id":"confirmed"}`)
	}))
	defer server.Close()
	destination, _ := url.Parse(server.URL)
	p := testPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "sandbox.plaid.com" || r.URL.Scheme != "https" {
			t.Error("unexpected provider destination")
		}
		clone := r.Clone(r.Context())
		target := *r.URL
		target.Scheme = destination.Scheme
		target.Host = destination.Host
		clone.URL = &target
		return http.DefaultTransport.RoundTrip(clone)
	}))
	result, err := p.Remove(context.Background(), "sandbox", Credential{raw: []byte("known-item-token")})
	if err != nil || !result.Confirmed || calls != 1 {
		t.Fatalf("removal: %+v %v calls=%d", result, err, calls)
	}
	for _, env := range []string{"production", "unknown"} {
		result, err = p.Remove(context.Background(), env, Credential{raw: []byte("known-item-token")})
		if err == nil || result.Confirmed || calls != 1 {
			t.Error("wrong environment reached provider")
		}
	}
	result, err = p.Remove(context.Background(), "sandbox", Credential{})
	if err == nil || result.Confirmed || calls != 1 {
		t.Error("empty credential reached provider")
	}
}
func TestPlaidRemovalFailureAndUncertainty(t *testing.T) {
	for _, tc := range []struct {
		name             string
		status           int
		body             string
		failure          error
		uncertain, retry bool
	}{
		{name: "lost response after remote effect", failure: errors.New("known-item-token secret-private response loss"), uncertain: true, retry: true},
		{name: "timeout", failure: context.DeadlineExceeded, uncertain: true, retry: true},
		{name: "invalid token", status: 400, body: `{"error_code":"INVALID_ACCESS_TOKEN","error_message":"secret-private"}`},
		{name: "rate limited", status: 429, body: `{}`, retry: true},
		{name: "server error", status: 503, body: `{}`, uncertain: true, retry: true},
		{name: "server error cannot confirm missing Item", status: 503, body: `{"error_code":"ITEM_NOT_FOUND"}`, uncertain: true, retry: true},
		{name: "missing confirmation", status: 200, body: `{}`, uncertain: true, retry: true},
		{name: "not removed", status: 200, body: `{"request_id":"id","removed":false}`, uncertain: true, retry: true},
		{name: "invalid response", status: 200, body: `unexpected secret-private`, uncertain: true, retry: true},
		{name: "error in success", status: 200, body: `{"request_id":"id","error_code":"ERROR"}`, uncertain: true, retry: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			p := testPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
				calls++
				deadline, ok := r.Context().Deadline()
				if !ok || time.Until(deadline) > 30*time.Second {
					t.Error("unbounded request")
				}
				if tc.failure != nil {
					return nil, tc.failure
				}
				response := plaidTestResponse(tc.status, tc.body)
				response.Header.Set("Retry-After", "123")
				return response, nil
			}))
			result, err := p.Remove(context.Background(), "sandbox", Credential{raw: []byte("known-item-token")})
			var failure *RemovalError
			if !errors.As(err, &failure) || result.Confirmed || calls != 1 {
				t.Fatalf("unexpected result %+v %v calls=%d", result, err, calls)
			}
			if failure.Uncertain != tc.uncertain || failure.Retryable != tc.retry {
				t.Errorf("wrong failure classification: %+v", failure)
			}
			if tc.failure == nil && result.RetryAfter != 123*time.Second {
				t.Error("retry guidance lost")
			}
			if strings.Contains(fmt.Sprintf("%v %+v %#v", err, err, err), "secret-private") {
				t.Error("provider failure leaked secret")
			}
		})
	}
}
func TestPlaidRedirectAndConfiguration(t *testing.T) {
	calls := 0
	client := &http.Client{Timeout: time.Hour, Transport: bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		response := plaidTestResponse(302, "")
		response.Header.Set("Location", "https://attacker.invalid/item/remove")
		return response, nil
	})}
	config := PlaidConfig{Environment: "sandbox", ClientID: "client-private", Secret: "secret-private"}
	p, err := NewPlaidProvider(config, client)
	if err != nil {
		t.Fatal(err)
	}
	if p.client.Timeout != 30*time.Second || client.Timeout != time.Hour {
		t.Error("timeout ceiling or client ownership violated")
	}
	_, err = p.Remove(context.Background(), "sandbox", Credential{raw: []byte("known-item-token")})
	if err == nil || calls != 1 {
		t.Error("followed provider redirect")
	}
	if strings.Contains(fmt.Sprintf("%v %+v %#v %v %+v %#v", config, config, config, p, p, p), "private") {
		t.Error("configuration leaked")
	}
	config.Environment = "https://attacker.invalid"
	if _, err = NewPlaidProvider(config, client); err == nil {
		t.Error("accepted arbitrary provider destination")
	}
	config.Environment = "sandbox"
	config.Secret = ""
	if _, err = NewPlaidProvider(config, client); err == nil {
		t.Error("accepted absent provider auth")
	}
	now := time.Date(2026, 10, 18, 0, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		value string
		want  time.Duration
	}{{"120", 2 * time.Minute}, {now.Add(time.Minute).Format(http.TimeFormat), time.Minute}, {"-1", 0}, {"bad", 0}, {"9223372036854775807", time.Duration((1<<63-1)/int64(time.Second)) * time.Second}} {
		if got := parseRetryAfter(tc.value, now); got != tc.want {
			t.Errorf("Retry-After %q: %s", tc.value, got)
		}
	}
}

func TestPlaidLostResponseDoesNotConfirmOrAffectSibling(t *testing.T) {
	remaining := map[string]bool{"known-target": true, "unrelated-item": true}
	calls := 0
	provider := testPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		var request struct {
			AccessToken string `json:"access_token"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		delete(remaining, request.AccessToken)
		return nil, errors.New("response lost after committing removal")
	}))
	result, err := provider.Remove(context.Background(), "sandbox", Credential{raw: []byte("known-target")})
	var failure *RemovalError
	if !errors.As(err, &failure) || !failure.Uncertain || result.Confirmed || calls != 1 {
		t.Fatalf("lost response wrongly confirmed: %+v %v", result, err)
	}
	if remaining["known-target"] || !remaining["unrelated-item"] {
		t.Error("narrow removal touched the wrong remote Items")
	}
}

func TestPlaidObservationKnownItemStatus(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		healthy    bool
	}{
		{"healthy", `{"item":{"item_id":"expected-item","error":null},"request_id":"id"}`, true},
		{"needs attention", `{"item":{"item_id":"expected-item","error":{"error_code":"ITEM_LOGIN_REQUIRED","error_message":"private provider payload"}}}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			provider := testPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.URL.Path != "/item/get" || r.Method != "POST" || r.URL.Host != "sandbox.plaid.com" || r.Header.Get("PLAID-SECRET") != "secret-private" {
					t.Error("unexpected observation destination/auth")
				}
				var request map[string]string
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil || len(request) != 1 || request["access_token"] != "known-item-token" {
					t.Error("observation not scoped to known Item")
				}
				return plaidTestResponse(200, tc.body), nil
			}))
			observed, err := provider.Observe(context.Background(), "sandbox", Credential{raw: []byte("known-item-token")})
			if err != nil || observed.ItemID != "expected-item" || observed.Healthy != tc.healthy || calls != 1 {
				t.Fatalf("observation: %+v %v", observed, err)
			}
			if _, err = provider.Observe(context.Background(), "production", Credential{raw: []byte("known-item-token")}); err == nil || calls != 1 {
				t.Error("wrong environment reached provider")
			}
			if _, err = provider.Observe(context.Background(), "sandbox", Credential{}); err == nil || calls != 1 {
				t.Error("empty credential reached provider")
			}
		})
	}
}

func TestPlaidObservationFailureIsNeverHealthy(t *testing.T) {
	for _, tc := range []struct {
		name           string
		status         int
		body           string
		transportError error
		retry          bool
	}{
		{name: "transport failure", transportError: errors.New("known-item-token secret-private"), retry: true},
		{name: "rate limit", status: 429, body: `{}`, retry: true},
		{name: "provider outage", status: 503, body: `{}`, retry: true},
		{name: "invalid credential", status: 400, body: `{"error_code":"INVALID_ACCESS_TOKEN"}`},
		{name: "invalid JSON", status: 200, body: `private provider error`, retry: true},
		{name: "missing Item", status: 200, body: `{"request_id":"id"}`, retry: true},
		{name: "missing Item error", status: 200, body: `{"item":{"item_id":"id"}}`, retry: true},
		{name: "invalid Item error", status: 200, body: `{"item":{"item_id":"id","error":"private"}}`, retry: true},
		{name: "top-level error", status: 200, body: `{"item":{"item_id":"id","error":null},"error_code":"ERROR"}`, retry: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			provider := testPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
				deadline, ok := r.Context().Deadline()
				if !ok || time.Until(deadline) > 30*time.Second {
					t.Error("unbounded observation")
				}
				if tc.transportError != nil {
					return nil, tc.transportError
				}
				response := plaidTestResponse(tc.status, tc.body)
				response.Header.Set("Retry-After", "120")
				return response, nil
			}))
			result, err := provider.Observe(context.Background(), "sandbox", Credential{raw: []byte("known-item-token")})
			var failure *ObservationError
			if !errors.As(err, &failure) || result.Healthy || result.ItemID != "" || failure.Retryable != tc.retry {
				t.Fatalf("invalid response reported healthy: %+v %v", result, err)
			}
			if tc.transportError == nil && result.RetryAfter != 2*time.Minute {
				t.Error("lost observation retry guidance")
			}
			if strings.Contains(fmt.Sprintf("%v %+v %#v", err, err, err), "private") {
				t.Error("observation error leaked provider payload")
			}
		})
	}
}

func TestKnownTargetAlreadyRemovedIsConfirmedWithoutInvalidTokenGuess(t *testing.T) {
	provider := testPlaid(t, bankingRoundTrip(func(*http.Request) (*http.Response, error) {
		return plaidTestResponse(400, `{"error_code":"ITEM_NOT_FOUND"}`), nil
	}))
	result, err := provider.Remove(context.Background(), "sandbox", Credential{raw: []byte("known-removed-item")})
	if err != nil || !result.Confirmed {
		t.Fatal("documented already-removed target not confirmed")
	}
	result, err = provider.Remove(context.Background(), "sandbox", Credential{})
	if err == nil || result.Confirmed {
		t.Fatal("unidentified target guessed removed")
	}
}
