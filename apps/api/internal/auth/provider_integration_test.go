//go:build integration

package auth

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// This is a provider-compatibility probe, not the #80 production Auth adapter.
// Only the disposable harness's local Auth service and synthetic accounts are used.
func TestLocalProviderCurrentEmailCompatibility(t *testing.T) {
	base := os.Getenv("TEST_AUTH_URL")
	anon := os.Getenv("TEST_AUTH_ANON_KEY")
	service := os.Getenv("TEST_AUTH_SERVICE_KEY")
	if base == "" || anon == "" || service == "" {
		t.Fatal("local Auth test environment required")
	}
	if !strings.HasPrefix(base, "http://127.0.0.1:") {
		t.Fatal("Auth compatibility tests require disposable loopback provider")
	}
	client := &http.Client{Timeout: 10 * time.Second}
	request := func(method, path, bearer string, payload any) (int, map[string]any) {
		t.Helper()
		var body io.Reader
		if payload != nil {
			raw, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			body = bytes.NewReader(raw)
		}
		req, err := http.NewRequest(method, base+path, body)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("apikey", anon)
		req.Header.Set("Content-Type", "application/json")
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		response, err := client.Do(req)
		if err != nil {
			t.Fatal("local Auth request failed")
		}
		defer response.Body.Close()
		var out map[string]any
		if response.StatusCode != http.StatusNoContent {
			if err := json.NewDecoder(response.Body).Decode(&out); err != nil {
				t.Fatal("invalid local Auth response")
			}
		}
		return response.StatusCode, out
	}
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")
	raw := "\u2003Mixed.Dot+" + suffix + "@Example.Invalid\u00a0"
	canonical, err := CanonicalEmail(raw)
	if err != nil {
		t.Fatal(err)
	}
	password := "Synthetic79!" + uuid.NewString()
	signupCode, _ := request("POST", "/signup", "", map[string]any{"email": "signup-denied+" + suffix + "@example.invalid", "password": password})
	if signupCode != 400 && signupCode != 422 {
		t.Fatalf("ordinary signup must remain disabled, status %d", signupCode)
	}
	code, created := request("POST", "/admin/users", service, map[string]any{"email": canonical, "password": password, "email_confirm": true})
	if code != 200 && code != 201 {
		t.Fatalf("synthetic create status %d", code)
	}
	id, ok := created["id"].(string)
	if !ok || id == "" {
		t.Fatal("provider omitted subject")
	}
	t.Cleanup(func() {
		code, _ := request("DELETE", "/admin/users/"+id, service, nil)
		if code != 200 && code != 204 {
			t.Errorf("synthetic cleanup status %d", code)
		}
	})
	code, session := request("POST", "/token?grant_type=password", "", map[string]any{"email": strings.ToUpper(canonical), "password": password})
	if code != 200 {
		t.Fatalf("case-insensitive existing account login status %d code=%v message=%v", code, session["error_code"], session["msg"])
	}
	access, ok := session["access_token"].(string)
	if !ok || access == "" {
		t.Fatal("provider omitted session")
	}
	checkCurrent := func(want string) {
		t.Helper()
		code, user := request("GET", "/user", access, nil)
		if code != 200 {
			t.Fatalf("getUser status %d", code)
		}
		actual, _ := user["email"].(string)
		normalized, err := CanonicalEmail(actual)
		if err != nil || normalized != want || user["id"] != id {
			t.Fatal("current email/subject mismatch")
		}
		confirmed, _ := user["email_confirmed_at"].(string)
		if confirmed == "" {
			t.Fatal("current email verification missing")
		}
	}
	checkCurrent(canonical)
	// Alias punctuation must remain significant across provider responses.
	if !strings.Contains(canonical, "mixed.dot+") {
		t.Fatal("alias punctuation stripped")
	}
	changed := "new.dot+" + suffix + "@example.invalid"
	code, _ = request("PUT", "/user", access, map[string]any{"email": changed})
	if code != 200 {
		t.Fatalf("pending change status %d", code)
	}
	checkCurrent(canonical)
	// Complete through the local administrator solely to inspect subsequent getUser
	// evidence. Callback/verification-link implementation remains #80's boundary.
	code, _ = request("PUT", "/admin/users/"+id, service, map[string]any{"email": changed, "email_confirm": true})
	if code != 200 {
		t.Fatalf("confirmed change status %d", code)
	}
	checkCurrent(changed)
	code, _ = request("POST", "/token?grant_type=password", "", map[string]any{"email": canonical, "password": password})
	if code == 200 {
		t.Fatal("old address still selected account after completed change")
	}
}
