package onboarding

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/invitation"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

func independentHandler(t *testing.T, provider http.Handler) *Handler {
	t.Helper()
	server := httptest.NewServer(provider)
	t.Cleanup(server.Close)
	p, err := invitation.NewProtector("test", map[string][]byte{"test": bytes.Repeat([]byte{31}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	sender, err := NewSender(server.URL, "synthetic", "https://kami.example", "invite@example.invalid")
	if err != nil {
		t.Fatal(err)
	}
	v, err := auth.New(auth.Config{Issuer: server.URL, Audience: "authenticated", JWKSURL: server.URL + "/keys"})
	if err != nil {
		t.Fatal(err)
	}
	h, err := NewHandler(&Factory{db: &database.DB{}, protector: p, authURL: server.URL, apiKey: "public", Sender: sender}, v, "https://kami.example", "private-admin", slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	return h
}
func independentPost(h *Handler, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", "https://kami.example/onboarding/"+path, strings.NewReader(body))
	req.Header.Set("Origin", "https://kami.example")
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	out := httptest.NewRecorder()
	h.Wrap(http.NotFoundHandler()).ServeHTTP(out, req)
	return out
}
func independentStart(t *testing.T, h *Handler) *http.Cookie {
	t.Helper()
	out := independentPost(h, "start", "{}", nil)
	if out.Code != 200 {
		t.Fatalf("start status %d", out.Code)
	}
	cookies := out.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatal("missing cookie")
	}
	c := cookies[0]
	if !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteStrictMode || c.MaxAge != 900 {
		t.Fatal("unsafe cookie")
	}
	return c
}
func TestIndependentBrowserBoundary(t *testing.T) {
	h := independentHandler(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("unexpected provider call") }))
	for _, tc := range []struct {
		origin, body string
		want         int
	}{{"https://evil.example", "{}", 403}, {"", "{}", 403}, {"https://kami.example", `{"unknown":1}`, 400}, {"https://kami.example", `{} {}`, 400}, {"https://kami.example", strings.Repeat("x", 8193), 400}} {
		req := httptest.NewRequest("POST", "/onboarding/start", strings.NewReader(tc.body))
		req.Header.Set("Origin", tc.origin)
		req.Header.Set("Content-Type", "application/json")
		out := httptest.NewRecorder()
		h.Wrap(http.NotFoundHandler()).ServeHTTP(out, req)
		if out.Code != tc.want {
			t.Fatalf("boundary status %d want %d", out.Code, tc.want)
		}
	}
	cookie := independentStart(t, h)
	h.mu.Lock()
	initial := h.contexts[cookie.Value]
	initial.cipher, initial.version, _ = h.factory.protector.Encrypt([]byte(strings.Repeat("A", 43)), "BROWSER:"+cookie.Value)
	h.contexts[cookie.Value] = initial
	h.mu.Unlock()
	if got := independentPost(h, "accept", fmt.Sprintf(`{"key":%q}`, uuid.NewString()), cookie); !strings.Contains(got.Body.String(), "UNAUTHENTICATED") {
		t.Fatal("anonymous acceptance not denied")
	}
	if got := independentPost(h, "preview", "{}", nil); got.Code != 409 {
		t.Fatal("missing context accepted")
	}
	h.mu.Lock()
	c := h.contexts[cookie.Value]
	c.expires = time.Now().Add(-time.Second)
	h.contexts[cookie.Value] = c
	h.mu.Unlock()
	if got := independentPost(h, "recover", `{"email":"synthetic@example.invalid"}`, cookie); got.Code != 409 {
		t.Fatal("expired context used")
	}
}
func TestIndependentRecoveryBudgetsAndCallbackBinding(t *testing.T) {
	calls := 0
	state := ""
	h := independentHandler(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/recover" || r.Header.Get("Authorization") != "Bearer public" {
			t.Error("privileged recovery route")
		}
		u, e := url.Parse(r.URL.Query().Get("redirect_to"))
		if e != nil || u.Host != "kami.example" || u.Path != "/auth/confirm" {
			t.Error("unsafe redirect")
		}
		f, _ := url.ParseQuery(u.Fragment)
		state = f.Get("state")
		w.WriteHeader(503)
	}))
	cookie := independentStart(t, h)
	responses := []string{}
	for i := 0; i < 3; i++ {
		out := independentPost(h, "recover", `{"email":"synthetic@example.invalid"}`, cookie)
		if out.Code != 200 {
			t.Fatal("enumerating recovery status")
		}
		responses = append(responses, out.Body.String())
	}
	if calls != 2 || responses[0] != responses[1] || responses[1] != responses[2] {
		t.Fatal("budget or generic response failure")
	}
	if got := independentPost(h, "callback-state", `{"state":"wrong"}`, cookie); got.Code != 400 {
		t.Fatal("wrong state accepted")
	}
	body, _ := json.Marshal(map[string]string{"state": state})
	if got := independentPost(h, "callback-state", string(body), nil); got.Code != 409 {
		t.Fatal("missing browser binding accepted")
	}
	if got := independentPost(h, "callback-state", string(body), cookie); got.Code != 200 {
		t.Fatal("valid callback rejected")
	}
	if got := independentPost(h, "callback-state", string(body), cookie); got.Code != 400 {
		t.Fatal("callback replay accepted")
	}
	if got := independentPost(h, "clear", "{}", cookie); got.Code != 200 {
		t.Fatal("clear failed")
	}
	if got := independentPost(h, "callback-state", string(body), cookie); got.Code != 409 {
		t.Fatal("cleared context survived")
	}
}
func TestIndependentConcurrentAbuseBudget(t *testing.T) {
	h := independentHandler(t, http.NotFoundHandler())
	var wg sync.WaitGroup
	results := make(chan bool, 40)
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); results <- h.allow("provider", 20) }()
	}
	wg.Wait()
	close(results)
	allowed := 0
	for ok := range results {
		if ok {
			allowed++
		}
	}
	if allowed != 20 {
		t.Fatalf("concurrent budget allowed %d", allowed)
	}
	for i := 0; i < 120; i++ {
		req := httptest.NewRequest("POST", "/graphql", nil)
		out := httptest.NewRecorder()
		h.Wrap(http.NotFoundHandler()).ServeHTTP(out, req)
		if out.Code == 429 {
			t.Fatal("premature IP budget")
		}
	}
	req := httptest.NewRequest("POST", "/graphql", nil)
	req.Header.Set("X-Forwarded-For", "new-address")
	out := httptest.NewRecorder()
	h.Wrap(http.NotFoundHandler()).ServeHTTP(out, req)
	if out.Code != 429 || out.Header().Get("Retry-After") == "" {
		t.Fatal("forwarded header bypassed budget")
	}
}
