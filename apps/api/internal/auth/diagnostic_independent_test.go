package auth

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
)

func TestIndependentJWKSFailureRecoveryAndQuietUnknownKey(t *testing.T) {
	v, key, now := requestFixture(t)
	originalFetch := v.fetch
	clock := now.Add(time.Minute)
	v.now = func() time.Time { return clock }
	cause := errors.New("private upstream credential")
	entered, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	v.fetch = func(context.Context) ([]byte, error) {
		if calls.Add(1) == 1 {
			close(entered)
		}
		<-release
		return nil, cause
	}
	results := make(chan error, 2)
	go func() { results <- v.Warm(context.Background()) }()
	<-entered
	go func() { results <- v.Warm(context.Background()) }()
	close(release)
	for range 2 {
		err := <-results
		if !errors.Is(err, cause) || err.Error() != string(Unavailable) {
			t.Fatal("concurrent refresh lost cause or leaked data")
		}
	}
	if calls.Load() != 1 {
		t.Fatal("refresh was not coalesced or backed off")
	}
	// A failed refresh must not revoke still-fresh known keys.
	raw := signFixture(t, key, fixtureClaims(now), nil)
	if _, err := v.verify(context.Background(), raw); err != nil {
		t.Fatal("known key rejected after refresh outage")
	}
	clock = clock.Add(time.Minute)
	v.fetch = originalFetch
	if err := v.Warm(context.Background()); err != nil {
		t.Fatal(err)
	}
	if v.lastError != nil || v.lastFailed {
		t.Fatal("successful refresh retained prior failure")
	}
	unknown := signFixture(t, key, fixtureClaims(now), map[string]any{"kid": "absent"})
	_, err := v.verify(context.Background(), unknown)
	if err != Unauthenticated {
		t.Fatal("unknown key after recovery did not remain expected auth denial")
	}
	if _, ok := diagnostic.Operation(err); ok {
		t.Fatal("expected unknown key generated diagnostic")
	}
}
