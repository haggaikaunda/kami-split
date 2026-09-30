// Package ledger implements exact financial and wire-contract rules without
// database or GraphQL runtime dependencies.
package ledger

import (
	"errors"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// MinorUnits is a checked signed int64 amount, encoded only as a decimal string.
// Field-specific monetary limits are enforced separately by Validate and Balances.
type MinorUnits int64

// Revision is the nonnegative financial projection counter, not an access token
// or a metadata version. It uses a decimal string on the wire.
type Revision int64

// Date is a Gregorian date without a timezone, in years 0001 through 9999.
type Date string

// DateTime is a UTC timestamp serialized with exactly six fractional digits.
type DateTime string

// OperationKey identifies a client-created attempt using a canonical UUID v4.
// Possession confers no access; persistence binds it to actor, group and operation.
type OperationKey string

func integerString(value any) (int64, error) {
	s, ok := value.(string)
	if !ok || s == "" || len(s) > 20 {
		return 0, errors.New("expected canonical integer string")
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || strconv.FormatInt(n, 10) != s {
		return 0, errors.New("expected canonical integer string")
	}
	return n, nil
}

// UnmarshalGQL rejects numeric JSON/GraphQL inputs, noncanonical syntax and overflow.
func (m *MinorUnits) UnmarshalGQL(v any) error {
	n, e := integerString(v)
	if e == nil {
		*m = MinorUnits(n)
	}
	return e
}

// MarshalGQL writes exact cents as a JSON string, never a floating point number.
func (m MinorUnits) MarshalGQL(w io.Writer) {
	_, _ = io.WriteString(w, strconv.Quote(strconv.FormatInt(int64(m), 10)))
}

// UnmarshalGQL accepts only canonical, nonnegative int64 strings.
func (r *Revision) UnmarshalGQL(v any) error {
	n, e := integerString(v)
	if e != nil {
		return e
	}
	if n < 0 {
		return errors.New("expected nonnegative revision")
	}
	*r = Revision(n)
	return nil
}

// MarshalGQL emits the financial counter as a decimal string.
func (r Revision) MarshalGQL(w io.Writer) {
	_, _ = io.WriteString(w, strconv.Quote(strconv.FormatInt(int64(r), 10)))
}

// ValidDate checks both fixed ASCII syntax and the Gregorian calendar.
func ValidDate(s string) bool {
	if len(s) != 10 || s[4] != '-' || s[7] != '-' || s[:4] == "0000" {
		return false
	}
	for i, c := range s {
		if i != 4 && i != 7 && (c < '0' || c > '9') {
			return false
		}
	}
	t, e := time.Parse("2006-01-02", s)
	return e == nil && t.Format("2006-01-02") == s
}

// UnmarshalGQL rejects timestamps and impossible or noncanonical dates.
func (d *Date) UnmarshalGQL(v any) error {
	s, ok := v.(string)
	if !ok || !ValidDate(s) {
		return errors.New("expected Gregorian YYYY-MM-DD")
	}
	*d = Date(s)
	return nil
}

// MarshalGQL writes the already-validated calendar date.
func (d Date) MarshalGQL(w io.Writer) { _, _ = io.WriteString(w, strconv.Quote(string(d))) }

// UnmarshalGQL requires the same canonical UTC form emitted by the server.
func (d *DateTime) UnmarshalGQL(v any) error {
	s, ok := v.(string)
	if !ok {
		return errors.New("expected UTC timestamp")
	}
	t, e := time.Parse("2006-01-02T15:04:05.000000Z", s)
	if e != nil || t.Year() < 1 || t.Format("2006-01-02T15:04:05.000000Z") != s {
		return errors.New("expected UTC timestamp")
	}
	*d = DateTime(s)
	return nil
}

// MarshalGQL writes the UTC timestamp as a JSON string.
func (d DateTime) MarshalGQL(w io.Writer) { _, _ = io.WriteString(w, strconv.Quote(string(d))) }

// UnmarshalGQL accepts only lowercase UUID v4 values with the RFC variant.
func (k *OperationKey) UnmarshalGQL(v any) error {
	s, ok := v.(string)
	if !ok || !validUUID(s) {
		return errors.New("expected canonical UUID v4")
	}
	*k = OperationKey(s)
	return nil
}

// MarshalGQL writes the public attempt key; authorization is always independent.
func (k OperationKey) MarshalGQL(w io.Writer) { _, _ = io.WriteString(w, strconv.Quote(string(k))) }

func validUUID(s string) bool {
	u, e := uuid.Parse(s)
	return e == nil && u.String() == s && u.Version() == 4 && u.Variant() == uuid.RFC4122
}

// ParseID verifies the exact version, type and canonical UUID v4 representation.
// An empty expectedType permits any of the supported node types.
func ParseID(public, expectedType string) (string, error) {
	if len(public) > 64 {
		return "", errors.New("invalid public ID")
	}
	p := strings.Split(public, ":")
	if len(p) != 3 || p[0] != "ks1" || !validUUID(p[2]) {
		return "", errors.New("invalid public ID")
	}
	switch p[1] {
	case "Viewer", "Group", "Membership", "Expense", "Repayment":
	default:
		return "", errors.New("invalid public ID")
	}
	if expectedType != "" && p[1] != expectedType {
		return "", errors.New("invalid public ID type")
	}
	return p[2], nil
}

// PublicID encodes a trusted canonical internal UUID and supported node type.
// Untrusted input must first pass ParseID; this function does not authorize it.
func PublicID(kind, raw string) string { return "ks1:" + kind + ":" + raw }
