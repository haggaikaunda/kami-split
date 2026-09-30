// Package onboarding provides provider adapters over the invitation service.
// It never writes application identity or membership state.
package onboarding

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
)

// EmailProvider is request-scoped: its token is the exact bearer used by the
// request verifier. Never retain this value in a shared resolver or service.
type EmailProvider struct {
	endpoint, apiKey, token string
	client                  *http.Client
}

// NewEmailProvider configures a fresh authoritative getUser lookup. Redirects
// are refused so neither provider credentials nor user tokens leave the origin.
func NewEmailProvider(endpoint, apiKey, token string) (*EmailProvider, error) {
	if !trustedEndpoint(endpoint) || apiKey == "" || token == "" || len(token) > 16<<10 {
		return nil, auth.Unavailable
	}
	return &EmailProvider{strings.TrimRight(endpoint, "/"), apiKey, token, &http.Client{Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func trustedEndpoint(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Hostname() != "" && u.User == nil && u.RawQuery == "" && u.Fragment == "" && (u.Scheme == "https" || u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost" || u.Hostname() == "::1"))
}

// CurrentEmail observes only the provider's current email and confirmation, not
// pending email changes, JWT claims or user metadata. #79 binds subject/freshness.
func (p *EmailProvider) CurrentEmail(ctx context.Context, subject string) (auth.ProviderEmail, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.endpoint+"/user", nil)
	if err != nil {
		return auth.ProviderEmail{}, auth.Unavailable
	}
	req.Header.Set("apikey", p.apiKey)
	req.Header.Set("Authorization", "Bearer "+p.token)
	response, err := p.client.Do(req)
	if err != nil {
		return auth.ProviderEmail{}, auth.Unavailable
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return auth.ProviderEmail{}, auth.Unavailable
	}
	var user struct {
		ID        string     `json:"id"`
		Email     string     `json:"email"`
		Confirmed *time.Time `json:"email_confirmed_at"`
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 64<<10+1))
	if err != nil || len(body) > 64<<10 || json.Unmarshal(body, &user) != nil || user.ID != subject || user.Email == "" {
		return auth.ProviderEmail{}, auth.Unavailable
	}
	return auth.ProviderEmail{Subject: user.ID, Email: user.Email, Verified: user.Confirmed != nil && !user.Confirmed.IsZero()}, nil
}

// String prevents credentials appearing in diagnostics.
func (*EmailProvider) String() string { return "[redacted current-email provider]" }

// GoString prevents credentials appearing in Go-syntax diagnostics.
func (p *EmailProvider) GoString() string { return p.String() }
