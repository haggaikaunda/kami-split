package onboarding

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/invitation"
)

// Sender sends only committed #79 intents. The targeted-v1 origin, from address
// and rendering must remain immutable while recoverable intents exist.
type Sender struct {
	endpoint, apiKey, origin, from string
	client                         *http.Client
}

// NewSender validates deployment-owned delivery settings. Loopback endpoints
// are permitted for synthetic tests; production uses the Resend email endpoint.
func NewSender(endpoint, apiKey, origin, from string) (*Sender, error) {
	u, err := url.Parse(origin)
	_, mailErr := mail.ParseAddress(from)
	if err != nil || !trustedEndpoint(origin) || u.Path != "" && u.Path != "/" || !trustedEndpoint(endpoint) || apiKey == "" || mailErr != nil || strings.ContainsAny(from, "\r\n") {
		return nil, invitation.Unavailable
	}
	return &Sender{endpoint, apiKey, strings.TrimRight(origin, "/"), from, &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

// Deliver claims under current owner authority, sends outside locks and completes
// that exact lease. Lost completion remains UNKNOWN; recover the original action.
func (s *Sender) Deliver(ctx context.Context, service *invitation.Service, action uuid.UUID) error {
	dispatch, err := service.Claim(ctx, action)
	if err != nil {
		return err
	}
	outcome := s.send(ctx, dispatch.Payload(), dispatch.ProviderKey())
	applied, err := service.Complete(ctx, dispatch, outcome)
	if err != nil {
		return err
	}
	if !applied {
		return invitation.Outcome("NOT_CLAIMABLE")
	}
	return nil
}

func (s *Sender) send(ctx context.Context, raw []byte, key string) string {
	var m struct {
		Recipient string    `json:"recipient"`
		Token     string    `json:"token"`
		ExpiresAt time.Time `json:"expiresAt"`
		Template  string    `json:"template"`
	}
	if json.Unmarshal(raw, &m) != nil || m.Template != "targeted-v1" || invitation.TokenHash(m.Token) == nil || m.ExpiresAt.IsZero() {
		return "FAILED_DEFINITE"
	}
	if _, err := mail.ParseAddress(m.Recipient); err != nil {
		return "FAILED_DEFINITE"
	}
	// Text-only immutable rendering; capability fragments are absent from access logs.
	payload := struct {
		From    string   `json:"from"`
		To      []string `json:"to"`
		Subject string   `json:"subject"`
		Text    string   `json:"text"`
	}{s.from, []string{m.Recipient}, "Your Kami Split invitation", "You have been invited to Kami Split. Open this link to review the invitation and choose whether to join:\n\n" + s.origin + "/join#" + m.Token + "\n\nThis invitation expires at " + m.ExpiresAt.UTC().Format(time.RFC3339) + ". Signing in or verifying your email does not automatically join a group.\n"}
	body, err := json.Marshal(payload)
	if err != nil {
		return "FAILED_DEFINITE"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.endpoint, bytes.NewReader(body))
	if err != nil {
		return "FAILED_DEFINITE"
	}
	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key)
	response, err := s.client.Do(req)
	if err != nil {
		return "UNKNOWN"
	}
	defer response.Body.Close()
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		var result struct {
			ID string `json:"id"`
		}
		if json.NewDecoder(io.LimitReader(response.Body, 8192)).Decode(&result) == nil && result.ID != "" {
			return "PROVIDER_ACCEPTED"
		}
		return "UNKNOWN"
	}
	if response.StatusCode >= 400 && response.StatusCode < 500 && response.StatusCode != 408 && response.StatusCode != 409 {
		return "FAILED_DEFINITE"
	}
	return "UNKNOWN"
}

// String redacts the provider credential.
func (*Sender) String() string { return "[redacted invitation sender]" }

// GoString redacts Go-syntax diagnostics too.
func (s *Sender) GoString() string { return s.String() }
