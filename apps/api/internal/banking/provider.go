package banking

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"
)

// PlaidConfig configures one isolated provider environment. Credentials must be
// provisioned separately for banking and must never appear in diagnostics.
type PlaidConfig struct {
	Environment         string
	ClientID            string
	Secret              string
	UserScopedDiscovery bool
	UserScopedRemoval   bool
}

// String redacts provider configuration, including authentication material.
func (PlaidConfig) String() string { return "[redacted banking provider configuration]" }

// GoString redacts provider configuration in Go-syntax diagnostics.
func (c PlaidConfig) GoString() string { return c.String() }

// PlaidProvider provides bounded enrollment, private inventory, Item observation,
// account-filtered transaction sync, verification keys and narrowly correlated
// removal. Callers own transaction boundaries and must invoke it outside them.
// It never retries externally observable calls or follows redirects.
type PlaidProvider struct {
	config   PlaidConfig
	client   *http.Client
	endpoint string
}

// NewPlaidProvider validates the environment and copies the client, retaining its
// injectable transport while imposing a maximum 30-second request timeout. The
// endpoint is always an official Plaid HTTPS host; test transports may intercept
// it without making arbitrary destinations configurable.
func NewPlaidProvider(config PlaidConfig, client *http.Client) (*PlaidProvider, error) {
	var endpoint string
	switch config.Environment {
	case "sandbox":
		endpoint = "https://sandbox.plaid.com"
	case "production":
		endpoint = "https://production.plaid.com"
	default:
		return nil, errors.New("invalid banking provider configuration")
	}
	if config.ClientID == "" || config.Secret == "" {
		return nil, errors.New("invalid banking provider configuration")
	}
	copied := http.Client{}
	if client != nil {
		copied = *client
	}
	if copied.Timeout <= 0 || copied.Timeout > 30*time.Second {
		copied.Timeout = 30 * time.Second
	}
	copied.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &PlaidProvider{config: config, client: &copied, endpoint: endpoint}, nil
}

// String prevents accidental provider credential disclosure.
func (*PlaidProvider) String() string { return "[redacted banking provider]" }

// GoString prevents provider credential disclosure in Go-syntax diagnostics.
func (p *PlaidProvider) GoString() string { return p.String() }

// RemovalResult reports only a confirmed response and provider retry guidance.
// RetryAfter is a minimum delay, including when the accompanying error is set.
type RemovalResult struct {
	Confirmed  bool
	RetryAfter time.Duration
}

// RemovalError is safe for diagnostics. Uncertain means the provider may have
// committed removal without a usable response; it never proves completion.
// Retryable permits another call for the same positively identified credential.
type RemovalError struct {
	Uncertain bool
	Retryable bool
}

// Error omits credentials, provider bodies, URLs and transport errors.
func (*RemovalError) Error() string { return "banking provider removal unavailable" }

// Remove removes only the Item represented by the supplied known credential.
// A timeout, invalid-token error or malformed response never confirms removal.
// The worker retains durable intent, applies RetryAfter and limits later retries.
func (p *PlaidProvider) Remove(ctx context.Context, environment string, credential Credential) (RemovalResult, error) {
	if environment != p.config.Environment || len(credential.raw) == 0 {
		return RemovalResult{}, &RemovalError{}
	}
	raw, _ := json.Marshal(struct {
		AccessToken string `json:"access_token"`
	}{string(credential.Bytes())})
	response, err := p.post(ctx, "/item/remove", raw)
	result := RemovalResult{RetryAfter: response.retryAfter}
	if err != nil {
		return result, &RemovalError{Uncertain: true, Retryable: true}
	}
	if response.status != http.StatusOK {
		// ITEM_NOT_FOUND is documented for an already removed/depermissioned
		// Item. This adapter accepts it only after a known credential was supplied;
		// invalid access-token errors never imply successful removal.
		var missing struct {
			Code string `json:"error_code"`
		}
		if response.status == http.StatusBadRequest && json.Unmarshal(response.body, &missing) == nil && missing.Code == "ITEM_NOT_FOUND" {
			result.Confirmed = true
			return result, nil
		}
		return result, &RemovalError{Uncertain: response.status >= 500, Retryable: response.status == 429 || response.status >= 500}
	}
	// Current Plaid-Version responses contain request_id, not the removed flag
	// returned by API versions 2019-05-29 and earlier. Explicit denial still fails.
	var payload struct {
		RequestID string `json:"request_id"`
		Removed   *bool  `json:"removed"`
		ErrorCode string `json:"error_code"`
	}
	if json.Unmarshal(response.body, &payload) != nil || payload.RequestID == "" || payload.ErrorCode != "" || (payload.Removed != nil && !*payload.Removed) {
		return result, &RemovalError{Uncertain: true, Retryable: true}
	}
	result.Confirmed = true
	return result, nil
}

type plaidResponse struct {
	status     int
	body       []byte
	retryAfter time.Duration
}

func (p *PlaidProvider) post(ctx context.Context, path string, body []byte) (plaidResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint+path, bytes.NewReader(body))
	if err != nil {
		return plaidResponse{}, errors.New("banking provider unavailable")
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("PLAID-CLIENT-ID", p.config.ClientID)
	request.Header.Set("PLAID-SECRET", p.config.Secret)
	request.Header.Set("Plaid-Version", "2020-09-14")
	response, err := p.client.Do(request)
	if err != nil {
		return plaidResponse{}, errors.New("banking provider unavailable")
	}
	defer response.Body.Close()
	result := plaidResponse{status: response.StatusCode, retryAfter: parseRetryAfter(response.Header.Get("Retry-After"), time.Now())}
	result.body, err = io.ReadAll(io.LimitReader(response.Body, 64*1024+1))
	if err != nil || len(result.body) > 64*1024 {
		return result, errors.New("banking provider unavailable")
	}
	return result, nil
}

func parseRetryAfter(value string, now time.Time) time.Duration {
	if seconds, err := strconv.ParseInt(value, 10, 64); err == nil && seconds > 0 {
		// Saturate untrusted guidance rather than overflowing into an immediate retry.
		const maxSeconds = int64((1<<63 - 1) / int64(time.Second))
		if seconds > maxSeconds {
			seconds = maxSeconds
		}
		return time.Duration(seconds) * time.Second
	}
	if at, err := http.ParseTime(value); err == nil && at.After(now) {
		return at.Sub(now)
	}
	return 0
}

// Observation is a minimal protected Item-status read. A healthy provider status
// does not establish consent, selection, lifecycle authority or import freshness.
// Callers must match ItemID against their durable target before recording it.
type Observation struct {
	ItemID  string
	Healthy bool
	// Revoked is positive matching-Item OAuth revocation evidence, not an inference
	// from temporary failures or missing credentials. It never authorizes deletion.
	Revoked    bool
	RetryAfter time.Duration
}

// ObservationError is a safe failure to observe an Item. Retryable permits a
// later bounded observation; a failed observation never proves revocation.
type ObservationError struct{ Retryable bool }

// Error excludes provider payloads, Item identifiers and credentials.
func (*ObservationError) Error() string { return "banking provider observation unavailable" }

// Observe reads only the Item represented by a known credential, outside any
// database transaction. A provider-reported Item error produces Healthy=false
// with the authenticated Item identity; unavailable or malformed responses fail
// closed. The worker durably fences a matching explicit revocation; observations never
// enable stopped work or grant selection.
func (p *PlaidProvider) Observe(ctx context.Context, environment string, credential Credential) (Observation, error) {
	if environment != p.config.Environment || len(credential.raw) == 0 {
		return Observation{}, &ObservationError{}
	}
	raw, _ := json.Marshal(struct {
		AccessToken string `json:"access_token"`
	}{string(credential.Bytes())})
	response, err := p.post(ctx, "/item/get", raw)
	result := Observation{RetryAfter: response.retryAfter}
	if err != nil {
		return result, &ObservationError{Retryable: true}
	}
	if response.status != http.StatusOK {
		return result, &ObservationError{Retryable: response.status == http.StatusTooManyRequests || response.status >= 500}
	}
	var payload struct {
		Item struct {
			ID    string          `json:"item_id"`
			Error json.RawMessage `json:"error"`
		} `json:"item"`
		ErrorCode string `json:"error_code"`
	}
	if json.Unmarshal(response.body, &payload) != nil || (payload.Item.ID == "" || len(payload.Item.ID) > 256) || len(payload.Item.Error) == 0 || payload.ErrorCode != "" {
		return result, &ObservationError{Retryable: true}
	}
	result.ItemID = payload.Item.ID
	if bytes.Equal(bytes.TrimSpace(payload.Item.Error), []byte("null")) {
		result.Healthy = true
		return result, nil
	}
	var itemError struct {
		Code   string `json:"error_code"`
		Reason string `json:"error_code_reason"`
	}
	if json.Unmarshal(payload.Item.Error, &itemError) != nil || itemError.Code == "" {
		return Observation{RetryAfter: response.retryAfter}, &ObservationError{Retryable: true}
	}
	result.Revoked = itemError.Reason == "OAUTH_USER_REVOKED"
	return result, nil
}
