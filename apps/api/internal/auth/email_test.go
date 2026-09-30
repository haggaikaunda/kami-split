package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
)

func TestCanonicalEmail(t *testing.T) {
	got, err := CanonicalEmail("\u2003 Alice.Test+Tag@Example.COM \u00a0")
	if err != nil || got != "alice.test+tag@example.com" {
		t.Fatal("canonicalization failed")
	}
	for _, input := range []string{"", "a@@example.com", "a b@example.com", "\"a\"@example.com", "a(comment)@example.com", "a\n@example.com", "é@example.com", "a@é.com", ".a@example.com", "a..b@example.com", "a.@example.com", "a@-example.com", "a@example-.com", "a@example..com", "a@[127.0.0.1]", strings.Repeat("a", 65) + "@example.com", "a@" + strings.Repeat("a", 64) + ".com"} {
		if _, err := CanonicalEmail(input); err == nil {
			t.Errorf("accepted %q", input)
		}
	}
}

type emailProviderFunc func(context.Context, string) (ProviderEmail, error)

func (f emailProviderFunc) CurrentEmail(ctx context.Context, s string) (ProviderEmail, error) {
	return f(ctx, s)
}
func TestEmailEvidence(t *testing.T) {
	ctx := context.WithValue(context.Background(), identityKey{}, identity{subject: "verified", marker: &requestMarker{}})
	calls := 0
	provider := emailProviderFunc(func(_ context.Context, s string) (ProviderEmail, error) {
		calls++
		if s != "verified" {
			t.Fatal("wrong subject")
		}
		return ProviderEmail{Subject: s, Email: " A+Tag@Example.com ", Verified: true}, nil
	})
	if _, err := ObserveCurrentEmail(context.Background(), provider); err == nil || calls != 0 {
		t.Fatal("unverified provider access")
	}
	e, err := ObserveCurrentEmail(ctx, provider)
	if err != nil {
		t.Fatal(err)
	}
	email, err := e.CanonicalEmail(ctx)
	if err != nil || email != "a+tag@example.com" {
		t.Fatal("valid evidence rejected")
	}
	other := context.WithValue(context.Background(), identityKey{}, identity{subject: "other"})
	if _, err := e.CanonicalEmail(other); err == nil {
		t.Fatal("subject binding absent")
	}
	sameSubject := context.WithValue(context.Background(), identityKey{}, identity{subject: "verified", marker: &requestMarker{}})
	if _, err := e.CanonicalEmail(sameSubject); err == nil {
		t.Fatal("evidence crossed request boundary")
	}
	derived, cancel := context.WithCancel(ctx)
	defer cancel()
	if _, err := e.CanonicalEmail(derived); err != nil {
		t.Fatal("derived context denied")
	}
	e.observed = time.Now().Add(-6 * time.Second)
	if _, err := e.CanonicalEmail(ctx); err == nil {
		t.Fatal("stale accepted")
	}
	if _, err := (EmailEvidence{}).CanonicalEmail(ctx); err == nil {
		t.Fatal("zero accepted")
	}
	for _, r := range []ProviderEmail{{Subject: "other", Email: "a@example.com", Verified: true}, {Subject: "verified", Email: "a@example.com"}, {Subject: "verified", Email: "bad", Verified: true}} {
		if _, err := ObserveCurrentEmail(ctx, emailProviderFunc(func(context.Context, string) (ProviderEmail, error) { return r, nil })); err == nil {
			t.Fatal("invalid provider response accepted")
		}
	}
}

func TestProviderFailurePreservesPrivateCause(t *testing.T) {
	ctx := context.WithValue(context.Background(), identityKey{}, identity{subject: "verified", marker: &requestMarker{}})
	cause := errors.New("bearer recipient@example.test private-provider-body")
	_, err := ObserveCurrentEmail(ctx, emailProviderFunc(func(context.Context, string) (ProviderEmail, error) { return ProviderEmail{}, cause }))
	if !errors.Is(err, cause) || !errors.Is(err, Unavailable) || err.Error() != string(Unavailable) {
		t.Fatal("provider cause or safe outcome lost")
	}
	if operation, ok := diagnostic.Operation(err); !ok || operation != "auth.email_provider" {
		t.Fatal("missing safe provider classification")
	}
}
