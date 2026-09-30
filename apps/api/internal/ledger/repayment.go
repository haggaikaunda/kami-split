package ledger

import (
	"crypto/sha256"
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"
)

// RepaymentInput records an actual transfer within an explicit group. Creator is
// server-derived; neither a simplified edge nor the current balance caps Amount.
type RepaymentInput struct {
	GroupID, Key, SenderID, RecipientID, Currency, EffectiveDate, Note string
	Amount                                                             int64
}

// NormalizeRepayment binds losslessly representable intent to a versioned array.
// It preserves note whitespace and canonicalizes no financial direction or value.
func NormalizeRepayment(in RepaymentInput) (RepaymentInput, []byte, [32]byte, error) {
	fail := func() (RepaymentInput, []byte, [32]byte, error) {
		return RepaymentInput{}, nil, [32]byte{}, errors.New("invalid repayment identity or text")
	}
	for _, item := range []struct{ value, kind string }{{in.GroupID, "Group"}, {in.SenderID, "Membership"}, {in.RecipientID, "Membership"}} {
		if _, err := ParseID(item.value, item.kind); err != nil {
			return fail()
		}
	}
	var key OperationKey
	if key.UnmarshalGQL(in.Key) != nil {
		return fail()
	}
	var b strings.Builder
	b.WriteByte('[')
	for i, s := range []string{"record-repayment-v1", in.GroupID, in.SenderID, in.RecipientID, strconv.FormatInt(in.Amount, 10), in.Currency, in.EffectiveDate, in.Note} {
		if !utf8.ValidString(s) {
			return fail()
		}
		if i > 0 {
			b.WriteByte(',')
		}
		writeJSONString(&b, s)
	}
	b.WriteByte(']')
	canonical := []byte(b.String())
	return in, canonical, sha256.Sum256(canonical), nil
}

// ValidateRepayment checks record bounds and same-identity mistakes. Current
// access, same-group membership and account eligibility require locked DB reads.
func ValidateRepayment(in RepaymentInput) []FieldProblem {
	var fields []FieldProblem
	add := func(field, code, message string) {
		fields = append(fields, FieldProblem{[]string{"input", field}, code, message})
	}
	if in.Amount < 1 || in.Amount > MaxExpense {
		add("amountMinor", "OUT_OF_RANGE", "Use 1 to 999999999 cents.")
	}
	if in.Currency != "USD" {
		add("currency", "INVALID_INPUT", "Use USD.")
	}
	if in.SenderID == in.RecipientID {
		add("recipientId", "INVALID_PARTICIPANT", "Select distinct group members.")
	}
	if !ValidDate(in.EffectiveDate) {
		add("effectiveDate", "INVALID_INPUT", "Use a valid Gregorian date.")
	}
	if !utf8.ValidString(in.Note) || strings.ContainsRune(in.Note, 0) || utf8.RuneCountInString(in.Note) > 2000 {
		add("note", "INVALID_INPUT", "Use at most 2000 Unicode characters without NUL.")
	}
	return fields
}
