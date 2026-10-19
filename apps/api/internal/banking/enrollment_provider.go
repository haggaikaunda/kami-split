package banking

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// EnrollmentProvider is the external boundary for durable new-Link attempts.
// Callers persist the user before preparing Link, claim exchange exactly once,
// and preserve correlation and cleanup intent across every uncertain response.
type EnrollmentProvider interface {
	EnrollmentCapabilities() EnrollmentCapabilities
	EnsureUser(context.Context, string, string) (string, error)
	Prepare(context.Context, EnrollmentPreparation) (LinkPreparation, error)
	Exchange(context.Context, string, PublicToken) (ExchangeResult, error)
	Accounts(context.Context, string, Credential) (AccountInventory, error)
	Discover(context.Context, string, EnrollmentCorrelation) ([]string, error)
	RemoveDiscovered(context.Context, string, EnrollmentCorrelation, string) (RemovalResult, error)
}

// EnrollmentCapabilities declares the caller's configured capability gates.
// These flags do not attest provider entitlement in the current environment.
type EnrollmentCapabilities struct {
	UserScopedDiscovery bool
	UserScopedRemoval   bool
}

// EnrollmentPreparation carries server-derived identity and an immutable,
// attempt-specific webhook URL. UserID must already be durably persisted.
type EnrollmentPreparation struct {
	Environment, ClientUserID, UserID, WebhookURL string
}

// String prevents identity and correlation disclosure in diagnostics.
func (EnrollmentPreparation) String() string { return "[redacted banking preparation]" }

// GoString prevents Go-syntax diagnostics from exposing preparation fields.
func (v EnrollmentPreparation) GoString() string { return v.String() }

// LinkPreparation contains only the short-lived handoff and its provider expiry.
// The caller must encrypt it in expiring operation storage before returning it.
type LinkPreparation struct {
	UserID, LinkToken string
	ExpiresAt         time.Time
}

// String prevents short-lived handoff disclosure in diagnostics.
func (LinkPreparation) String() string { return "[redacted banking Link handoff]" }

// GoString prevents Go-syntax handoff disclosure.
func (v LinkPreparation) GoString() string { return v.String() }

// PublicToken owns a short-lived, one-use exchange token. It must never enter
// logs, queue payloads, browser persistence or ordinary operation results.
type PublicToken struct{ raw []byte }

// NewPublicToken copies the caller's temporary token rather than retaining it.
func NewPublicToken(raw []byte) PublicToken { return PublicToken{raw: append([]byte(nil), raw...)} }

// Bytes returns an independent token copy for the protected provider boundary.
func (v PublicToken) Bytes() []byte { return append([]byte(nil), v.raw...) }

// String redacts the public token in ordinary diagnostics.
func (PublicToken) String() string { return "[redacted banking public token]" }

// GoString redacts the public token in Go-syntax diagnostics.
func (v PublicToken) GoString() string { return v.String() }

// ExchangeResult must be protected and persisted before acknowledging readiness.
// ItemID is provider identity, not proof of consent or account selection.
type ExchangeResult struct {
	ItemID      string
	AccessToken Credential
}

// String prevents Item and credential disclosure in diagnostics.
func (ExchangeResult) String() string { return "[redacted banking exchange]" }

// GoString prevents Go-syntax exchange disclosure.
func (v ExchangeResult) GoString() string { return v.String() }

// ProviderAccount is private server-observed metadata, never selection authority.
// StableID is populated only by exact provider persistent_account_id evidence;
// names, masks and similar display data never establish account continuity.
type ProviderAccount struct {
	ID, Name, Type, Subtype, Currency, StableID string
}

// String prevents private account metadata disclosure in diagnostics.
func (ProviderAccount) String() string { return "[redacted banking account]" }

// GoString prevents Go-syntax account metadata disclosure.
func (v ProviderAccount) GoString() string { return v.String() }

// AccountInventory is the server-observed inventory for one credential. Callers
// match ItemID and enforce eligibility and explicit selection before retaining it.
type AccountInventory struct {
	ItemID, InstitutionID, CountryCode string
	Accounts                           []ProviderAccount
}

// String prevents private inventory disclosure in diagnostics.
func (AccountInventory) String() string { return "[redacted banking inventory]" }

// GoString prevents Go-syntax inventory disclosure.
func (v AccountInventory) GoString() string { return v.String() }

// EnrollmentCorrelation binds a durable actor/environment user to the exact
// immutable webhook URL supplied when preparing this attempt. It is not a token
// recovery mechanism, and an empty discovery never proves absence of an effect.
type EnrollmentCorrelation struct {
	UserID, ClientUserID, WebhookURL string
}

// String prevents correlation identifiers and URLs entering diagnostics.
func (EnrollmentCorrelation) String() string { return "[redacted banking correlation]" }

// GoString prevents Go-syntax correlation disclosure.
func (v EnrollmentCorrelation) GoString() string { return v.String() }

// EnrollmentError is safe for diagnostics. Uncertain means an external effect
// may have occurred. Retryable permits a later bounded call only when the durable
// operation's contract allows it; exchange must never be automatically retried.
// RetryAfter is a minimum delay even when the operation remains uncertain.
type EnrollmentError struct {
	Uncertain  bool
	Retryable  bool
	RetryAfter time.Duration
}

// Error excludes provider payloads, tokens, bank metadata and transport details.
func (*EnrollmentError) Error() string { return "banking provider enrollment unavailable" }

// EnrollmentCapabilities returns operator-configured capability evidence gates.
// Both remain false by default; sandbox availability does not enable production.
func (p *PlaidProvider) EnrollmentCapabilities() EnrollmentCapabilities {
	return EnrollmentCapabilities{p.config.UserScopedDiscovery, p.config.UserScopedRemoval}
}

func (p *PlaidProvider) enrollmentEnabled(environment string) bool {
	return environment == p.config.Environment && p.config.UserScopedDiscovery && p.config.UserScopedRemoval
}

func validProviderID(value string) bool { return value != "" && len(value) <= 256 }

func validClientUserID(value string) bool { return value != "" && len(value) <= 128 }

func validWebhook(value string) bool {
	u, err := url.Parse(value)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && u.Fragment == "" && len(value) <= 2048
}

func validCorrelation(v EnrollmentCorrelation) bool {
	return strings.HasPrefix(v.UserID, "usr_") && validProviderID(v.UserID) && validClientUserID(v.ClientUserID) && validWebhook(v.WebhookURL)
}

// EnsureUser resolves the stable Plaid user for the server-derived actor and
// environment. Plaid documents this operation as idempotent for client_user_id;
// callers must persist its result before invoking Prepare.
func (p *PlaidProvider) EnsureUser(ctx context.Context, environment, clientUserID string) (string, error) {
	if !p.enrollmentEnabled(environment) || !validClientUserID(clientUserID) {
		return "", &EnrollmentError{}
	}
	var payload struct {
		UserID string `json:"user_id"`
	}
	if err := p.enrollmentPost(ctx, "/user/create", struct {
		ClientUserID string `json:"client_user_id"`
	}{clientUserID}, &payload, true); err != nil {
		return "", err
	}
	if !strings.HasPrefix(payload.UserID, "usr_") || !validProviderID(payload.UserID) {
		return "", &EnrollmentError{Uncertain: true, Retryable: true}
	}
	return payload.UserID, nil
}

// Prepare creates one new-Link handoff using a pre-persisted provider user and
// exact attempt correlation URL. It requests 365 days, never promises coverage,
// limits Link to one Item, and leaves account authorization to explicit selection.
func (p *PlaidProvider) Prepare(ctx context.Context, input EnrollmentPreparation) (LinkPreparation, error) {
	correlation := EnrollmentCorrelation{input.UserID, input.ClientUserID, input.WebhookURL}
	if !p.enrollmentEnabled(input.Environment) || !validCorrelation(correlation) {
		return LinkPreparation{}, &EnrollmentError{}
	}
	request := map[string]any{
		"user":    map[string]string{"client_user_id": input.ClientUserID},
		"user_id": input.UserID, "client_name": "Kami Split", "language": "en",
		"products": []string{"transactions"}, "country_codes": []string{"US"},
		"transactions": map[string]int{"days_requested": 365},
		"webhook":      input.WebhookURL, "enable_multi_item_link": false,
		"account_filters": map[string]any{
			"depository": map[string]any{"account_subtypes": []string{"checking", "savings"}},
			"credit":     map[string]any{"account_subtypes": []string{"credit card"}},
		},
	}
	var payload struct {
		LinkToken  string    `json:"link_token"`
		Expiration time.Time `json:"expiration"`
	}
	if err := p.enrollmentPost(ctx, "/link/token/create", request, &payload, true); err != nil {
		return LinkPreparation{}, err
	}
	// New-Link defaults to four hours. Reject implausibly long or expired
	// material rather than extending provider expiry in local storage.
	now := time.Now()
	if payload.LinkToken == "" || len(payload.LinkToken) > 4096 || !payload.Expiration.After(now) || payload.Expiration.After(now.Add(4*time.Hour)) {
		return LinkPreparation{}, &EnrollmentError{Uncertain: true, Retryable: true}
	}
	return LinkPreparation{UserID: input.UserID, LinkToken: payload.LinkToken, ExpiresAt: payload.Expiration}, nil
}

// Exchange submits the one-use public token once. An uncertain outcome requires
// durable discovery/cleanup; even a retryable HTTP failure never permits replay.
func (p *PlaidProvider) Exchange(ctx context.Context, environment string, token PublicToken) (ExchangeResult, error) {
	if !p.enrollmentEnabled(environment) || len(token.raw) == 0 || len(token.raw) > 4096 {
		return ExchangeResult{}, &EnrollmentError{}
	}
	var payload struct {
		ItemID      string `json:"item_id"`
		AccessToken string `json:"access_token"`
	}
	if err := p.enrollmentPost(ctx, "/item/public_token/exchange", struct {
		PublicToken string `json:"public_token"`
	}{string(token.Bytes())}, &payload, true); err != nil {
		if failure, ok := err.(*EnrollmentError); ok {
			failure.Retryable = false
		}
		return ExchangeResult{}, err
	}
	if !validProviderID(payload.ItemID) || payload.AccessToken == "" || len(payload.AccessToken) > 4096 {
		return ExchangeResult{}, &EnrollmentError{Uncertain: true}
	}
	return ExchangeResult{payload.ItemID, Credential{raw: []byte(payload.AccessToken)}}, nil
}

// Accounts reads metadata from the credential's Item and institution, without
// returning balances, numbers or masks. Missing/ambiguous country evidence fails
// closed; eligibility and selection remain the application's responsibility.
func (p *PlaidProvider) Accounts(ctx context.Context, environment string, credential Credential) (AccountInventory, error) {
	if environment != p.config.Environment || len(credential.raw) == 0 {
		return AccountInventory{}, &EnrollmentError{}
	}
	var payload struct {
		Item struct {
			ID            string `json:"item_id"`
			InstitutionID string `json:"institution_id"`
		} `json:"item"`
		Accounts []struct {
			ID         string `json:"account_id"`
			Name       string `json:"name"`
			Type       string `json:"type"`
			Subtype    string `json:"subtype"`
			Persistent string `json:"persistent_account_id"`
			Balances   struct {
				Currency string `json:"iso_currency_code"`
			} `json:"balances"`
		} `json:"accounts"`
	}
	if err := p.enrollmentPost(ctx, "/accounts/get", struct {
		AccessToken string `json:"access_token"`
	}{string(credential.Bytes())}, &payload, false); err != nil {
		return AccountInventory{}, err
	}
	if !validProviderID(payload.Item.ID) || !validProviderID(payload.Item.InstitutionID) || payload.Accounts == nil || len(payload.Accounts) > 1000 {
		return AccountInventory{}, &EnrollmentError{Retryable: true}
	}
	var institution struct {
		Institution struct {
			ID        string   `json:"institution_id"`
			Countries []string `json:"country_codes"`
		} `json:"institution"`
	}
	request := struct {
		ID        string   `json:"institution_id"`
		Countries []string `json:"country_codes"`
	}{payload.Item.InstitutionID, []string{"US"}}
	if err := p.enrollmentPost(ctx, "/institutions/get_by_id", request, &institution, false); err != nil {
		return AccountInventory{}, err
	}
	if institution.Institution.ID != payload.Item.InstitutionID || len(institution.Institution.Countries) != 1 || institution.Institution.Countries[0] != "US" {
		return AccountInventory{}, &EnrollmentError{}
	}
	result := AccountInventory{ItemID: payload.Item.ID, InstitutionID: payload.Item.InstitutionID, CountryCode: "US", Accounts: make([]ProviderAccount, 0, len(payload.Accounts))}
	seen := make(map[string]bool)
	for _, account := range payload.Accounts {
		if !validProviderID(account.ID) || seen[account.ID] || len(account.Name) > 512 || len(account.Persistent) > 256 {
			return AccountInventory{}, &EnrollmentError{Retryable: true}
		}
		seen[account.ID] = true
		result.Accounts = append(result.Accounts, ProviderAccount{account.ID, account.Name, account.Type, account.Subtype, account.Balances.Currency, account.Persistent})
	}
	return result, nil
}

// Discover returns only Items associated with the durable provider user whose
// webhook exactly matches the persisted attempt URL. Empty output is an
// observation only: it cannot prove a lost exchange or delayed Link had no effect.
func (p *PlaidProvider) Discover(ctx context.Context, environment string, correlation EnrollmentCorrelation) ([]string, error) {
	if environment != p.config.Environment || !p.config.UserScopedDiscovery || !validCorrelation(correlation) {
		return nil, &EnrollmentError{}
	}
	var payload struct {
		Items []struct {
			ID      string `json:"item_id"`
			Webhook string `json:"webhook"`
		} `json:"items"`
	}
	if err := p.enrollmentPost(ctx, "/user/items/get", struct {
		UserID string `json:"user_id"`
	}{correlation.UserID}, &payload, false); err != nil {
		return nil, err
	}
	if payload.Items == nil || len(payload.Items) > 1000 {
		return nil, &EnrollmentError{Retryable: true}
	}
	result := make([]string, 0)
	seen := make(map[string]bool)
	for _, item := range payload.Items {
		if !validProviderID(item.ID) || seen[item.ID] {
			return nil, &EnrollmentError{Retryable: true}
		}
		seen[item.ID] = true
		if item.Webhook == correlation.WebhookURL {
			result = append(result, item.ID)
		}
	}
	return result, nil
}

// RemoveDiscovered revalidates exact attempt correlation before narrowly removing
// one Item. A lost response followed by absent discovery remains unconfirmed;
// neither an empty list nor a not-associated error is evidence of completion.
func (p *PlaidProvider) RemoveDiscovered(ctx context.Context, environment string, correlation EnrollmentCorrelation, itemID string) (RemovalResult, error) {
	if !p.enrollmentEnabled(environment) || !validCorrelation(correlation) || !validProviderID(itemID) {
		return RemovalResult{}, &RemovalError{}
	}
	items, err := p.Discover(ctx, environment, correlation)
	if err != nil {
		failure, ok := err.(*EnrollmentError)
		if ok {
			return RemovalResult{RetryAfter: failure.RetryAfter}, &RemovalError{Retryable: failure.Retryable}
		}
		return RemovalResult{}, &RemovalError{}
	}
	found := false
	for _, candidate := range items {
		if candidate == itemID {
			found = true
		}
	}
	if !found {
		return RemovalResult{}, &RemovalError{Uncertain: true}
	}
	raw, _ := json.Marshal(struct {
		UserID string   `json:"user_id"`
		Items  []string `json:"item_ids"`
	}{correlation.UserID, []string{itemID}})
	response, err := p.post(ctx, "/user/items/remove", raw)
	result := RemovalResult{RetryAfter: response.retryAfter}
	if err != nil {
		return result, &RemovalError{Uncertain: true, Retryable: true}
	}
	if response.status != http.StatusOK {
		return result, &RemovalError{Uncertain: response.status >= 500, Retryable: response.status == http.StatusTooManyRequests || response.status >= 500}
	}
	var payload struct {
		RequestID string `json:"request_id"`
		ErrorCode string `json:"error_code"`
		Removed   *bool  `json:"removed"`
	}
	if json.Unmarshal(response.body, &payload) != nil || payload.RequestID == "" || payload.ErrorCode != "" || (payload.Removed != nil && !*payload.Removed) {
		return result, &RemovalError{Uncertain: true, Retryable: true}
	}
	result.Confirmed = true
	return result, nil
}

func (p *PlaidProvider) enrollmentPost(ctx context.Context, path string, request, target any, effect bool) error {
	raw, err := json.Marshal(request)
	if err != nil {
		return &EnrollmentError{}
	}
	response, err := p.post(ctx, path, raw)
	if err != nil {
		return &EnrollmentError{Uncertain: effect, Retryable: true, RetryAfter: response.retryAfter}
	}
	if response.status != http.StatusOK {
		return &EnrollmentError{Uncertain: effect && response.status >= 500, Retryable: response.status == http.StatusTooManyRequests || response.status >= 500, RetryAfter: response.retryAfter}
	}
	var failure struct {
		ErrorCode string `json:"error_code"`
	}
	if json.Unmarshal(response.body, &failure) != nil || failure.ErrorCode != "" || json.Unmarshal(response.body, target) != nil {
		return &EnrollmentError{Uncertain: effect, Retryable: true, RetryAfter: response.retryAfter}
	}
	return nil
}
