package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
)

func TestJWKSFailureSurvivesBackoffAndVerification(t *testing.T) {
	v, key, now := requestFixture(t)
	cause := errors.New("private provider URL credential body")
	v.fetch = func(context.Context) ([]byte, error) { return nil, cause }
	v.now = func() time.Time { return now.Add(time.Minute) }
	raw := signFixture(t, key, fixtureClaims(now), map[string]any{"kid": "rotated"})
	for attempt := 0; attempt < 2; attempt++ {
		_, err := v.verify(context.Background(), raw)
		if !errors.Is(err, cause) || !errors.Is(err, Unavailable) || err.Error() != string(Unavailable) {
			t.Fatalf("lost cause or unsafe outcome: %s", err)
		}
		if operation, ok := diagnostic.Operation(err); !ok || operation != "auth.jwks_refresh" {
			t.Fatal("missing failure classification")
		}
	}
	if _, err := v.verify(context.Background(), "malformed"); err != Unauthenticated {
		t.Fatal("malformed credential misclassified")
	}
}

func TestJWKSStatusAndMalformedDocumentsAreDiagnosable(t *testing.T) {
	for _, status := range []int{http.StatusServiceUnavailable, http.StatusOK} {
		remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
			_, _ = w.Write([]byte("private provider response"))
		}))
		v, err := New(Config{Issuer: "https://auth.example.invalid", Audience: "authenticated", JWKSURL: remote.URL})
		if err != nil {
			t.Fatal(err)
		}
		err = v.Warm(context.Background())
		remote.Close()
		if !errors.Is(err, Unavailable) || err.Error() != string(Unavailable) {
			t.Fatal("unsafe provider error")
		}
		if _, ok := diagnostic.Operation(err); !ok {
			t.Fatal("missing diagnostic classification")
		}
	}
}

func TestEmptyJWKSIsDiagnosableWithoutRetainingOldTrust(t *testing.T) {
	v, _, now := requestFixture(t)
	v.now = func() time.Time { return now.Add(time.Minute) }
	v.fetch = func(context.Context) ([]byte, error) { return []byte(`{"keys":[]}`), nil }
	err := v.Warm(context.Background())
	if _, ok := diagnostic.Operation(err); !ok {
		t.Fatal("empty provider keyset lost diagnostic")
	}
	if !errors.Is(v.Ready(context.Background()), Unavailable) {
		t.Fatal("empty keyset retained old trust")
	}
}
