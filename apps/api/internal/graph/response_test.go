package graph

import (
	"context"
	"testing"
	"time"
)

func TestResponseTodayUsesOneUTCDate(t *testing.T) {
	sampled := time.Date(2026, 10, 1, 1, 0, 0, 0, time.FixedZone("east", 2*60*60))
	ctx := WithResponseTime(context.Background(), sampled)
	for i := 0; i < 10; i++ {
		if got := responseToday(ctx); got != "2026-09-30" {
			t.Fatalf("today=%s", got)
		}
	}
}
