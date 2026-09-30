//go:build integration

package onboarding

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestIndependentRealProviderCurrentEmail(t *testing.T) {
	base, anon, admin := os.Getenv("TEST_AUTH_URL"), os.Getenv("TEST_AUTH_ANON_KEY"), os.Getenv("TEST_AUTH_SERVICE_KEY")
	if !strings.HasPrefix(base, "http://127.0.0.1:") || anon == "" || admin == "" {
		t.Fatal("disposable provider environment required")
	}
	client := &http.Client{Timeout: 10 * time.Second}
	request := func(method, path, bearer string, payload any) map[string]any {
		t.Helper()
		raw, _ := json.Marshal(payload)
		req, err := http.NewRequest(method, base+path, bytes.NewReader(raw))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("apikey", anon)
		req.Header.Set("Content-Type", "application/json")
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal("provider request failed")
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode > 299 {
			t.Fatalf("provider status %d", resp.StatusCode)
		}
		result := map[string]any{}
		if resp.StatusCode != 204 {
			_ = json.NewDecoder(resp.Body).Decode(&result)
		}
		return result
	}
	suffix := uuid.NewString()
	email, password := "current80+"+suffix+"@example.invalid", "Synthetic80!"+suffix
	// Confirmation here is only an existing-account fixture. The independent Auth
	// SMTP test proves invite/recovery confirmation without this administrative flag.
	user := request("POST", "/admin/users", admin, map[string]any{"email": email, "password": password, "email_confirm": true})
	id := user["id"].(string)
	t.Cleanup(func() { request("DELETE", "/admin/users/"+id, admin, nil) })
	session := request("POST", "/token?grant_type=password", "", map[string]any{"email": email, "password": password})
	access := session["access_token"].(string)
	verifier, err := auth.New(auth.Config{Issuer: base, Audience: "authenticated", JWKSURL: base + "/.well-known/jwks.json"})
	if err != nil || verifier.Warm(context.Background()) != nil {
		t.Fatal("real provider verifier configuration failed")
	}
	verified := false
	req := httptest.NewRequest("POST", "/", nil)
	req.Header.Set("Authorization", "Bearer "+access)
	verifier.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { verified = auth.RequireRequest(r.Context()) == nil })).ServeHTTP(httptest.NewRecorder(), req)
	if !verified {
		t.Fatal("real provider session rejected by application JWT verifier")
	}

	provider, err := NewEmailProvider(base, anon, access)
	if err != nil {
		t.Fatal(err)
	}
	check := func(want string) {
		t.Helper()
		evidence, err := provider.CurrentEmail(context.Background(), id)
		if err != nil || evidence.Subject != id || evidence.Email != want || !evidence.Verified {
			t.Fatal("incorrect current verified provider evidence")
		}
	}
	check(email)
	changed := "pending80+" + suffix + "@example.invalid"
	request("PUT", "/user", access, map[string]any{"email": changed})
	check(email)
	if _, err := provider.CurrentEmail(context.Background(), uuid.NewString()); err == nil {
		t.Fatal("provider allowed different subject")
	}
	request("PUT", "/admin/users/"+id, admin, map[string]any{"email": changed, "email_confirm": true})
	check(changed)
	invalid, _ := NewEmailProvider(base, anon, "invalid-synthetic-token")
	if _, err := invalid.CurrentEmail(context.Background(), id); err == nil {
		t.Fatal("invalid bearer produced email evidence")
	}
}
