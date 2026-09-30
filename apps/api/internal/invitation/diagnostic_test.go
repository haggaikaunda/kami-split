package invitation

import (
	"errors"
	"testing"

	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestSafeInvitationFailurePreservesCause(t *testing.T) {
	cause := errors.New("recipient@example.test token SQL password")
	for _, original := range []error{cause, diagnostic.Wrap(auth.Unavailable, cause, "auth.email_provider")} {
		err := safe(original)
		if !errors.Is(err, cause) || (err.Error() != "UNAVAILABLE" && err.Error() != "AUTH_UNAVAILABLE") {
			t.Fatalf("unsafe/missing cause: %s", err)
		}
		if _, ok := diagnostic.Operation(err); !ok {
			t.Fatal("missing diagnostic")
		}
	}
	for _, original := range []error{Outcome("NOT_CLAIMABLE"), Outcome("INVALID_INPUT"), &pgconn.PgError{Code: "42501"}, auth.VerifyEmail} {
		if _, ok := diagnostic.Operation(safe(original)); ok {
			t.Fatal("expected failure marked unexpected")
		}
	}
}
