package banking

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
)

// ErrWebhookMismatch tells ingress that a verified event does not match the
// durable correlation's environment/Item. It must not be durably accepted.
var ErrWebhookMismatch = errors.New("banking webhook target mismatch")

// VerifiedWebhook contains only authenticated routing metadata and a digest for
// deduplication, never the raw body, transaction facts or provider error text.
// The acceptor must compare Environment and ItemID against its locked durable
// correlation and preserve terminal generations. Verification alone dispatches
// no lifecycle action and grants no collection authority.
type VerifiedWebhook struct {
	Environment string
	ItemID      string
	WebhookType string
	WebhookCode string
	AccountID   string
	Revoked     bool
	BodySHA256  [32]byte
	IssuedAt    time.Time
}

// WebhookAcceptor owns durable ingress and target/lifecycle validation. A nil
// result means the event, including a duplicate, has been durably accepted.
// Unimplemented downstream lifecycle handling must not claim completion.
type WebhookAcceptor interface {
	AcceptWebhook(context.Context, uuid.UUID, VerifiedWebhook) error
}

type verificationKey struct {
	public  *ecdsa.PublicKey
	expires time.Time
	cached  time.Time
}

// WebhookVerifier is the sole Plaid signature/body verifier, scoped to one
// provider environment. Its bounded 16-key cache expires after one hour or the
// provider's explicit expiration, whichever is earlier. Negative lookups have a
// separate bounded cache and never suppress unrelated key refreshes. Calls are
// concurrency-safe, with one provider key request in flight per verifier.
type WebhookVerifier struct {
	provider *PlaidProvider
	now      func() time.Time
	keyLock  chan struct{}
	keys     map[string]verificationKey
	rejected map[string]time.Time
	retryAt  time.Time
}

// NewWebhookVerifier binds verification to an explicitly configured protected
// provider. An optional injected clock supports expiration tests.
func NewWebhookVerifier(provider *PlaidProvider, now func() time.Time) (*WebhookVerifier, error) {
	if provider == nil {
		return nil, errors.New("invalid banking webhook configuration")
	}
	if now == nil {
		now = time.Now
	}
	return &WebhookVerifier{provider: provider, now: now, keys: make(map[string]verificationKey), rejected: make(map[string]time.Time), keyLock: make(chan struct{}, 1)}, nil
}

type webhookClaims struct {
	jwt.RegisteredClaims
	BodyHash string `json:"request_body_sha256"`
}

// Verify authenticates the exact raw bytes, ES256 signature and a required iat
// no older than five minutes and never in the future. It validates the signed
// environment and required Item metadata before returning minimal routing data.
// The consumer must still validate the correlation's exact expected Item.
func (v *WebhookVerifier) Verify(ctx context.Context, signed string, raw []byte) (VerifiedWebhook, error) {
	if len(signed) == 0 || len(signed) > 8192 || len(raw) > 64*1024 {
		return VerifiedWebhook{}, ErrWebhookMismatch
	}
	claims := new(webhookClaims)
	now := v.now()
	var keyFailure error
	token, err := jwt.ParseWithClaims(signed, claims, func(token *jwt.Token) (any, error) {
		kid, ok := token.Header["kid"].(string)
		if !ok || kid == "" || len(kid) > 128 || token.Method != jwt.SigningMethodES256 {
			return nil, ErrWebhookMismatch
		}
		key, err := v.key(ctx, kid)
		if err != nil && !errors.Is(err, ErrWebhookMismatch) {
			keyFailure = err
		}
		return key, err
	}, jwt.WithValidMethods([]string{"ES256"}), jwt.WithTimeFunc(func() time.Time { return now }), jwt.WithIssuedAt())
	if err != nil || !token.Valid {
		if keyFailure != nil {
			return VerifiedWebhook{}, keyFailure
		}
		return VerifiedWebhook{}, ErrWebhookMismatch
	}
	now = v.now()
	if claims.IssuedAt == nil || claims.IssuedAt.Time.After(now) || now.Sub(claims.IssuedAt.Time) > 5*time.Minute {
		return VerifiedWebhook{}, ErrWebhookMismatch
	}
	expected, err := hex.DecodeString(claims.BodyHash)
	digest := sha256.Sum256(raw)
	if err != nil || len(expected) != len(digest) || subtle.ConstantTimeCompare(expected, digest[:]) != 1 {
		return VerifiedWebhook{}, ErrWebhookMismatch
	}
	var payload struct {
		Environment string `json:"environment"`
		ItemID      string `json:"item_id"`
		Type        string `json:"webhook_type"`
		Code        string `json:"webhook_code"`
		AccountID   string `json:"account_id"`
		Error       struct {
			Reason string `json:"error_code_reason"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &payload) != nil || payload.Environment != v.provider.config.Environment || !webhookField(payload.ItemID) || !webhookField(payload.Type) || !webhookField(payload.Code) {
		return VerifiedWebhook{}, ErrWebhookMismatch
	}
	if payload.Code == "USER_ACCOUNT_REVOKED" && !webhookField(payload.AccountID) {
		return VerifiedWebhook{}, ErrWebhookMismatch
	}
	return VerifiedWebhook{AccountID: payload.AccountID, Revoked: payload.Error.Reason == "OAUTH_USER_REVOKED", Environment: payload.Environment, ItemID: payload.ItemID, WebhookType: payload.Type, WebhookCode: payload.Code, BodySHA256: digest, IssuedAt: claims.IssuedAt.Time}, nil
}

func webhookField(value string) bool {
	return len(value) > 0 && len(value) <= 256 && strings.TrimSpace(value) == value
}

func (v *WebhookVerifier) key(ctx context.Context, kid string) (*ecdsa.PublicKey, error) {
	select {
	case v.keyLock <- struct{}{}:
		defer func() { <-v.keyLock }()
	case <-ctx.Done():
		if errors.Is(ctx.Err(), context.Canceled) {
			return nil, ctx.Err()
		}
		return nil, webhookVerificationFailure(ctx.Err())
	}
	now := v.now()
	for id, key := range v.keys {
		if !now.Before(key.expires) {
			delete(v.keys, id)
		}
	}
	for id, until := range v.rejected {
		if !now.Before(until) {
			delete(v.rejected, id)
		}
	}
	if key, ok := v.keys[kid]; ok {
		return key.public, nil
	}
	if _, rejected := v.rejected[kid]; rejected {
		return nil, ErrWebhookMismatch
	}
	if now.Before(v.retryAt) {
		return nil, webhookVerificationFailure(nil)
	}
	request, _ := json.Marshal(struct {
		KeyID string `json:"key_id"`
	}{kid})
	response, err := v.provider.post(ctx, "/webhook_verification_key/get", request)
	if err != nil || response.status != http.StatusOK {
		// Client cancellation is local to this request, not provider-wide failure.
		if errors.Is(ctx.Err(), context.Canceled) {
			return nil, ctx.Err()
		}
		delay := time.Minute
		if response.retryAfter > delay {
			delay = response.retryAfter
		}
		until := v.now().Add(delay)
		if err == nil && response.status == http.StatusBadRequest {
			// An unsigned caller selects kid. Cache only this negative result; a global
			// cooldown here would let unknown IDs starve cold, expired or rotated keys.
			v.rejectKey(kid, until)
			return nil, ErrWebhookMismatch
		}
		v.retryAt = until
		return nil, webhookVerificationFailure(err)
	}

	now = v.now()
	var payload struct {
		Key struct {
			Algorithm string `json:"alg"`
			Curve     string `json:"crv"`
			ID        string `json:"kid"`
			Type      string `json:"kty"`
			Use       string `json:"use"`
			X         string `json:"x"`
			Y         string `json:"y"`
			CreatedAt int64  `json:"created_at"`
			ExpiredAt *int64 `json:"expired_at"`
		} `json:"key"`
	}
	if json.Unmarshal(response.body, &payload) != nil {
		return nil, ErrWebhookMismatch
	}
	key := payload.Key
	expires := now.Add(time.Hour)
	if key.ExpiredAt != nil {
		expiration := time.Unix(*key.ExpiredAt, 0)
		if !now.Before(expiration) {
			return nil, ErrWebhookMismatch
		}
		if expiration.Before(expires) {
			expires = expiration
		}
	}
	x, xerr := base64.RawURLEncoding.DecodeString(key.X)
	y, yerr := base64.RawURLEncoding.DecodeString(key.Y)
	public := &ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).SetBytes(x), Y: new(big.Int).SetBytes(y)}
	if key.Algorithm != "ES256" || key.Curve != "P-256" || key.Type != "EC" || key.Use != "sig" || key.ID != kid || key.CreatedAt > now.Unix() || xerr != nil || yerr != nil || len(x) != 32 || len(y) != 32 || !public.Curve.IsOnCurve(public.X, public.Y) {
		return nil, ErrWebhookMismatch
	}
	if len(v.keys) >= 16 {
		var oldest string
		var cached time.Time
		for id, entry := range v.keys {
			if oldest == "" || entry.cached.Before(cached) {
				oldest = id
				cached = entry.cached
			}
		}
		delete(v.keys, oldest)
	}
	v.keys[kid] = verificationKey{public: public, expires: expires, cached: now}
	return public, nil
}

// rejectKey runs under keyLock. Negative entries cannot evict trusted keys or
// grow with attacker-selected IDs; Retry-After applies only to this rejected ID.
func (v *WebhookVerifier) rejectKey(kid string, until time.Time) {
	if len(v.rejected) >= 16 {
		var earliest string
		for id, expires := range v.rejected {
			if earliest == "" || expires.Before(v.rejected[earliest]) {
				earliest = id
			}
		}
		delete(v.rejected, earliest)
	}
	v.rejected[kid] = until
}
func webhookVerificationFailure(cause error) error {
	return diagnostic.Wrap(errors.New("banking webhook verification unavailable"), cause, "banking.webhook_verify")
}

// WebhookHandler provides only POST /banking/webhooks/{opaque correlation UUID}.
// It bounds the body and request context, returns 400 for invalid/mismatched
// events and 503 for unavailable verification/storage, and ACKs durable acceptance.
type WebhookHandler struct {
	verifier *WebhookVerifier
	acceptor WebhookAcceptor
}

// NewWebhookHandler requires the verifier and a durable acceptor. The owning
// server mounts this handler explicitly; construction enables no enrollment.
func NewWebhookHandler(verifier *WebhookVerifier, acceptor WebhookAcceptor) (*WebhookHandler, error) {
	if verifier == nil || acceptor == nil {
		return nil, errors.New("invalid banking webhook configuration")
	}
	return &WebhookHandler{verifier: verifier, acceptor: acceptor}, nil
}

// ServeHTTP does not persist unverified bodies or expose provider/storage errors.
func (h *WebhookHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/banking/webhooks/")
	correlation, err := uuid.Parse(path)
	if path == r.URL.Path || err != nil || correlation == uuid.Nil || correlation.String() != path {
		http.Error(w, "invalid webhook", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	// Bound slow request bodies at the transport too; request cancellation alone
	// cannot interrupt a blocked Body.Read. Unsupported recorder writers are safe
	// in tests; the production net/http server implements the read deadline.
	_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(8 * time.Second))
	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "invalid webhook", http.StatusBadRequest)
		return
	}
	event, err := h.verifier.Verify(ctx, r.Header.Get("Plaid-Verification"), raw)
	if err != nil {
		// The transport consumes verifier infrastructure failures. Expected
		// signature/key mismatches have no classification and stay quiet.
		diagnostic.Report(ctx, err)
	} else {
		// The durable acceptor owns its storage diagnostics; do not report the
		// returned failure again at this boundary.
		err = h.acceptor.AcceptWebhook(ctx, correlation, event)
	}
	if err != nil {
		status := http.StatusServiceUnavailable
		if errors.Is(err, ErrWebhookMismatch) {
			status = http.StatusBadRequest
		}
		http.Error(w, "webhook unavailable", status)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
