package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestIndependentHTTPRejectionAndNoTokenTrustIO(t *testing.T) {
	v, key, now := requestFixture(t)
	var calls atomic.Int32
	v.fetch = func(context.Context) ([]byte, error) {
		calls.Add(1)
		return nil, errors.New("private provider diagnostic")
	}
	other, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	hs := jwt.NewWithClaims(jwt.SigningMethodHS256, fixtureClaims(now))
	hs.Header["kid"] = "fixture"
	hsRaw, err := hs.SignedString([]byte("fixture-only"))
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string]string{"tampered": signFixture(t, other, fixtureClaims(now), nil), "algorithm": hsRaw, "trustURL": signFixture(t, key, fixtureClaims(now), map[string]any{"kid": "unknown", "jku": "http://127.0.0.1/private"}), "certificate": signFixture(t, key, fixtureClaims(now), map[string]any{"x5c": []string{"private"}}), "critical": signFixture(t, key, fixtureClaims(now), map[string]any{"crit": []string{"unknown"}})}
	endpoint := httptest.NewServer(v.Protect(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("rejected credential reached handler") })))
	defer endpoint.Close()
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			req, _ := http.NewRequest("POST", endpoint.URL, nil)
			req.Header.Set("Authorization", "Bearer "+raw)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != 401 {
				t.Fatal(resp.StatusCode)
			}
			if resp.Header.Get("Cache-Control") != "no-store" || resp.Header.Get("WWW-Authenticate") != "Bearer" {
				t.Fatal("missing credential error headers")
			}
		})
	}
	if calls.Load() != 0 {
		t.Fatal("token trust headers caused remote IO")
	}
}

func TestIndependentRealTokensAcrossFailedRefreshAndRemoval(t *testing.T) {
	v, key, now := requestFixture(t)
	clock := now
	v.now = func() time.Time { return clock }
	// This token remains valid across the full cache-age experiment.
	claims := fixtureClaims(now)
	claims["exp"] = now.Add(4 * time.Hour).Unix()
	raw := signFixture(t, key, claims, nil)
	v.fetch = func(context.Context) ([]byte, error) { return nil, errors.New("secret upstream failure") }
	clock = clock.Add(time.Hour)
	if v.Warm(context.Background()) != Unavailable {
		t.Fatal("refresh unexpectedly succeeded")
	}
	if got, err := v.verify(context.Background(), raw); err != nil || got != fixtureSubject {
		t.Fatalf("fresh known key lost during outage: %s %v", got, err)
	}
	clock = now.Add(2 * time.Hour)
	if _, err := v.verify(context.Background(), raw); err != Unavailable {
		t.Fatalf("stale key authorized: %v", err)
	}
	v.Invalidate()
	v.fetch = func(context.Context) ([]byte, error) { return cacheFixture(t, "replacement"), nil }
	if err := v.Warm(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := v.verify(context.Background(), raw); err != Unauthenticated {
		t.Fatalf("removed key authorized: %v", err)
	}
}

func TestIndependentUnknownKeyFetchCanceledByRequest(t *testing.T) {
	v, key, now := requestFixture(t)
	v.now = func() time.Time { return now.Add(time.Minute) }
	entered, stopped := make(chan struct{}), make(chan struct{})
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(entered); <-r.Context().Done(); close(stopped) }))
	defer remote.Close()
	// Retain warmed trust while using the production HTTP fetcher for a rotation miss.
	replacement, err := New(Config{Issuer: v.config.Issuer, Audience: v.config.Audience, JWKSURL: remote.URL})
	if err != nil {
		t.Fatal(err)
	}
	v.fetch = replacement.fetch
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest("POST", "/", strings.NewReader("{}"))
	req = req.WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+signFixture(t, key, fixtureClaims(now), map[string]any{"kid": "rotation"}))
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		defer close(done)
		v.Protect(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("canceled request reached protected handler") })).ServeHTTP(response, req)
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("fetch did not start")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("request cancellation did not return")
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("cancellation did not reach upstream")
	}
	if response.Code != 503 {
		t.Fatal(response.Code)
	}
}
