package onboarding

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIndependentTargetedProviderFailuresAreSanitized(t *testing.T) {
	const private = "private-recipient@example.invalid provider-secret-material"
	for _, tc := range []struct {
		name          string
		status        int
		body, outcome string
		transport     bool
	}{
		{"redirect", 302, private, "provider_failure", false},
		{"unauthorized", 401, private, "provider_failure", false},
		{"unavailable", 503, private, "provider_failure", false},
		{"empty", 204, "", "response_failure", false},
		{"malformed", 200, private, "response_failure", false},
		{"oversized", 200, strings.Repeat("x", 65537), "response_failure", false},
		{"transport", 0, private, "transport_failure", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := independentHandler(t, http.NotFoundHandler())
			var logs bytes.Buffer
			h.logger = slog.New(slog.NewJSONHandler(&logs, nil))
			calls := 0
			h.client.Transport = providerRoundTripper(func(r *http.Request) (*http.Response, error) {
				calls++
				if tc.transport {
					return nil, errors.New(private)
				}
				return &http.Response{StatusCode: tc.status, Header: http.Header{"Location": []string{"https://unexpected.example/"}}, Body: io.NopCloser(strings.NewReader(tc.body)), Request: r}, nil
			})
			if _, ok := h.generateTargetLink(context.Background(), "private-recipient@example.invalid"); ok {
				t.Fatal("failed provider request released credentials")
			}
			if calls != 1 {
				t.Fatal("redirect or automatic retry occurred")
			}
			var event map[string]any
			if json.Unmarshal(logs.Bytes(), &event) != nil || event["operation"] != "targeted" || event["outcome"] != tc.outcome {
				t.Fatal("safe diagnostic missing")
			}
			for _, secret := range strings.Fields(private) {
				if strings.Contains(logs.String(), secret) {
					t.Fatal("private provider data logged")
				}
			}
		})
	}
}

func TestIndependentTargetedPrefetchAndTabMismatchDoNotConsumeContext(t *testing.T) {
	h := independentHandler(t, http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("unexpected provider effect") }))
	cookie := independentStart(t, h)
	original := h.contexts[cookie.Value]
	for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodOptions} {
		req := httptest.NewRequest(method, "/onboarding/targeted-continuation", nil)
		req.AddCookie(cookie)
		req.Header.Set("Purpose", "prefetch")
		out := httptest.NewRecorder()
		h.Wrap(http.NotFoundHandler()).ServeHTTP(out, req)
		if out.Code != http.StatusMethodNotAllowed {
			t.Fatal("unsafe method accepted")
		}
	}
	if out := independentPost(h, "targeted-continuation", `{"tokenDigest":"wrong-tab"}`, cookie); out.Code != http.StatusConflict || !strings.Contains(out.Body.String(), "ORIGINAL_LINK_REQUIRED") {
		t.Fatal("wrong tab passed credential boundary")
	}
	current := h.contexts[cookie.Value]
	if current.state != original.state || !bytes.Equal(current.cipher, original.cipher) {
		t.Fatal("scanner or wrong tab consumed context")
	}
}
