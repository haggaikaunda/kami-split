package auth

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
)

const maxKeyAge = 2 * time.Hour

// Outcome is a safe internal failure category; it contains no provider or database detail.
type Outcome string

// These outcomes keep credentials, current application access, and infrastructure failures distinct.
const (
	Unauthenticated Outcome = "UNAUTHENTICATED"
	Unavailable     Outcome = "UNAVAILABLE"
	Disabled        Outcome = "DISABLED"
	Unprovisioned   Outcome = "UNPROVISIONED"
)

// Error returns only the safe outcome code.
func (o Outcome) Error() string { return string(o) }

type keySet struct {
	keys keyfunc.Keyfunc
	ids  map[string]bool
}

// Verifier owns a synchronized, replace-only public-key cache. It caches no application authorization.
// Call Warm before protected readiness, Run for refresh, and cancel Run on shutdown.
type Verifier struct {
	config      Config
	now         func() time.Time
	fetch       func(context.Context) ([]byte, error)
	jitter      func() time.Duration
	mu          sync.Mutex
	set         keySet
	success     time.Time
	nextAttempt time.Time
	scheduled   time.Time
	failures    int
	lastFailed  bool
	lastError   error
	epoch       uint64
	refreshing  chan struct{}
}

// New validates trusted configuration without I/O. All fetches have a five-second
// deadline, a 64 KiB response limit, and no redirects to other trust endpoints.
func New(c Config) (*Verifier, error) {
	if err := c.validate(); err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect refused") }}
	v := &Verifier{config: c, now: time.Now, jitter: refreshJitter}
	v.fetch = func(ctx context.Context) ([]byte, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.JWKSURL, nil)
		if err != nil {
			return nil, diagnostic.Wrap(Unavailable, err, "auth.jwks_request")
		}
		response, err := client.Do(req)
		if err != nil {
			return nil, diagnostic.Wrap(Unavailable, err, "auth.jwks_fetch")
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return nil, diagnostic.Wrap(Unavailable, nil, "auth.jwks_status")
		}
		body, err := io.ReadAll(io.LimitReader(response.Body, (64<<10)+1))
		if err != nil || len(body) > 64<<10 {
			return nil, diagnostic.Wrap(Unavailable, err, "auth.jwks_body")
		}
		return body, nil
	}
	return v, nil
}

func refreshJitter() time.Duration {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return 0
	}
	return time.Duration(binary.LittleEndian.Uint64(b[:])%uint64(10*time.Minute+1)) - 5*time.Minute
}

// Warm coordinates the initial key load; failure leaves protected readiness unavailable.
func (v *Verifier) Warm(ctx context.Context) error { return v.refresh(ctx) }

// Ready checks cache age locally and never extends trust because a fetch failed.
func (v *Verifier) Ready(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return Unavailable
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if !v.usable(v.now()) {
		return Unavailable
	}
	return nil
}

func (v *Verifier) usable(now time.Time) bool {
	return len(v.set.ids) > 0 && !v.success.IsZero() && now.Sub(v.success) < maxKeyAge
}

// Invalidate immediately discards local keys, including any fetch already in flight.
// This is a local emergency action, not a promise of upstream/global revocation.
func (v *Verifier) Invalidate() {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.epoch++
	v.set = keySet{}
	v.success = time.Time{}
	v.nextAttempt = time.Time{}
	v.scheduled = time.Time{}
	v.failures = 0
	v.lastFailed = false
	v.lastError = nil
}

// Run refreshes hourly with up to five minutes of jitter and retries failed fetches
// with bounded backoff. It owns no detached goroutines and returns after cancellation.
func (v *Verifier) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			v.refreshDue(ctx)
		}
	}
}

func (v *Verifier) refreshDue(ctx context.Context) {
	v.mu.Lock()
	due := !v.now().Before(v.scheduled) && !v.now().Before(v.nextAttempt)
	v.mu.Unlock()
	if due {
		_ = v.refresh(ctx)
	}
}

func (v *Verifier) refresh(ctx context.Context) error {
	v.mu.Lock()
	if running := v.refreshing; running != nil {
		v.mu.Unlock()
		select {
		case <-ctx.Done():
			return Unavailable
		case <-running:
		}
		v.mu.Lock()
		defer v.mu.Unlock()
		if v.lastFailed || !v.usable(v.now()) {
			if v.lastError != nil {
				return v.lastError
			}
			return Unavailable
		}
		return nil
	}
	if v.now().Before(v.nextAttempt) {
		failed := v.lastFailed || !v.usable(v.now())
		lastError := v.lastError
		v.mu.Unlock()
		if failed {
			if lastError != nil {
				return lastError
			}
			return Unavailable
		}
		return nil
	}
	epoch := v.epoch
	done := make(chan struct{})
	v.refreshing = done
	v.mu.Unlock()
	bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
	body, err := v.fetch(bounded)
	cancel()
	var set keySet
	if err == nil {
		set, err = parseSet(body)
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	defer close(done)
	v.refreshing = nil
	if epoch != v.epoch {
		return Unavailable
	}
	now := v.now()
	if err != nil {
		v.failures++
		v.lastFailed = true
		if _, ok := diagnostic.Operation(err); !ok {
			err = diagnostic.Wrap(Unavailable, err, "auth.jwks_refresh")
		}
		v.lastError = err
		backoff := time.Second << min(v.failures-1, 9)
		if backoff > 5*time.Minute {
			backoff = 5 * time.Minute
		}
		v.nextAttempt = now.Add(backoff)
		v.scheduled = v.nextAttempt
		return err
	}
	v.set = set
	v.success = now
	v.failures = 0
	v.lastFailed = false
	v.lastError = nil
	// All successful fetches rate-limit unknown-key probes across every request.
	v.nextAttempt = now.Add(30 * time.Second)
	v.scheduled = now.Add(time.Hour + v.jitter())
	if !v.usable(now) {
		v.lastError = diagnostic.Wrap(Unavailable, nil, "auth.jwks_keys")
		return v.lastError
	}
	return nil
}

func parseSet(body []byte) (keySet, error) {
	var document struct {
		Keys []struct {
			KID string `json:"kid"`
			KTY string `json:"kty"`
			CRV string `json:"crv"`
			ALG string `json:"alg"`
			USE string `json:"use"`
			D   string `json:"d"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(body, &document); err != nil || document.Keys == nil {
		return keySet{}, diagnostic.Wrap(Unavailable, err, "auth.jwks_document")
	}
	ids := make(map[string]bool, len(document.Keys))
	for _, key := range document.Keys {
		if key.KID == "" || len(key.KID) > 256 || ids[key.KID] || key.KTY != "EC" || key.CRV != "P-256" || (key.ALG != "" && key.ALG != "ES256") || (key.USE != "" && key.USE != "sig") || key.D != "" {
			return keySet{}, diagnostic.Wrap(Unavailable, nil, "auth.jwks_keys")
		}
		ids[key.KID] = true
	}
	keys, err := keyfunc.NewJWKSetJSON(body)
	if err != nil {
		return keySet{}, diagnostic.Wrap(Unavailable, err, "auth.jwks_keys")
	}
	return keySet{keys: keys, ids: ids}, nil
}

func (v *Verifier) lookup(ctx context.Context, token *jwt.Token) (any, error) {
	kid, ok := token.Header["kid"].(string)
	if !ok || kid == "" || len(kid) > 256 {
		return nil, Unauthenticated
	}
	v.mu.Lock()
	known := v.set.ids[kid] && v.usable(v.now())
	v.mu.Unlock()
	if !known {
		if err := v.refresh(ctx); err != nil {
			return nil, err
		}
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if !v.usable(v.now()) {
		return nil, Unavailable
	}
	if !v.set.ids[kid] {
		return nil, Unauthenticated
	}
	key, err := v.set.keys.KeyfuncCtx(ctx)(token)
	if err != nil {
		return nil, Unauthenticated
	}
	return key, nil
}
