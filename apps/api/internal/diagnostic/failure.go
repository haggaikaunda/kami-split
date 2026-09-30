// Package diagnostic preserves private causes while exposing only safe outcomes.
// Owning transports report classifications, never errors or dependency payloads.
package diagnostic

import (
	"context"
	"errors"
)

type failure struct {
	outcome, cause error
	operation      string
}

// Error exposes only the safe application outcome.
func (f *failure) Error() string { return f.outcome.Error() }

// Unwrap permits internal inspection without formatting private diagnostics.
func (f *failure) Unwrap() []error {
	if f.cause == nil {
		return []error{f.outcome}
	}
	return []error{f.outcome, f.cause}
}

// Wrap preserves errors.Is/As for the public outcome and private cause. Operation
// must be a static server-defined label, never request or dependency content.
// Outcome must be non-nil and contain only a safe application message; cause may be nil.
func Wrap(outcome, cause error, operation string) error {
	return &failure{outcome: outcome, cause: cause, operation: operation}
}

// Operation returns a static diagnostic label only for unexpected failures.
func Operation(err error) (string, bool) {
	var f *failure
	if errors.As(err, &f) {
		return f.operation, true
	}
	return "", false
}

type reporterKey struct{}

// WithReporter installs the owning boundary's safe diagnostic sink.
func WithReporter(ctx context.Context, report func(string)) context.Context {
	return context.WithValue(ctx, reporterKey{}, report)
}

// Report forwards only unexpected classifications to the owning boundary. Future
// invitation transports/workers should call this when consuming returned errors.
func Report(ctx context.Context, err error) {
	if op, ok := Operation(err); ok {
		if report, ok := ctx.Value(reporterKey{}).(func(string)); ok {
			report(op)
		}
	}
}
