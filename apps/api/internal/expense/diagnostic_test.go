package expense

import (
	"errors"
	"fmt"
	"testing"

	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestSafeErrorPreservesUnexpectedCause(t *testing.T) {
	cause := &pgconn.PgError{Code: "08006", Message: "SQL token recipient@example.test"}
	for _, original := range []error{cause, diagnostic.Wrap(auth.Unavailable, cause, "auth.viewer")} {
		err := safeError(original)
		if err.Error() != "UNAVAILABLE" || !errors.Is(err, Failure("UNAVAILABLE")) || !errors.Is(err, cause) {
			t.Fatalf("lost safe outcome/cause: %s", err)
		}
		var pgerr *pgconn.PgError
		if !errors.As(err, &pgerr) || pgerr != cause {
			t.Fatal("lost typed cause")
		}
		if _, ok := diagnostic.Operation(err); !ok {
			t.Fatal("missing diagnostic")
		}
	}
}
func TestExpectedExpenseOutcomesRemainQuiet(t *testing.T) {
	for _, original := range []error{pgx.ErrNoRows, &pgconn.PgError{Code: "42501"}, Failure("INVALID_INPUT"), auth.Disabled, auth.Unprovisioned} {
		if _, ok := diagnostic.Operation(safeError(original)); ok {
			t.Fatal("expected outcome marked unexpected")
		}
	}
}

func TestSafeErrorDoesNotExposeExpectedWrapperText(t *testing.T) {
	err := safeError(fmt.Errorf("private dependency text: %w", Failure("INVALID_INPUT")))
	if err.Error() != "INVALID_INPUT" {
		t.Fatal("private wrapper exposed")
	}
}
