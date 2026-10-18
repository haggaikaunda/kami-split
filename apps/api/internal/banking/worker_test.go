package banking

import (
	"testing"
	"time"
)

func TestRetryDelayBoundsAndProviderMinimum(t *testing.T) {
	for n := 1; n <= 10; n++ {
		for _, jitter := range []float64{0, .5, .999} {
			got := retryDelay(n, 0, jitter)
			if got < time.Minute || got > time.Hour {
				t.Fatalf("attempt %d: %s", n, got)
			}
		}
	}
	if got := retryDelay(1, 2*time.Hour, .5); got != 2*time.Hour {
		t.Fatal("provider minimum lost")
	}
	if retryDelay(2, 0, 0) != 2*time.Minute || retryDelay(1, 0, .5) <= time.Minute {
		t.Fatal("exponential jitter missing")
	}
}

func TestRetrySecondsNeverRoundsMinimumEarlier(t *testing.T) {
	for _, tc := range []struct {
		name     string
		attempt  int
		provider time.Duration
		jitter   float64
		want     int
	}{
		{name: "default minimum", attempt: 1, want: 60},
		{name: "fractional jitter", attempt: 1, jitter: .001, want: 61},
		{name: "fractional provider minimum", attempt: 1, provider: time.Minute + time.Nanosecond, want: 61},
		{name: "provider just below whole second", attempt: 1, provider: 2*time.Minute - time.Nanosecond, want: 120},
		{name: "provider exact whole second", attempt: 1, provider: 2 * time.Minute, want: 120},
		{name: "default ceiling", attempt: 10, jitter: .999, want: 3600},
		{name: "provider beyond default ceiling", attempt: 10, provider: time.Hour + time.Nanosecond, want: 3601},
		{name: "supported provider limit", attempt: 1, provider: 7 * 24 * time.Hour, want: 604800},
		{name: "just below supported provider limit", attempt: 1, provider: 7*24*time.Hour - time.Nanosecond, want: 604800},
		{name: "unsupported provider limit", attempt: 1, provider: 7*24*time.Hour + time.Nanosecond, want: 0},
		{name: "untrusted maximum duration", attempt: 1, provider: time.Duration(1<<63 - 1), want: 0},
		{name: "permanent rejection", attempt: 1, provider: -1, want: 0},
		{name: "untrusted minimum duration", attempt: 1, provider: time.Duration(-1 << 63), want: 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := retrySeconds(tc.attempt, tc.provider, tc.jitter); got != tc.want {
				t.Fatalf("scheduled %d seconds, want %d", got, tc.want)
			}
		})
	}
}
