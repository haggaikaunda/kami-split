package onboarding

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
)

// sendProvider is reached only after the browser, eligibility and abuse checks.
// It owns provider diagnostics; raw errors may contain credentials or callback
// URLs, and response bodies may contain account details, so neither is logged.
func (h *Handler) sendProvider(ctx context.Context, operation, email, state string) {
	endpoint, key := "/recover", h.factory.apiKey
	if operation == "provision" {
		endpoint, key = "/invite", h.adminKey
	}
	body, _ := json.Marshal(map[string]string{"email": email})
	endpoint += "?redirect_to=" + url.QueryEscape(h.origin+"/auth/confirm#state="+state)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.factory.authURL+endpoint, bytes.NewReader(body))
	if err != nil {
		h.providerOutcome(ctx, operation, "request_failure", 0)
		return
	}
	// Modern keys are opaque API keys, not bearer JWTs. The gateway derives
	// the Auth role from apikey. Legacy local/hosted JWT keys need both headers.
	req.Header.Set("apikey", key)
	if !strings.HasPrefix(key, "sb_secret_") && !strings.HasPrefix(key, "sb_publishable_") {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := h.client.Do(req)
	if err != nil {
		h.providerOutcome(ctx, operation, "transport_failure", 0)
		return
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		h.providerOutcome(ctx, operation, "provider_failure", response.StatusCode)
		return
	}
	// Acceptance is not a claim of mailbox delivery or group admission.
	h.providerOutcome(ctx, operation, "accepted", response.StatusCode)
}

// All labels come from static server branches, never requests or provider text.
func (h *Handler) providerOutcome(ctx context.Context, operation, outcome string, status int) {
	level := slog.LevelInfo
	if strings.HasSuffix(outcome, "failure") {
		level = slog.LevelWarn
	}
	attrs := []any{"operation", operation, "outcome", outcome}
	if status != 0 {
		attrs = append(attrs, "status", status)
	}
	h.logger.Log(ctx, level, "onboarding.auth_provider", attrs...)
}
