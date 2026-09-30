package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/golang-jwt/jwt/v5"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func cacheFixture(t *testing.T, ids ...string) []byte {
	t.Helper()
	keys := make([]map[string]string, 0, len(ids))
	for _, id := range ids {
		k, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if e != nil {
			t.Fatal(e)
		}
		keys = append(keys, map[string]string{"kid": id, "kty": "EC", "crv": "P-256", "alg": "ES256", "use": "sig", "x": base64.RawURLEncoding.EncodeToString(k.X.FillBytes(make([]byte, 32))), "y": base64.RawURLEncoding.EncodeToString(k.Y.FillBytes(make([]byte, 32)))})
	}
	b, e := json.Marshal(map[string]any{"keys": keys})
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func cacheToken(id string) *jwt.Token {
	v := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{})
	v.Header["kid"] = id
	return v
}
func TestCacheWarmAgeAndScheduledRefresh(t *testing.T) {
	now := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	calls := 0
	body := cacheFixture(t, "a")
	v := &Verifier{now: func() time.Time { return now }, jitter: func() time.Duration { return 3 * time.Minute }, fetch: func(context.Context) ([]byte, error) { calls++; return body, nil }}
	ctx := context.Background()
	if !errors.Is(v.Ready(ctx), Unavailable) {
		t.Fatal("cold ready")
	}
	if e := v.Warm(ctx); e != nil {
		t.Fatal(e)
	}
	loaded := now
	now = loaded.Add(time.Hour + 3*time.Minute - time.Nanosecond)
	v.refreshDue(ctx)
	if calls != 1 {
		t.Fatal("early refresh")
	}
	now = now.Add(time.Nanosecond)
	v.refreshDue(ctx)
	if calls != 2 {
		t.Fatal("missing scheduled refresh")
	}
	loaded = now
	now = loaded.Add(maxKeyAge - time.Nanosecond)
	if e := v.Ready(ctx); e != nil {
		t.Fatal(e)
	}
	now = loaded.Add(maxKeyAge)
	if !errors.Is(v.Ready(ctx), Unavailable) {
		t.Fatal("stale ready")
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if !errors.Is(v.Ready(canceled), Unavailable) {
		t.Fatal("ignored cancellation")
	}
}
func TestCacheReplacementAndRateLimit(t *testing.T) {
	now := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	body := cacheFixture(t, "old")
	calls := 0
	v := &Verifier{now: func() time.Time { return now }, jitter: func() time.Duration { return 0 }, fetch: func(context.Context) ([]byte, error) { calls++; return body, nil }}
	ctx := context.Background()
	if e := v.Warm(ctx); e != nil {
		t.Fatal(e)
	}
	if _, e := v.lookup(ctx, cacheToken("old")); e != nil {
		t.Fatal(e)
	}
	if _, e := v.lookup(ctx, cacheToken("new")); !errors.Is(e, Unauthenticated) {
		t.Fatal(e)
	}
	if calls != 1 {
		t.Fatal("rate limit bypassed")
	}
	body = cacheFixture(t, "new")
	now = now.Add(30 * time.Second)
	if _, e := v.lookup(ctx, cacheToken("new")); e != nil {
		t.Fatal(e)
	}
	if _, e := v.lookup(ctx, cacheToken("old")); !errors.Is(e, Unauthenticated) {
		t.Fatal("removed key accepted", e)
	}
	if calls != 2 {
		t.Fatal("unbounded probe")
	}
	body = cacheFixture(t)
	now = now.Add(30 * time.Second)
	if !errors.Is(v.Warm(ctx), Unavailable) {
		t.Fatal("empty set usable")
	}
	if !errors.Is(v.Ready(ctx), Unavailable) {
		t.Fatal("empty set retained old trust")
	}
}
func TestCacheFailuresPreserveAgeAndBoundBackoff(t *testing.T) {
	now := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	body := cacheFixture(t, "a")
	failed := false
	calls := 0
	v := &Verifier{now: func() time.Time { return now }, jitter: func() time.Duration { return 0 }, fetch: func(context.Context) ([]byte, error) {
		calls++
		if failed {
			return nil, errors.New("provider detail")
		}
		return body, nil
	}}
	ctx := context.Background()
	if e := v.Warm(ctx); e != nil {
		t.Fatal(e)
	}
	success := now
	failed = true
	now = now.Add(time.Hour)
	for n := 0; n < 12; n++ {
		if !errors.Is(v.Warm(ctx), Unavailable) {
			t.Fatal("failure hidden")
		}
		if v.success != success {
			t.Fatal("extended trust")
		}
		delay := time.Second << min(n, 9)
		if delay > 5*time.Minute {
			delay = 5 * time.Minute
		}
		if v.nextAttempt.Sub(now) != delay {
			t.Fatalf("backoff %d = %v", n, v.nextAttempt.Sub(now))
		}
		prior := calls
		now = now.Add(delay - time.Nanosecond)
		v.refreshDue(ctx)
		if calls != prior {
			t.Fatal("retry bypass")
		}
		now = now.Add(time.Nanosecond)
	}
	now = success.Add(maxKeyAge)
	if !errors.Is(v.Ready(ctx), Unavailable) {
		t.Fatal("extended stale trust")
	}
	failed = false
	if e := v.Warm(ctx); e != nil {
		t.Fatal(e)
	}
	if v.failures != 0 || v.lastFailed {
		t.Fatal("backoff not reset")
	}
}
func TestCacheConcurrentUnknownKeysShareFetch(t *testing.T) {
	now := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	body := cacheFixture(t, "a")
	var calls atomic.Int32
	started, release := make(chan struct{}), make(chan struct{})
	v := &Verifier{now: func() time.Time { return now }, jitter: func() time.Duration { return 0 }, fetch: func(ctx context.Context) ([]byte, error) {
		if calls.Add(1) == 2 {
			close(started)
			select {
			case <-release:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		return body, nil
	}}
	ctx := context.Background()
	if e := v.Warm(ctx); e != nil {
		t.Fatal(e)
	}
	now = now.Add(30 * time.Second)
	body = cacheFixture(t, "b")
	var wg sync.WaitGroup
	errs := make(chan error, 32)
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, e := v.lookup(ctx, cacheToken("b")); errs <- e }()
	}
	<-started
	close(release)
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	if calls.Load() != 2 {
		t.Fatal("uncoordinated refresh", calls.Load())
	}
}
func TestCacheCanceledWaiterAndFailedFetch(t *testing.T) {
	now := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	started, release := make(chan struct{}), make(chan struct{})
	v := &Verifier{now: func() time.Time { return now }, jitter: func() time.Duration { return 0 }, fetch: func(ctx context.Context) ([]byte, error) {
		if d, ok := ctx.Deadline(); !ok || time.Until(d) > 5*time.Second {
			t.Error("unbounded fetch")
		}
		close(started)
		<-release
		return nil, errors.New("secret upstream diagnostic")
	}}
	done := make(chan error, 1)
	go func() { done <- v.Warm(context.Background()) }()
	<-started
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if !errors.Is(v.Warm(ctx), Unavailable) {
		t.Fatal("waiter cancellation ignored")
	}
	close(release)
	if e := <-done; !errors.Is(e, Unavailable) || e.Error() != "UNAVAILABLE" {
		t.Fatal("unsafe failure", e)
	}
	if !errors.Is(v.Ready(context.Background()), Unavailable) {
		t.Fatal("failed warmup ready")
	}
}
func TestCacheInvalidateDiscardsInFlightPublication(t *testing.T) {
	now := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	body := cacheFixture(t, "a")
	started, release := make(chan struct{}), make(chan struct{})
	v := &Verifier{now: func() time.Time { return now }, jitter: func() time.Duration { return 0 }, fetch: func(context.Context) ([]byte, error) { close(started); <-release; return body, nil }}
	done := make(chan error, 1)
	go func() { done <- v.Warm(context.Background()) }()
	<-started
	v.Invalidate()
	close(release)
	if !errors.Is(<-done, Unavailable) {
		t.Fatal("invalidated fetch published")
	}
	if !errors.Is(v.Ready(context.Background()), Unavailable) || len(v.set.ids) != 0 {
		t.Fatal("keys survived invalidation")
	}
	v.fetch = func(context.Context) ([]byte, error) { return body, nil }
	if e := v.Warm(context.Background()); e != nil {
		t.Fatal(e)
	}
	v.Invalidate()
	if !errors.Is(v.Ready(context.Background()), Unavailable) {
		t.Fatal("warm keys survived invalidation")
	}
}

func TestCacheCanceledFetchReleasesWaiters(t *testing.T) {
	now := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	started := make(chan struct{})
	v := &Verifier{now: func() time.Time { return now }, jitter: func() time.Duration { return 0 }, fetch: func(ctx context.Context) ([]byte, error) { close(started); <-ctx.Done(); return nil, ctx.Err() }}
	ctx, cancel := context.WithCancel(context.Background())
	leader := make(chan error, 1)
	go func() { leader <- v.Warm(ctx) }()
	<-started
	waiter := make(chan error, 1)
	go func() { waiter <- v.Warm(context.Background()) }()
	cancel()
	for _, done := range []chan error{leader, waiter} {
		select {
		case err := <-done:
			if !errors.Is(err, Unavailable) {
				t.Fatal(err)
			}
		case <-time.After(time.Second):
			t.Fatal("canceled fetch left waiter blocked")
		}
	}
	if v.refreshing != nil {
		t.Fatal("refresh slot retained after cancellation")
	}
}

func TestCacheRejectsMalformedKeySetsWithoutExtendingAge(t *testing.T) {
	good := cacheFixture(t, "a")
	cases := map[string][]byte{"invalid JSON": []byte("{"), "missing keys": []byte("{}"), "duplicate IDs": cacheFixture(t, "a", "a")}
	for _, field := range []string{"kty", "crv", "alg", "use", "kid", "d"} {
		var copyDocument map[string][]map[string]string
		if err := json.Unmarshal(good, &copyDocument); err != nil {
			t.Fatal(err)
		}
		copyDocument["keys"][0][field] = "invalid"
		if field == "kid" {
			copyDocument["keys"][0][field] = ""
		}
		body, err := json.Marshal(copyDocument)
		if err != nil {
			t.Fatal(err)
		}
		cases[field] = body
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			now := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
			active := good
			v := &Verifier{now: func() time.Time { return now }, jitter: func() time.Duration { return 0 }, fetch: func(context.Context) ([]byte, error) { return active, nil }}
			if err := v.Warm(context.Background()); err != nil {
				t.Fatal(err)
			}
			loaded := now
			now = now.Add(time.Hour)
			active = body
			if !errors.Is(v.Warm(context.Background()), Unavailable) {
				t.Fatal("malformed key set accepted")
			}
			if v.success != loaded {
				t.Fatal("malformed response extended age")
			}
			if _, err := v.lookup(context.Background(), cacheToken("a")); err != nil {
				t.Fatal("discarded still-fresh valid keys", err)
			}
		})
	}
}
