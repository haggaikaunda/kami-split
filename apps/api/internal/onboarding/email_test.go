package onboarding

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFreshRequestEmail(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/user" || r.Header.Get("Authorization") != "Bearer request-secret" || r.Header.Get("apikey") != "publishable" {
			t.Error("wrong request credentials")
		}
		if calls == 1 {
			fmt.Fprint(w, `{"id":"subject","email":"current@example.invalid","email_confirmed_at":"2026-01-01T00:00:00Z","new_email":"pending@example.invalid"}`)
		} else {
			fmt.Fprint(w, `{"id":"subject","email":"changed@example.invalid","email_confirmed_at":null}`)
		}
	}))
	defer server.Close()
	provider, err := NewEmailProvider(server.URL, "publishable", "request-secret")
	if err != nil {
		t.Fatal(err)
	}
	first, err := provider.CurrentEmail(context.Background(), "subject")
	if err != nil || first.Email != "current@example.invalid" || !first.Verified {
		t.Fatal("current verified email missing")
	}
	second, err := provider.CurrentEmail(context.Background(), "subject")
	if err != nil || second.Email != "changed@example.invalid" || second.Verified || calls != 2 {
		t.Fatal("provider used stale evidence")
	}
	if strings.Contains(fmt.Sprintf("%v %#v", provider, provider), "request-secret") {
		t.Fatal("token leaked")
	}
}

func TestEmailFailsClosed(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
	}{
		{"wrong subject", `{"id":"other","email":"a@example.invalid","email_confirmed_at":"2026-01-01T00:00:00Z"}`, 200},
		{"malformed", `{`, 200}, {"unavailable", `{}`, 503}, {"unauthorized", `{}`, 401},
		{"oversized", strings.Repeat(" ", 65537), 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.status); fmt.Fprint(w, tc.body) }))
			defer server.Close()
			provider, _ := NewEmailProvider(server.URL, "key", "token")
			if _, err := provider.CurrentEmail(context.Background(), "subject"); err == nil {
				t.Fatal("unsafe evidence accepted")
			}
		})
	}
}

func TestEmailDoesNotFollowRedirects(t *testing.T) {
	reached := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached = true }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 302) }))
	defer source.Close()
	provider, _ := NewEmailProvider(source.URL, "key", "token")
	if _, err := provider.CurrentEmail(context.Background(), "subject"); err == nil || reached {
		t.Fatal("followed provider redirect")
	}
}
