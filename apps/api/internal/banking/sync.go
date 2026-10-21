package banking

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// SyncBinding is one server-authorized local binding, not an account selection
// request. Callers must recheck consent, lifecycle generation and ownership, and
// decrypt the credential for this environment/Item before calling the provider.
type SyncBinding struct {
	BindingID, Environment, ItemID, AccountID string
}

// String excludes private provider and local identities from diagnostics.
func (SyncBinding) String() string { return "[redacted banking sync binding]" }

// GoString excludes identities from Go-syntax diagnostics.
func (v SyncBinding) GoString() string { return v.String() }

func (v SyncBinding) valid() bool {
	return validProviderID(v.BindingID) && (v.Environment == "sandbox" || v.Environment == "production") && validProviderID(v.ItemID) && validProviderID(v.AccountID)
}

// SyncCursor retains the provenance of an account-filtered stream. It is not a
// browser cursor or a queue payload. Its zero value is invalid, not a reset.
type SyncCursor struct {
	binding SyncBinding
	value   string
}

// NewSyncCursor initializes an empty stream or restores an opaque cursor from
// trusted storage for this exact binding. A restored value MUST originate from
// options.account_id for this binding; an Item-wide cursor cannot be converted.
// The special "now" cursor is rejected because it silently skips history.
func NewSyncCursor(binding SyncBinding, opaque string) (SyncCursor, error) {
	if !binding.valid() || len(opaque) > 256 || opaque == "now" {
		return SyncCursor{}, &SyncError{Kind: SyncInvalidRequest}
	}
	return SyncCursor{binding: binding, value: opaque}, nil
}

// Opaque returns private provider checkpoint material for protected storage only.
func (v SyncCursor) Opaque() string { return v.value }

// String prevents checkpoint disclosure in ordinary diagnostics.
func (SyncCursor) String() string { return "[redacted banking sync cursor]" }

// GoString prevents checkpoint disclosure in Go-syntax diagnostics.
func (v SyncCursor) GoString() string { return v.String() }

// SyncTransaction is a validated private bank fact. AmountMinor retains Plaid's
// sign: positive is outflow, negative is inflow, for checking, savings and cards.
// Date and AuthorizedDate are bank calendar dates, without timezone conversion.
// Nil optional fields mean unavailable; unknown provider strings are preserved.
// PendingTransactionID is only explicit provider linkage, never a purchase/refund
// association. A credit alone is not evidence of a refund.
type SyncTransaction struct {
	TransactionID, AccountID, Date string
	AmountMinor                    int64
	Currency                       string
	Pending                        bool
	PendingTransactionID           *string
	AuthorizedDate                 *string
	Name, MerchantName             *string
	TransactionCode                *string
}

// String prevents financial facts and identities from entering diagnostics.
func (SyncTransaction) String() string { return "[redacted banking sync transaction]" }

// GoString prevents Go-syntax financial disclosure.
func (v SyncTransaction) GoString() string { return v.String() }

// SyncRemoval belongs exclusively to its page's authorized binding. Plaid may
// omit account_id; nil preserves that absence and never means an Item-wide delete.
// Consumers must remove by (binding, transaction ID), never by transaction ID alone.
type SyncRemoval struct {
	TransactionID string
	AccountID     *string
}

// String prevents removed transaction identity disclosure.
func (SyncRemoval) String() string { return "[redacted banking sync removal]" }

// GoString prevents Go-syntax removed identity disclosure.
func (v SyncRemoval) GoString() string { return v.String() }

// SyncFreshness is the Item-level observation before fetching the page. Neither
// timestamp establishes account coverage or the freshness of a committed import.
// Nil means the provider did not supply the fact.
type SyncFreshness struct {
	LastSuccessfulUpdate, LastFailedUpdate *time.Time
}

// String excludes private update timing from diagnostics.
func (SyncFreshness) String() string { return "[redacted banking sync freshness]" }

// GoString excludes Go-syntax update timing disclosure.
func (v SyncFreshness) GoString() string { return v.String() }

// SyncPage contains independent, caller-owned validated changes for Binding.
// Preserve the starting cursor until ALL pages complete; a pagination mutation
// requires discarding the whole batch and restarting from that starting cursor.
// This adapter does not persist, schedule retries, classify spending or log facts.
// Never serialize the page into queue messages; queues carry opaque local IDs.
type SyncPage struct {
	Binding      SyncBinding
	Added        []SyncTransaction
	Modified     []SyncTransaction
	Removed      []SyncRemoval
	NextCursor   SyncCursor
	HasMore      bool
	UpdateStatus *string
	Freshness    SyncFreshness
}

// String prevents accidental page payload disclosure.
func (SyncPage) String() string { return "[redacted banking sync page]" }

// GoString prevents Go-syntax page payload disclosure.
func (v SyncPage) GoString() string { return v.String() }

// SyncErrorKind is an allowlisted, worker-safe failure category.
type SyncErrorKind string

const (
	// SyncInvalidRequest requires fixing the environment, binding or cursor provenance.
	SyncInvalidRequest SyncErrorKind = "invalid_request"
	// SyncInvalidResponse rejects malformed or unsupported facts without a page.
	SyncInvalidResponse SyncErrorKind = "invalid_response"
	// SyncPaginationMutation requires restarting the entire uncommitted page batch.
	SyncPaginationMutation SyncErrorKind = "pagination_mutation"
	// SyncNotReady permits a later bounded read, normally after a verified webhook.
	SyncNotReady SyncErrorKind = "not_ready"
	// SyncRateLimited requires bounded backoff at least as long as RetryAfter.
	SyncRateLimited SyncErrorKind = "rate_limited"
	// SyncTemporary permits bounded retry, retaining the existing checkpoint.
	SyncTemporary SyncErrorKind = "temporary"
	// SyncReconnect requires account/Item permission repair, never automatic re-enrollment.
	SyncReconnect SyncErrorKind = "reconnect"
	// SyncRejected requires operator attention; unknown errors never authorize retries.
	SyncRejected SyncErrorKind = "rejected"
)

// SyncError carries no raw provider/transport error, identity or payload.
// RetryAfter is a minimum delay from response receipt; Kind defines whether a
// retry is appropriate. Errors always accompany a zero, unusable SyncPage.
type SyncError struct {
	Kind       SyncErrorKind
	RetryAfter time.Duration
}

// Error is static so even unexpected provider content cannot enter diagnostics.
func (*SyncError) Error() string { return "banking provider transaction sync unavailable" }

// SyncTransactions fetches one account-filtered page, outside any database
// transaction, without automatic retry. An exact Item read verifies credential
// identity because /transactions/sync itself does not return an Item. Both calls
// share a 30-second deadline and the existing bounded, redirect-free transport.
// Enrollment already requests 365 days through Link; this call never resets that
// initialization contract, expands selection, trims retained history or uses FX.
func (p *PlaidProvider) SyncTransactions(ctx context.Context, binding SyncBinding, credential Credential, cursor SyncCursor) (SyncPage, error) {
	if !binding.valid() || binding.Environment != p.config.Environment || len(credential.raw) == 0 || cursor.binding != binding || len(cursor.value) > 256 || cursor.value == "now" {
		return SyncPage{}, &SyncError{Kind: SyncInvalidRequest}
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	freshness, err := p.syncIdentity(ctx, binding, credential)
	if err != nil {
		return SyncPage{}, err
	}
	request := struct {
		AccessToken string `json:"access_token"`
		Cursor      string `json:"cursor"`
		Count       int    `json:"count"`
		Options     struct {
			AccountID string `json:"account_id"`
		} `json:"options"`
	}{AccessToken: string(credential.Bytes()), Cursor: cursor.value, Count: 20}
	// Twenty updates leave headroom within the existing 64-KiB body protection;
	// oversized pages still fail closed rather than weakening that shared bound.
	request.Options.AccountID = binding.AccountID
	raw, _ := json.Marshal(request)
	response, err := p.post(ctx, "/transactions/sync", raw)
	if err != nil {
		return SyncPage{}, &SyncError{Kind: SyncTemporary, RetryAfter: response.retryAfter}
	}
	if response.status != http.StatusOK {
		return SyncPage{}, syncFailure(response)
	}
	page, err := decodeSyncPage(response.body, binding, cursor)
	if err != nil {
		return SyncPage{}, err
	}
	page.Freshness = freshness
	return page, nil
}

func (p *PlaidProvider) syncIdentity(ctx context.Context, binding SyncBinding, credential Credential) (SyncFreshness, error) {
	raw, _ := json.Marshal(map[string]string{"access_token": string(credential.Bytes())})
	response, err := p.post(ctx, "/item/get", raw)
	if err != nil {
		return SyncFreshness{}, &SyncError{Kind: SyncTemporary, RetryAfter: response.retryAfter}
	}
	if response.status != http.StatusOK {
		return SyncFreshness{}, syncFailure(response)
	}
	var payload struct {
		Item struct {
			ID    string          `json:"item_id"`
			Error json.RawMessage `json:"error"`
		} `json:"item"`
		Status struct {
			Transactions struct {
				Success *time.Time `json:"last_successful_update"`
				Failed  *time.Time `json:"last_failed_update"`
			} `json:"transactions"`
		} `json:"status"`
		ErrorCode string `json:"error_code"`
	}
	if json.Unmarshal(response.body, &payload) != nil || payload.Item.ID != binding.ItemID || payload.ErrorCode != "" {
		return SyncFreshness{}, &SyncError{Kind: SyncInvalidResponse}
	}
	if len(payload.Item.Error) > 0 && string(payload.Item.Error) != "null" {
		return SyncFreshness{}, syncFailure(plaidResponse{status: http.StatusBadRequest, body: payload.Item.Error, retryAfter: response.retryAfter})
	}
	return SyncFreshness{payload.Status.Transactions.Success, payload.Status.Transactions.Failed}, nil
}

func syncFailure(response plaidResponse) *SyncError {
	failure := &SyncError{Kind: SyncRejected, RetryAfter: response.retryAfter}
	var payload struct {
		Code string `json:"error_code"`
	}
	_ = json.Unmarshal(response.body, &payload)
	switch {
	case response.status == http.StatusTooManyRequests:
		failure.Kind = SyncRateLimited
	case response.status >= 500:
		failure.Kind = SyncTemporary
	case response.status == http.StatusBadRequest:
		switch payload.Code {
		case "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION":
			failure.Kind = SyncPaginationMutation
		case "PRODUCT_NOT_READY":
			failure.Kind = SyncNotReady
		case "ITEM_LOGIN_REQUIRED", "ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN", "ACCESS_NOT_GRANTED", "NO_ACCOUNTS", "INSUFFICIENT_CREDENTIALS", "USER_PERMISSION_REVOKED", "USER_ACCOUNT_REVOKED":
			failure.Kind = SyncReconnect
		case "INSTITUTION_DOWN", "INSTITUTION_NOT_RESPONDING", "INSTITUTION_NOT_AVAILABLE", "INTERNAL_SERVER_ERROR":
			failure.Kind = SyncTemporary
		}
	}
	return failure
}
