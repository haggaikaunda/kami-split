package onboarding

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/invitation"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
)

type browserContext struct {
	cipher         []byte
	version, state string
	expires        time.Time
}
type budget struct {
	until time.Time
	count int
}

// Handler owns short-lived encrypted browser contexts and bounded local abuse
// budgets. Restart/multiple-instance loss fails closed and requires reopening the
// invitation. It holds privileged Auth credentials only for eligible provisioning.
type Handler struct {
	factory          *Factory
	verifier         *auth.Verifier
	origin, adminKey string
	client           *http.Client
	mu               sync.Mutex
	contexts         map[string]browserContext
	budgets          map[string]budget
}

// NewHandler requires a configured origin and isolated server-only Auth key.
func NewHandler(f *Factory, v *auth.Verifier, origin, adminKey string) (*Handler, error) {
	if f == nil || f.Sender == nil || v == nil || adminKey == "" || origin != f.Sender.origin {
		return nil, invitation.Unavailable
	}
	return &Handler{factory: f, verifier: v, origin: origin, adminKey: adminKey, client: &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, contexts: map[string]browserContext{}, budgets: map[string]budget{}}, nil
}

// Run removes expired capability ciphertext and budgets once per minute. The
// caller owns cancellation and joins this loop during shutdown.
func (h *Handler) Run(ctx context.Context) {
	timer := time.NewTicker(time.Minute)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			h.mu.Lock()
			h.prune(time.Now())
			h.mu.Unlock()
		}
	}
}
func (h *Handler) prune(now time.Time) {
	for k, v := range h.contexts {
		if !now.Before(v.expires) {
			delete(h.contexts, k)
		}
	}
	for k, v := range h.budgets {
		if !now.Before(v.until) {
			delete(h.budgets, k)
		}
	}
}
func (h *Handler) allow(key string, limit int) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := time.Now()
	h.prune(now)
	b := h.budgets[key]
	if b.until.IsZero() {
		if len(h.budgets) >= 4096 {
			return false
		}
		b.until = now.Add(time.Minute)
	}
	if b.count >= limit {
		return false
	}
	b.count++
	h.budgets[key] = b
	return true
}

// Wrap attaches request email evidence and limits direct GraphQL requests as well
// as public context/provider endpoints. No forwarded IP/header is trusted.
func (h *Handler) Wrap(next http.Handler) http.Handler {
	handler := Request(h.verifier.Authenticate(http.HandlerFunc(h.serve)))
	return Request(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/graphql" || strings.HasPrefix(r.URL.Path, "/onboarding/") {
			host, _, _ := net.SplitHostPort(r.RemoteAddr)
			if !h.allow("ip:"+host, 120) {
				w.Header().Set("Retry-After", "60")
				http.Error(w, "Try again shortly.", 429)
				return
			}
		}
		if strings.HasPrefix(r.URL.Path, "/onboarding/") {
			handler.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, r)
	}))
}
func randomContext() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}
func (h *Handler) read(r *http.Request) (string, browserContext, bool) {
	cookie, err := r.Cookie("kami_onboarding")
	if err != nil {
		return "", browserContext{}, false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	c, ok := h.contexts[cookie.Value]
	if !ok || !time.Now().Before(c.expires) {
		delete(h.contexts, cookie.Value)
		return "", browserContext{}, false
	}
	return cookie.Value, c, true
}
func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func safeOutcome(err error) string {
	var domain invitation.Outcome
	var identity auth.Outcome
	if errors.As(err, &domain) {
		switch string(domain) {
		case "INVALID_INPUT", "UNAVAILABLE_LINK", "NOT_CLAIMABLE", "ACCESS_DENIED":
			return string(domain)
		}
	}
	if errors.As(err, &identity) {
		switch string(identity) {
		case "DISABLED":
			return "ACCESS_DISABLED"
		case "UNAUTHENTICATED", "VERIFY_EMAIL":
			return string(identity)
		}
	}
	return "UNAVAILABLE"
}
func (h *Handler) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if r.Method != http.MethodPost {
		respond(w, 405, map[string]string{"code": "METHOD_NOT_ALLOWED"})
		return
	}
	if r.Header.Get("Origin") != h.origin || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		respond(w, 403, map[string]string{"code": "INVALID_ORIGIN"})
		return
	}
	var in struct {
		Token       string `json:"token"`
		Email       string `json:"email"`
		Key         string `json:"key"`
		State       string `json:"state"`
		TokenDigest string `json:"tokenDigest"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&in) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		respond(w, 400, map[string]string{"code": "INVALID_INPUT"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	r = r.WithContext(ctx)
	service, err := h.factory.Service(ctx)
	if err != nil {
		respond(w, 503, map[string]string{"code": "UNAVAILABLE"})
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/onboarding/")
	if path == "start" {
		if in.Token != "" {
			if _, err := service.Preview(ctx, in.Token); err != nil {
				respond(w, 400, map[string]string{"code": "UNAVAILABLE_LINK"})
				return
			}
		}
		id, err := randomContext()
		if err != nil {
			respond(w, 503, map[string]string{"code": "UNAVAILABLE"})
			return
		}
		state, err := randomContext()
		if err != nil {
			respond(w, 503, map[string]string{"code": "UNAVAILABLE"})
			return
		}
		cipher, version, err := h.factory.protector.Encrypt([]byte(in.Token), "BROWSER:"+id)
		if err != nil {
			respond(w, 503, map[string]string{"code": "UNAVAILABLE"})
			return
		}
		h.mu.Lock()
		h.prune(time.Now())
		full := len(h.contexts) >= 2048
		if !full {
			if old, e := r.Cookie("kami_onboarding"); e == nil {
				delete(h.contexts, old.Value)
			}
			h.contexts[id] = browserContext{cipher, version, state, time.Now().Add(15 * time.Minute)}
		}
		h.mu.Unlock()
		if full {
			respond(w, 429, map[string]string{"code": "RATE_LIMITED"})
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "kami_onboarding", Value: id, Path: "/", HttpOnly: true, Secure: strings.HasPrefix(h.origin, "https://"), SameSite: http.SameSiteStrictMode, MaxAge: 900})
		respond(w, 200, map[string]string{"code": "READY"})
		return
	}
	id, current, ok := h.read(r)
	if !ok {
		respond(w, 409, map[string]string{"code": "CONTEXT_EXPIRED"})
		return
	}
	if path == "clear" {
		h.mu.Lock()
		delete(h.contexts, id)
		h.mu.Unlock()
		// Do not delete the cookie in a delayed response: it could overwrite a
		// newer context cookie. The old opaque ID has no live server state.
		respond(w, 200, map[string]string{"code": "CLEARED"})
		return
	}
	token, err := h.factory.protector.Decrypt(current.cipher, current.version, "BROWSER:"+id)
	if err != nil {
		respond(w, 503, map[string]string{"code": "UNAVAILABLE"})
		return
	}
	if path == "accept" {
		if err := auth.RequireRequest(ctx); err != nil {
			respond(w, 401, map[string]string{"code": safeOutcome(err)})
			return
		}
	}
	if path == "accept" || path == "provision" {
		// Bind this tab's explicit action to its original capability. A shared
		// browser cookie may have been replaced by another tab's invitation.
		expected := hex.EncodeToString(invitation.TokenHash(string(token)))
		if expected == "" || subtle.ConstantTimeCompare([]byte(in.TokenDigest), []byte(expected)) != 1 {
			respond(w, 409, map[string]string{"code": "ORIGINAL_LINK_REQUIRED"})
			return
		}
	}
	switch path {
	case "preview":
		p, err := service.Preview(ctx, string(token))
		if err != nil {
			respond(w, 400, map[string]string{"code": "UNAVAILABLE_LINK"})
			return
		}
		respond(w, 200, map[string]string{"groupName": p.GroupName, "inviterDisplayName": p.InviterName})
	case "callback-state":
		// Consume under the same lock used by start/clear, before Auth verification.
		h.mu.Lock()
		latest, exists := h.contexts[id]
		valid := exists && in.State != "" && latest.state == in.State && latest.state == current.state
		if valid {
			latest.state = ""
			h.contexts[id] = latest
		}
		h.mu.Unlock()
		if !valid {
			respond(w, 400, map[string]string{"code": "INVALID_CALLBACK"})
			return
		}
		respond(w, 200, map[string]string{"code": "READY"})
	case "provision", "recover":
		// Same response shape for new/existing/ineligible accounts and provider errors.
		generic := map[string]string{"code": "CHECK_EMAIL", "message": "If this address is eligible, check your email. Existing accounts can sign in or reset their password."}
		email, err := auth.CanonicalEmail(in.Email)
		if err != nil {
			respond(w, 200, generic)
			return
		}
		digest, err := h.factory.protector.ActionDigest([]byte("provider:"+email), "")
		if err != nil {
			respond(w, 200, generic)
			return
		}
		if !h.allow("email:"+base64.RawURLEncoding.EncodeToString(digest), 2) || !h.allow("provider", 20) {
			respond(w, 200, generic)
			return
		}
		if path == "provision" {
			eligible, err := service.Eligible(ctx, string(token), email)
			if err != nil || !eligible {
				respond(w, 200, generic)
				return
			}
		}
		state, err := randomContext()
		if err != nil {
			respond(w, 200, generic)
			return
		}
		h.mu.Lock()
		latest, exists := h.contexts[id]
		if exists {
			latest.state = state
			h.contexts[id] = latest
		}
		h.mu.Unlock()
		if !exists {
			respond(w, 200, generic)
			return
		}
		endpoint := "/recover"
		bearer := h.factory.apiKey
		if path == "provision" {
			endpoint = "/invite"
			bearer = h.adminKey
		}
		body, _ := json.Marshal(map[string]string{"email": email})
		endpoint += "?redirect_to=" + url.QueryEscape(h.origin+"/auth/confirm#state="+state)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.factory.authURL+endpoint, bytes.NewReader(body))
		if err == nil {
			req.Header.Set("apikey", h.factory.apiKey)
			req.Header.Set("Authorization", "Bearer "+bearer)
			req.Header.Set("Content-Type", "application/json")
			response, sendErr := h.client.Do(req)
			if sendErr == nil {
				_ = response.Body.Close()
			}
		}
		respond(w, 200, generic)
	case "accept":
		var key ledger.OperationKey
		if key.UnmarshalGQL(in.Key) != nil {
			respond(w, 400, map[string]string{"code": "INVALID_INPUT"})
			return
		}
		result, err := service.Accept(ctx, string(token), uuid.MustParse(string(key)))
		if err != nil {
			respond(w, 400, map[string]string{"code": safeOutcome(err)})
			return
		}
		group := ""
		if result.GroupID != uuid.Nil {
			group = ledger.PublicID("Group", result.GroupID.String())
		}
		respond(w, 200, map[string]any{"code": result.Outcome, "groupID": group, "hasAccess": result.HasAccess})
	default:
		respond(w, 404, map[string]string{"code": "NOT_FOUND"})
	}
}

// String redacts privileged Auth material and sensitive browser contexts.
func (*Handler) String() string { return "[redacted onboarding handler]" }

// GoString redacts Go-syntax diagnostics too.
func (h *Handler) GoString() string { return h.String() }
