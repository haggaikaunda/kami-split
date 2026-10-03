package onboarding

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestProviderCredentials(t *testing.T) {
	for _, tc := range []struct{ name, operation, public, admin, key, bearer, path string }{
		{"modern invite", "provision", "sb_publishable_public", "sb_secret_admin", "sb_secret_admin", "", "/invite"},
		{"modern recovery", "recover", "sb_publishable_public", "sb_secret_admin", "sb_publishable_public", "", "/recover"},
		{"legacy invite", "provision", "legacy-anon", "legacy-service", "legacy-service", "Bearer legacy-service", "/invite"},
		{"legacy recovery", "recover", "legacy-anon", "legacy-service", "legacy-anon", "Bearer legacy-anon", "/recover"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			called := false
			h := independentHandler(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				if r.Method != http.MethodPost || r.URL.Path != tc.path || r.Header.Get("apikey") != tc.key || r.Header.Get("Authorization") != tc.bearer || r.Header.Get("Content-Type") != "application/json" {
					t.Error("incorrect provider request contract")
				}
				var payload map[string]string
				if json.NewDecoder(r.Body).Decode(&payload) != nil || len(payload) != 1 || payload["email"] != "synthetic@example.invalid" {
					t.Error("incorrect request payload")
				}
				redirect, err := url.Parse(r.URL.Query().Get("redirect_to"))
				if err != nil || redirect.String() != "https://kami.example/auth/confirm#state=synthetic-state" {
					t.Error("incorrect callback destination")
				}
				w.WriteHeader(200)
			}))
			h.factory.apiKey, h.adminKey = tc.public, tc.admin
			h.sendProvider(context.Background(), tc.operation, "synthetic@example.invalid", "synthetic-state")
			if !called {
				t.Fatal("provider not called")
			}
		})
	}
}

type providerRoundTripper func(*http.Request) (*http.Response, error)

func (f providerRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestProviderDiagnosticsAndGenericResponse(t *testing.T) {
	const sensitive = "synthetic@example.invalid SyntheticPassword162! sb_secret_private invitation-capability callback-state"
	var generic string
	for _, tc := range []struct {
		name      string
		status    int
		outcome   string
		transport bool
	}{
		{"accepted", 200, "accepted", false},
		{"accepted no content", 204, "accepted", false},
		{"redirect", 302, "provider_failure", false},
		{"unauthorized", 401, "provider_failure", false},
		{"already exists", 422, "provider_failure", false},
		{"provider unavailable", 503, "provider_failure", false},
		{"transport", 0, "transport_failure", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := independentHandler(t, http.NotFoundHandler())
			var logs bytes.Buffer
			h.logger = slog.New(slog.NewJSONHandler(&logs, nil))
			calls := 0
			h.client.Transport = providerRoundTripper(func(r *http.Request) (*http.Response, error) {
				calls++
				if tc.transport {
					return nil, errors.New(sensitive)
				}
				return &http.Response{StatusCode: tc.status, Header: http.Header{"Location": []string{"https://unexpected.example/"}}, Body: io.NopCloser(strings.NewReader(sensitive)), Request: r}, nil
			})
			cookie := independentStart(t, h)
			out := independentPost(h, "recover", `{"email":"synthetic@example.invalid"}`, cookie)
			if out.Code != 200 || !strings.Contains(out.Body.String(), `"code":"CHECK_EMAIL"`) {
				t.Fatal("generic response changed")
			}
			if generic == "" {
				generic = out.Body.String()
			} else if generic != out.Body.String() {
				t.Fatal("provider outcome disclosed to browser")
			}
			if calls != 1 {
				t.Fatal("provider followed redirect or retried")
			}
			var event map[string]any
			if json.Unmarshal(logs.Bytes(), &event) != nil || event["msg"] != "onboarding.auth_provider" || event["outcome"] != tc.outcome || event["operation"] != "recover" {
				t.Fatalf("missing sanitized diagnostic: %s", logs.String())
			}
			if tc.status != 0 && event["status"] != float64(tc.status) {
				t.Fatal("missing provider status")
			}
			for _, field := range strings.Fields(sensitive) {
				if strings.Contains(logs.String(), field) || strings.Contains(out.Body.String(), field) {
					t.Fatal("sensitive data escaped boundary")
				}
			}
			for key := range event {
				if key != "time" && key != "level" && key != "msg" && key != "operation" && key != "outcome" && key != "status" {
					t.Fatalf("unexpected diagnostic field %q", key)
				}
			}
		})
	}
}
