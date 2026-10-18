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
