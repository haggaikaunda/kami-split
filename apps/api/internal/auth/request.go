package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type identityKey struct{}

// A nonzero-size allocation distinguishes independent authenticated requests.
type requestMarker struct{ value byte }
type identity struct {
	marker  *requestMarker
	subject string
	err     error
}
type claims struct {
	jwt.RegisteredClaims
	Role string `json:"role"`
}

func (v *Verifier) verify(ctx context.Context, raw string) (string, error) {
	if raw == "" || len(raw) > 16<<10 {
		return "", Unauthenticated
	}
	v.mu.Lock()
	epoch := v.epoch
	v.mu.Unlock()
	var c claims
	token, err := jwt.ParseWithClaims(raw, &c, func(token *jwt.Token) (any, error) {
		// URL/key headers are never trust inputs, even if accompanied by a known kid.
		for _, name := range []string{"jku", "x5u", "jwk", "x5c", "crit"} {
			if _, exists := token.Header[name]; exists {
				return nil, Unauthenticated
			}
		}
		return v.lookup(ctx, token)
	}, jwt.WithValidMethods([]string{"ES256"}), jwt.WithIssuer(v.config.Issuer), jwt.WithAudience(v.config.Audience), jwt.WithExpirationRequired(), jwt.WithIssuedAt(), jwt.WithLeeway(30*time.Second), jwt.WithTimeFunc(v.now), jwt.WithStrictDecoding())
	if err != nil {
		if errors.Is(err, Unavailable) {
			return "", Unavailable
		}
		return "", Unauthenticated
	}
	id, err := uuid.Parse(c.Subject)
	if token == nil || !token.Valid || err != nil || id == uuid.Nil || id.String() != c.Subject || c.Role != "authenticated" || c.IssuedAt == nil {
		return "", Unauthenticated
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if epoch != v.epoch || !v.usable(v.now()) || ctx.Err() != nil {
		return "", Unavailable
	}
	return c.Subject, nil
}

// Authenticate stores verified evidence or a safe failure in private request context.
// Public health may ignore that evidence; protected application operations must use
// WithActor. Client metadata and request inputs cannot construct this context key.
func (v *Verifier) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		evidence := identity{err: Unauthenticated, marker: &requestMarker{}}
		headers := r.Header.Values("Authorization")
		if len(headers) == 1 {
			parts := strings.Fields(headers[0])
			if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
				evidence.subject, evidence.err = v.verify(r.Context(), parts[1])
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), identityKey{}, evidence)))
	})
}

// Protect requires verified credentials before serving a protected HTTP handler.
// Application access is still checked transactionally by WithActor; verification
// alone never grants group access. Public health routes must not use this wrapper.
func (v *Verifier) Protect(next http.Handler) http.Handler {
	return v.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := requestIdentity(r.Context()); err != nil {
			WriteError(w, err)
			return
		}
		next.ServeHTTP(w, r)
	}))
}

func requestIdentity(ctx context.Context) (string, error) {
	evidence, ok := ctx.Value(identityKey{}).(identity)
	if !ok {
		return "", Unauthenticated
	}
	if evidence.err != nil {
		return "", evidence.err
	}
	if evidence.subject == "" {
		return "", Unauthenticated
	}
	return evidence.subject, nil
}

// Actor is the stable application identity read from the current transaction,
// never the Auth subject or a client-provided identifier.
type Actor struct{ ID pgtype.UUID }

// WithActor owns a READ COMMITTED transaction, binding only verified request
// evidence through the existing database helper. It checks current enabled access
// on every operation and supplies only a transaction-bound query handle. Callbacks
// must recheck group access through the database helpers and must not retain tx.
func WithActor(ctx context.Context, db *database.DB, fn func(pgx.Tx, Actor) error) error {
	subject, err := requestIdentity(ctx)
	if err != nil {
		return err
	}
	if db == nil {
		return Unavailable
	}
	err = db.WithIdentity(ctx, subject, func(tx pgx.Tx) error {
		viewer, err := database.ReadViewer(ctx, tx)
		if err != nil {
			return diagnostic.Wrap(Unavailable, err, "auth.viewer")
		}
		switch viewer.Status {
		case "DISABLED":
			return Disabled
		case "UNPROVISIONED":
			return Unprovisioned
		case "READY":
			if !viewer.ID.Valid {
				return diagnostic.Wrap(Unavailable, nil, "auth.viewer_state")
			}
			return fn(tx, Actor{ID: viewer.ID})
		default:
			return diagnostic.Wrap(Unavailable, nil, "auth.viewer_state")
		}
	})
	if err == nil {
		return nil
	}
	var outcome Outcome
	if errors.As(err, &outcome) {
		return err
	}
	return diagnostic.Wrap(Unavailable, err, "auth.transaction")
}

// WriteError maps only safe authentication outcomes to the #76 transport contract.
// Disabled/unprovisioned states are denied here; future ViewerAccess resolvers may
// expose their self-only state without enabling business access.
func WriteError(w http.ResponseWriter, err error) {
	code, status := "UNAVAILABLE", http.StatusServiceUnavailable
	var outcome Outcome
	if errors.As(err, &outcome) {
		switch outcome {
		case Unauthenticated:
			code, status = string(outcome), http.StatusUnauthorized
		case Disabled, Unprovisioned:
			code, status = string(outcome), http.StatusForbidden
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if status == http.StatusUnauthorized {
		w.Header().Set("WWW-Authenticate", `Bearer`)
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"errors": []any{map[string]any{"message": "access unavailable", "extensions": map[string]string{"code": code}}}})
}

// RequireRequest checks verified request evidence before protected GraphQL
// execution. Current application access is still checked inside each transaction.
func RequireRequest(ctx context.Context) error {
	_, err := requestIdentity(ctx)
	return err
}
