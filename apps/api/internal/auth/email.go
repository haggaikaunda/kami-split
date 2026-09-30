package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/jackc/pgx/v5"
)

// CanonicalEmail accepts ASCII, unquoted addr-specs with ordinary DNS labels.
// Unicode outer whitespace is trimmed; dots and plus-tags retain their meaning.
func CanonicalEmail(raw string) (string, error) {
	email := strings.TrimSpace(raw)
	invalid := func() (string, error) { return "", errors.New("invalid invitation email") }
	if len(email) > 254 || strings.Count(email, "@") != 1 {
		return invalid()
	}
	local, domain, _ := strings.Cut(email, "@")
	if len(local) == 0 || len(local) > 64 || strings.HasPrefix(local, ".") || strings.HasSuffix(local, ".") || strings.Contains(local, "..") {
		return invalid()
	}
	for _, c := range local {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || strings.ContainsRune(".!#$%&'*+-/=?^_`{|}~", c)) {
			return invalid()
		}
	}
	if len(domain) == 0 || len(domain) > 253 {
		return invalid()
	}
	for _, label := range strings.Split(domain, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return invalid()
		}
		for _, c := range label {
			if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-') {
				return invalid()
			}
		}
	}
	return strings.ToLower(email), nil
}

// ProviderEmail is returned only by a trusted server-configured Auth provider.
// Subject must be the subject actually returned by a fresh provider getUser call.
type ProviderEmail struct {
	Subject  string
	Email    string
	Verified bool
}

// CurrentEmailProvider fetches current server-side email evidence, never JWT
// email claims, a profile cache, or browser-supplied user metadata. The #80
// adapter must be request-scoped and use the same bearer token verified by
// Authenticate for getUser; subject lookup alone is not sufficient evidence.
type CurrentEmailProvider interface {
	CurrentEmail(context.Context, string) (ProviderEmail, error)
}

// EmailEvidence is opaque request-bound evidence. Its zero value is invalid.
type EmailEvidence struct {
	subject, email string
	marker         *requestMarker
	observed       time.Time
}

// VerifyEmail identifies a current authenticated account that still needs email verification.
const VerifyEmail Outcome = "VERIFY_EMAIL"

// ObserveCurrentEmail performs provider I/O before acquiring database locks.
func ObserveCurrentEmail(ctx context.Context, provider CurrentEmailProvider) (EmailEvidence, error) {
	subject, err := requestIdentity(ctx)
	if err != nil {
		return EmailEvidence{}, err
	}
	if provider == nil {
		return EmailEvidence{}, Unavailable
	}
	observed := time.Now()
	result, err := provider.CurrentEmail(ctx, subject)
	if err != nil {
		return EmailEvidence{}, diagnostic.Wrap(Unavailable, err, "auth.email_provider")
	}
	if ctx.Err() != nil {
		return EmailEvidence{}, diagnostic.Wrap(Unavailable, ctx.Err(), "auth.email_provider")
	}
	if result.Subject != subject {
		return EmailEvidence{}, Unauthenticated
	}
	if !result.Verified {
		return EmailEvidence{}, VerifyEmail
	}
	email, err := CanonicalEmail(result.Email)
	if err != nil {
		return EmailEvidence{}, Unauthenticated
	}
	request, _ := ctx.Value(identityKey{}).(identity)
	evidence := EmailEvidence{subject: subject, email: email, marker: request.marker, observed: observed}
	if _, err = evidence.CanonicalEmail(ctx); err != nil {
		return EmailEvidence{}, err
	}
	return evidence, nil
}

// CanonicalEmail validates request binding and a five-second monotonic age bound.
// Admission must call this after acquiring its database locks, immediately before
// using the email; stale evidence requires a fresh observation outside locks.
func (e EmailEvidence) CanonicalEmail(ctx context.Context) (string, error) {
	subject, err := requestIdentity(ctx)
	if err != nil {
		return "", err
	}
	age := time.Since(e.observed)
	if ctx.Err() != nil || e.observed.IsZero() || age < 0 || age > 5*time.Second {
		return "", Unavailable
	}
	request, _ := ctx.Value(identityKey{}).(identity)
	if e.marker == nil || request.marker != e.marker || e.subject != subject || e.email == "" {
		return "", Unauthenticated
	}
	return e.email, nil
}

// String prevents accidental structured formatting from revealing the email.
func (e EmailEvidence) String() string { return "[redacted email evidence]" }

// GoString also redacts Go-syntax diagnostic formatting.
func (e EmailEvidence) GoString() string { return e.String() }

// WithVerifiedIdentity binds only private verified request identity and permits
// unprovisioned admission. Disabled users remain denied. The callback owns domain
// errors and must enforce its operation-specific authorization inside the tx.
func WithVerifiedIdentity(ctx context.Context, db *database.DB, fn func(pgx.Tx) error) error {
	subject, err := requestIdentity(ctx)
	if err != nil {
		return err
	}
	if db == nil {
		return Unavailable
	}
	return db.WithIdentity(ctx, subject, func(tx pgx.Tx) error {
		viewer, err := database.ReadViewer(ctx, tx)
		if err != nil {
			return diagnostic.Wrap(Unavailable, err, "auth.viewer")
		}
		switch viewer.Status {
		case "DISABLED":
			return Disabled
		case "READY", "UNPROVISIONED":
			return fn(tx)
		default:
			return diagnostic.Wrap(Unavailable, nil, "auth.viewer_state")
		}
	})
}
