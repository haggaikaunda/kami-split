//go:build integration

package bootstrap

import (
	"bytes"
	"context"
	"encoding/json"
	"html"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/jackc/pgx/v5"
)

func TestIndependentBootstrapEmailedRecovery(t *testing.T) {
	f := newFixture(t)
	base, anon, service := os.Getenv("TEST_AUTH_URL"), os.Getenv("TEST_AUTH_ANON_KEY"), os.Getenv("TEST_AUTH_SERVICE_KEY")
	if !strings.HasPrefix(base, "http://127.0.0.1:") || anon == "" || service == "" {
		t.Fatal("disposable local Auth required")
	}
	client := &http.Client{Timeout: 10 * time.Second}
	request := func(method, path, bearer string, payload any) (int, map[string]any) {
		t.Helper()
		raw, e := json.Marshal(payload)
		if e != nil {
			t.Fatal(e)
		}
		req, e := http.NewRequestWithContext(f.ctx, method, base+path, bytes.NewReader(raw))
		if e != nil {
			t.Fatal("invalid provider request")
		}
		req.Header.Set("apikey", anon)
		req.Header.Set("Content-Type", "application/json")
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		resp, e := client.Do(req)
		if e != nil {
			t.Fatal("provider request failed")
		}
		defer resp.Body.Close()
		out := map[string]any{}
		if resp.StatusCode != 204 {
			_ = json.NewDecoder(resp.Body).Decode(&out)
		}
		return resp.StatusCode, out
	}
	expect := func(code, want int) {
		t.Helper()
		if code != want {
			t.Fatalf("provider status %d, expected %d", code, want)
		}
	}
	email := "bootstrap81+" + uuid.NewString() + "@example.invalid"
	initialPassword := "UnsharedSynthetic81!" + uuid.NewString()
	code, _ := request("POST", "/signup", "", map[string]any{"email": email, "password": initialPassword})
	if code == 200 {
		t.Fatal("public signup enabled")
	}
	id, err := CreateAuthUser(f.ctx, base, service, email)
	if err != nil {
		t.Fatal(err)
	}
	code, user := request("GET", "/admin/users/"+id, service, nil)
	expect(code, 200)
	if confirmed, _ := user["email_confirmed_at"].(string); confirmed != "" {
		t.Fatal("admin creation bypassed email proof")
	}
	// Replace only this fixture's unused synthetic Auth record with the real
	// provider-created subject; cleanup tracks the exact chosen identity.
	f.exec(`DELETE FROM auth.users WHERE id=$1`, f.target.AuthUserID)
	f.target.AuthUserID = id
	f.provision()
	f.exact()
	redirect := "?redirect_to=" + url.QueryEscape("http://127.0.0.1:3000/auth/confirm#state=synthetic-state")
	recover := func() string {
		t.Helper()
		code, _ := request("POST", "/recover"+redirect, "", map[string]any{"email": email})
		expect(code, 200)
		challenge := deliveredProviderChallenge(t, client, email, "recovery")
		code, session := request("POST", "/verify", "", map[string]any{"type": "recovery", "token_hash": challenge})
		expect(code, 200)
		access, _ := session["access_token"].(string)
		if access == "" {
			t.Fatal("recovery omitted session")
		}
		code, current := request("GET", "/user", access, nil)
		expect(code, 200)
		if current["id"] != id || current["email_confirmed_at"] == nil || current["email_confirmed_at"] == "" {
			t.Fatal("recovery failed current email verification")
		}
		return access
	}
	access := recover()
	newPassword := "ActualSynthetic81!" + uuid.NewString()
	code, _ = request("PUT", "/user", access, map[string]any{"password": newPassword})
	expect(code, 200)
	code, _ = request("POST", "/token?grant_type=password", "", map[string]any{"email": email, "password": newPassword})
	expect(code, 200)
	verifier, err := auth.New(auth.Config{Issuer: base, Audience: "authenticated", JWKSURL: base + "/.well-known/jwks.json"})
	if err != nil || verifier.Warm(f.ctx) != nil {
		t.Fatal("provider verifier unavailable")
	}
	verified := false
	req := httptest.NewRequest("POST", "/", nil)
	req.Header.Set("Authorization", "Bearer "+access)
	verifier.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { verified = auth.RequireRequest(r.Context()) == nil })).ServeHTTP(httptest.NewRecorder(), req)
	if !verified {
		t.Fatal("recovered session rejected by ordinary authentication")
	}
	// Probe the ordinary runtime identity/group boundary with the verified subject.
	runtime, e := pgx.Connect(f.ctx, os.Getenv("TEST_DATABASE_URL"))
	if e != nil {
		t.Fatal(e)
	}
	defer runtime.Close(context.Background())
	check := func(want bool) {
		t.Helper()
		tx, e := runtime.Begin(f.ctx)
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback(f.ctx)
		if _, e = tx.Exec(f.ctx, `SELECT set_config('app.verified_sub',$1,true)`, id); e != nil {
			t.Fatal(e)
		}
		var allowed bool
		if e = tx.QueryRow(f.ctx, `SELECT app.can_read_group($1)`, f.target.GroupID).Scan(&allowed); e != nil || allowed != want {
			t.Fatalf("recovered household access=%v, wanted %v: %v", allowed, want, e)
		}
	}
	check(true)
	f.exact()
	f.exec(`UPDATE app.users SET enabled=false WHERE id=$1`, f.target.UserID)
	// Password changes in a valid recovery session cannot restore app authority.
	code, _ = request("PUT", "/user", access, map[string]any{"password": "ChangedSynthetic81!" + uuid.NewString()})
	expect(code, 200)
	check(false)
	var n int
	if e = f.db.QueryRow(f.ctx, `SELECT count(*) FROM app.memberships WHERE user_id=$1`, f.target.UserID).Scan(&n); e != nil || n != 1 {
		t.Fatal("recovery changed membership", e)
	}
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
