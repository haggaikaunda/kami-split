package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
)

const fixtureSubject = "78000000-0000-4000-8000-000000000001"

func requestFixture(t *testing.T) (*Verifier, *ecdsa.PrivateKey, time.Time) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	jwks, _ := json.Marshal(map[string]any{"keys": []any{map[string]string{"kty": "EC", "crv": "P-256", "kid": "fixture", "alg": "ES256", "use": "sig", "x": base64.RawURLEncoding.EncodeToString(key.X.FillBytes(make([]byte, 32))), "y": base64.RawURLEncoding.EncodeToString(key.Y.FillBytes(make([]byte, 32)))}}})
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(jwks) }))
	t.Cleanup(remote.Close)
	v, err := New(Config{Issuer: "https://auth.example.invalid", Audience: "authenticated", JWKSURL: remote.URL})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().Truncate(time.Second)
	v.now = func() time.Time { return now }
	v.jitter = func() time.Duration { return 0 }
	if err := v.Warm(context.Background()); err != nil {
		t.Fatal(err)
	}
	return v, key, now
}

func fixtureClaims(now time.Time) jwt.MapClaims {
	return jwt.MapClaims{"sub": fixtureSubject, "iss": "https://auth.example.invalid", "aud": "authenticated", "exp": now.Add(time.Hour).Unix(), "iat": now.Unix(), "role": "authenticated"}
}

func signFixture(t *testing.T, key *ecdsa.PrivateKey, c jwt.MapClaims, headers map[string]any) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodES256, c)
	token.Header["kid"] = "fixture"
	for k, v := range headers {
		token.Header[k] = v
	}
	raw, err := token.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestRealRequestsVerifyCredentials(t *testing.T) {
	v, key, now := requestFixture(t)
	called := false
	endpoint := httptest.NewServer(v.Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		subject, err := requestIdentity(r.Context())
		if err != nil || subject != fixtureSubject {
			t.Error("wrong verified actor")
		}
		w.WriteHeader(204)
	})))
	defer endpoint.Close()
	cases := []struct {
		name    string
		edit    func(jwt.MapClaims)
		headers map[string]any
		raw     string
	}{
		{name: "valid"}, {name: "malformed", raw: "not-a-jwt"},
		{name: "expired", edit: func(c jwt.MapClaims) { c["exp"] = now.Add(-time.Minute).Unix() }},
		{name: "issuer", edit: func(c jwt.MapClaims) { c["iss"] = "https://evil.invalid" }},
		{name: "audience", edit: func(c jwt.MapClaims) { c["aud"] = "other" }},
		{name: "subject", edit: func(c jwt.MapClaims) { c["sub"] = "arbitrary-user" }},
		{name: "nil subject", edit: func(c jwt.MapClaims) { c["sub"] = "00000000-0000-0000-0000-000000000000" }},
		{name: "role", edit: func(c jwt.MapClaims) { c["role"] = "service_role" }},
		{name: "future issued", edit: func(c jwt.MapClaims) { c["iat"] = now.Add(time.Minute).Unix() }},
		{name: "future nbf", edit: func(c jwt.MapClaims) { c["nbf"] = now.Add(time.Minute).Unix() }},
		{name: "jku", headers: map[string]any{"jku": "http://127.0.0.1/private"}},
		{name: "x5u", headers: map[string]any{"x5u": "https://evil.invalid"}},
		{name: "jwk", headers: map[string]any{"jwk": map[string]string{"kid": "fixture"}}},
		{name: "missing kid", headers: map[string]any{"kid": nil}},
	}
	for _, claim := range []string{"sub", "exp", "iat", "iss", "aud", "role"} {
		cases = append(cases, struct {
			name    string
			edit    func(jwt.MapClaims)
			headers map[string]any
			raw     string
		}{name: "missing " + claim, edit: func(c jwt.MapClaims) { delete(c, claim) }})
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			called = false
			c := fixtureClaims(now)
			if tc.edit != nil {
				tc.edit(c)
			}
			raw := tc.raw
			if raw == "" {
				raw = signFixture(t, key, c, tc.headers)
			}
			req, _ := http.NewRequest(http.MethodPost, endpoint.URL, strings.NewReader(`{"userId":"forged"}`))
			req.Header.Set("Authorization", "Bearer "+raw)
			req.Header.Set("X-User-ID", "forged")
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			want := 401
			if tc.name == "valid" {
				want = 204
			}
			if resp.StatusCode != want || called != (want == 204) {
				t.Fatalf("status=%d called=%v", resp.StatusCode, called)
			}
		})
	}
	t.Run("tampered signature", func(t *testing.T) {
		other, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if _, err := v.verify(context.Background(), signFixture(t, other, fixtureClaims(now), nil)); err != Unauthenticated {
			t.Fatalf("%v", err)
		}
	})
	t.Run("wrong algorithm", func(t *testing.T) {
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, fixtureClaims(now))
		token.Header["kid"] = "fixture"
		raw, _ := token.SignedString([]byte("synthetic-only"))
		if _, err := v.verify(context.Background(), raw); err != Unauthenticated {
			t.Fatalf("%v", err)
		}
	})
	t.Run("duplicate headers", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/", nil)
		req.Header.Add("Authorization", "Bearer "+signFixture(t, key, fixtureClaims(now), nil))
		req.Header.Add("Authorization", "Bearer anything")
		result := httptest.NewRecorder()
		v.Protect(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("accepted ambiguous authorization") })).ServeHTTP(result, req)
		if result.Code != 401 {
			t.Fatal(result.Code)
		}
	})
}

func TestBoundaryRequiresPrivateEvidenceAndSafeErrors(t *testing.T) {
	ctx := context.WithValue(context.Background(), "sub", fixtureSubject)
	if err := WithActor(ctx, nil, func(pgx.Tx, Actor) error { t.Fatal("forged context reached transaction"); return nil }); err != Unauthenticated {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{{Unauthenticated, 401, "UNAUTHENTICATED"}, {Disabled, 403, "DISABLED"}, {Unprovisioned, 403, "UNPROVISIONED"}, {Unavailable, 503, "UNAVAILABLE"}, {fmt.Errorf("sql secret token"), 503, "UNAVAILABLE"}} {
		w := httptest.NewRecorder()
		WriteError(w, tc.err)
		if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.code) || strings.Contains(w.Body.String(), "secret") {
			t.Fatalf("unsafe response %d %s", w.Code, w.Body.String())
		}
	}
}

func TestConfigAndHTTPTrust(t *testing.T) {
	valid := map[string]string{"AUTH_ISSUER": "https://issuer.invalid/auth/v1", "AUTH_AUDIENCE": "authenticated", "AUTH_JWKS_URL": "https://issuer.invalid/keys"}
	for _, key := range []string{"AUTH_ISSUER", "AUTH_AUDIENCE", "AUTH_JWKS_URL"} {
		values := map[string]string{}
		for k, v := range valid {
			values[k] = v
		}
		delete(values, key)
		if _, err := Load(func(k string) (string, bool) { v, ok := values[k]; return v, ok }); err == nil {
			t.Fatal("accepted partial config")
		}
	}
	for _, raw := range []string{"http://public.invalid/keys", "https://user:secret@issuer.invalid/keys", "https://issuer.invalid/keys#fragment", "not-a-url"} {
		if _, err := New(Config{Issuer: valid["AUTH_ISSUER"], Audience: "authenticated", JWKSURL: raw}); err == nil {
			t.Fatal("accepted untrusted URL")
		}
	}
	reached := false
	destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true }))
	defer destination.Close()
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, destination.URL, 302) }))
	defer remote.Close()
	v, _ := New(Config{Issuer: valid["AUTH_ISSUER"], Audience: "authenticated", JWKSURL: remote.URL})
	if v.Warm(context.Background()) != Unavailable || reached {
		t.Fatal("followed trust redirect")
	}
}
