package graph

import (
	"context"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"time"
)

type todayKey struct{}

// WithResponseTime samples a single UTC date for every Viewer projection in one
// response, including aliases and node lookups that straddle UTC midnight.
func WithResponseTime(ctx context.Context, now time.Time) context.Context {
	return context.WithValue(ctx, todayKey{}, ledger.Date(now.UTC().Format("2006-01-02")))
}
func responseToday(ctx context.Context) ledger.Date {
	if today, ok := ctx.Value(todayKey{}).(ledger.Date); ok {
		return today
	}
	return ledger.Date(time.Now().UTC().Format("2006-01-02"))
}
