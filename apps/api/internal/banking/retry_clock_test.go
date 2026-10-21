package banking

import (
	"net/http"
	"testing"
	"time"
)

// Model elapsed time separately from wall-clock labels. The PostgreSQL tests
// exercise the actual due/visibility guards; this model varies offsets without
// changing the shared host or database clock.
func TestRetryMinimumAcrossStableClockOffsets(t *testing.T) {
	received := time.Date(2026, 10, 20, 8, 38, 49, 375000000, time.UTC)
	for _, guidance := range []struct {
		name, header string
		minimum      time.Time
		seconds      int
	}{
		{"integer", "130", received.Add(130 * time.Second), 130},
		{"date fractional delay", received.Add(130 * time.Second).Format(http.TimeFormat), received.Add(130 * time.Second).Truncate(time.Second), 130},
	} {
		for _, offset := range []time.Duration{0, -9249897 * time.Microsecond, -73 * time.Second, 73 * time.Second} {
			for _, latency := range []time.Duration{0, 350 * time.Millisecond, 2 * time.Second} {
				t.Run(guidance.name+"/offset="+offset.String()+"/latency="+latency.String(), func(t *testing.T) {
					delay := parseRetryAfter(guidance.header, received)
					seconds := retrySeconds(1, delay, 0)
					if seconds != guidance.seconds {
						t.Fatalf("delay=%s scheduled=%d seconds, want %d", delay, seconds, guidance.seconds)
					}
					databaseAtSchedule := received.Add(latency).Add(offset)
					due := databaseAtSchedule.Add(time.Duration(seconds) * time.Second)
					// Claim and scheduling use the same stable database offset.
					firstEligibleHost := due.Add(-offset)
					if firstEligibleHost.Before(guidance.minimum.Add(latency)) {
						t.Fatalf("eligible=%s minimum=%s latency=%s", firstEligibleHost, guidance.minimum, latency)
					}
					if !firstEligibleHost.Add(-time.Nanosecond).Add(offset).Before(due) || firstEligibleHost.Add(offset).Before(due) {
						t.Fatal("database eligibility boundary moved")
					}
					// Reproduce the misleading historical comparison: the database
					// label can precede the provider date while eligibility does not.
					if offset == -9249897*time.Microsecond && !due.Before(guidance.minimum) {
						t.Fatal("fixture did not reproduce cross-clock assertion failure")
					}
					// Negative control: truncating the fractional date delay really
					// does violate the minimum when no scheduling latency masks it.
					if delay%time.Second != 0 && latency == 0 {
						earlyDue := databaseAtSchedule.Add(delay.Truncate(time.Second))
						if !earlyDue.Add(-offset).Before(guidance.minimum) {
							t.Fatal("minimum check failed to detect deliberately early retry")
						}
					}
				})
			}
		}
	}
}

func TestPendingRetryClockAdjustmentLimit(t *testing.T) {
	received := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
	delay := time.Duration(retrySeconds(1, parseRetryAfter("130", received), 0)) * time.Second
	for _, tc := range []struct {
		name       string
		adjustment time.Duration
		early      bool
	}{
		{"stable", 0, false},
		{"database jumps forward while pending", 10 * time.Second, true},
		{"database jumps backward while pending", -10 * time.Second, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			const initialOffset = -73 * time.Second
			due := received.Add(initialOffset).Add(delay)
			firstEligibleHost := due.Add(-initialOffset - tc.adjustment)
			if early := firstEligibleHost.Before(received.Add(130 * time.Second)); early != tc.early {
				t.Fatalf("early=%t, want %t", early, tc.early)
			}
		})
	}
	// HTTP-date conversion additionally relies on host/provider wall-clock
	// agreement. A host already ahead at parsing can shorten the provider delay.
	providerMinimum := received.Add(130 * time.Second)
	aheadHost := received.Add(10 * time.Second)
	shortDelay := retrySeconds(1, parseRetryAfter(providerMinimum.Format(http.TimeFormat), aheadHost), 0)
	if !received.Add(time.Duration(shortDelay) * time.Second).Before(providerMinimum) {
		t.Fatal("model hid unsupported host/provider clock error")
	}
}
