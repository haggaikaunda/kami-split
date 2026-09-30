//go:build integration

package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"html"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Exercise provider behavior independently of the application adapter. Reading
// the disposable SMTP catcher's delivered challenge does not confirm a user;
// only the public verification endpoint is permitted to perform confirmation.
func TestLocalProviderInvitationOnboarding(t *testing.T) {
	base, anon, service := os.Getenv("TEST_AUTH_URL"), os.Getenv("TEST_AUTH_ANON_KEY"), os.Getenv("TEST_AUTH_SERVICE_KEY")
	if !strings.HasPrefix(base, "http://127.0.0.1:") || anon == "" || service == "" {
		t.Fatal("disposable loopback Auth environment required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	t.Cleanup(cancel)
	client := &http.Client{Timeout: 10 * time.Second}
	redirect := "?redirect_to=" + url.QueryEscape("http://127.0.0.1:3000/auth/confirm#state=synthetic-state")
	request := func(method, path, bearer string, payload any) (int, map[string]any) {
		t.Helper()
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		req, err := http.NewRequestWithContext(ctx, method, base+path, bytes.NewReader(raw))
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
		out := map[string]any{}
		if resp.StatusCode != 204 {
			_ = json.NewDecoder(resp.Body).Decode(&out)
		}
		return resp.StatusCode, out
	}
	require := func(code, want int) {
		t.Helper()
		if code != want {
			t.Fatalf("provider status %d, want %d", code, want)
		}
	}
	suffix := uuid.NewString()
	email, password := "invite80+"+suffix+"@example.invalid", "Synthetic80!"+suffix
	signup, _ := request("POST", "/signup", "", map[string]any{"email": email, "password": password})
	if signup == 200 {
		t.Fatal("uninvited signup enabled")
	}
	code, invited := request("POST", "/invite"+redirect, service, map[string]any{"email": email})
	require(code, 200)
	id, _ := invited["id"].(string)
	if id == "" {
		t.Fatal("invite omitted subject")
	}
	t.Cleanup(func() { request("DELETE", "/admin/users/"+id, service, nil) })
	if value, _ := invited["email_confirmed_at"].(string); value != "" {
		t.Fatal("invite auto-confirmed address")
	}
	code, _ = request("POST", "/invite"+redirect, service, map[string]any{"email": email})
	require(code, 200)
	challenge := deliveredProviderChallenge(t, client, email, "invite")
	code, session := request("POST", "/verify", "", map[string]any{"type": "invite", "token_hash": challenge})
	require(code, 200)
	access, _ := session["access_token"].(string)
	refresh, _ := session["refresh_token"].(string)
	if access == "" || refresh == "" {
		t.Fatal("verified invite omitted session")
	}
	if session["expires_in"] != float64(900) {
		t.Fatalf("access lifetime must be 900 seconds, got %v", session["expires_in"])
	}
	code, _ = request("PUT", "/user", access, map[string]any{"password": password})
	require(code, 200)
	code, _ = request("POST", "/verify", "", map[string]any{"type": "invite", "token_hash": challenge})
	if code == 200 {
		t.Fatal("invite challenge replay succeeded")
	}
	code, _ = request("POST", "/invite"+redirect, service, map[string]any{"email": email})
	if code == 200 {
		t.Fatal("confirmed account accepted new admin invitation")
	}
	code, otherSession := request("POST", "/token?grant_type=password", "", map[string]any{"email": email, "password": password})
	require(code, 200)
	code, refreshed := request("POST", "/token?grant_type=refresh_token", "", map[string]any{"refresh_token": refresh})
	require(code, 200)
	access, _ = refreshed["access_token"].(string)
	refresh, _ = refreshed["refresh_token"].(string)
	code, _ = request("POST", "/logout?scope=local", access, nil)
	require(code, 204)
	code, _ = request("POST", "/token?grant_type=refresh_token", "", map[string]any{"refresh_token": refresh})
	if code == 200 {
		t.Fatal("local logout left refresh session usable")
	}

	code, _ = request("POST", "/token?grant_type=refresh_token", "", map[string]any{"refresh_token": otherSession["refresh_token"]})
	require(code, 200)

	// A precreated, unconfirmed account must have a provider-supported route to
	// prove address ownership and establish its own password without auto-confirm.
	email = "recover80+" + suffix + "@example.invalid"
	code, existing := request("POST", "/admin/users", service, map[string]any{"email": email})
	require(code, 200)
	existingID, _ := existing["id"].(string)
	t.Cleanup(func() { request("DELETE", "/admin/users/"+existingID, service, nil) })
	code, _ = request("POST", "/recover"+redirect, "", map[string]any{"email": email})
	require(code, 200)
	challenge = deliveredProviderChallenge(t, client, email, "recovery")
	code, recovered := request("POST", "/verify", "", map[string]any{"type": "recovery", "token_hash": challenge})
	require(code, 200)
	access, _ = recovered["access_token"].(string)
	code, user := request("GET", "/user", access, nil)
	require(code, 200)
	if confirmed, _ := user["email_confirmed_at"].(string); confirmed == "" {
		t.Fatal("recovery did not establish verified current email")
	}
	code, _ = request("PUT", "/user", access, map[string]any{"password": password})
	require(code, 200)
	code, _ = request("POST", "/token?grant_type=password", "", map[string]any{"email": email, "password": password})
	require(code, 200)
}

// deliveredProviderChallenge reads only this test's synthetic mailbox. Neither
// message bodies nor verification credentials are included in failure output.
func deliveredProviderChallenge(t *testing.T, client *http.Client, email, kind string) string {
	t.Helper()
	base := strings.TrimRight(os.Getenv("TEST_SMTP_URL"), "/")
	if !strings.HasPrefix(base, "http://127.0.0.1:") {
		t.Fatal("disposable SMTP catcher required")
	}
	query := url.QueryEscape("to:" + email)
	for attempt := 0; attempt < 30; attempt++ {
		resp, err := client.Get(base + "/api/v1/search?query=" + query)
		if err != nil {
			t.Fatal("SMTP catcher unavailable")
		}
		var mailbox struct {
			Messages []struct {
				ID string `json:"ID"`
			} `json:"messages"`
		}
		err = json.NewDecoder(resp.Body).Decode(&mailbox)
		resp.Body.Close()
		if err != nil {
			t.Fatal("SMTP catcher mailbox invalid")
		}
		for i := 0; i < len(mailbox.Messages); i++ {
			resp, err := client.Get(base + "/api/v1/message/" + url.PathEscape(mailbox.Messages[i].ID))
			if err != nil {
				t.Fatal("SMTP catcher message unavailable")
			}
			var message struct {
				Text string `json:"Text"`
				HTML string `json:"HTML"`
			}
			err = json.NewDecoder(resp.Body).Decode(&message)
			resp.Body.Close()
			if err != nil {
				t.Fatal("SMTP catcher message invalid")
			}
			for _, link := range regexp.MustCompile(`https?://[^\s<>"']+`).FindAllString(html.UnescapeString(message.Text+" "+message.HTML), -1) {
				parsed, err := url.Parse(link)
				if err != nil {
					continue
				}
				fragment, err := url.ParseQuery(parsed.Fragment)
				if err == nil && fragment.Get("type") == kind && fragment.Get("token_hash") != "" {
					if parsed.Scheme != "http" || parsed.Host != "127.0.0.1:3000" || parsed.Path != "/auth/confirm" || fragment.Get("state") != "synthetic-state" || parsed.RawQuery != "" {
						t.Fatal("unsafe emailed callback destination or missing browser state")
					}
					return fragment.Get("token_hash")
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("provider did not deliver expected verification email")
	return ""
}
