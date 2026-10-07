package ledger

import (
	"crypto/sha256"
	"errors"
	"strconv"
	"strings"
)

// EditInput replaces the editable values of one expense at an explicit version.
// Input retains create validation, exact arithmetic and percentage intent.
type EditInput struct {
	Input
	ExpenseID       string
	ExpectedVersion int64
}

// NormalizeEdit binds an edit attempt to its expense, expected version and fully
// canonical replacement. It copies caller-owned slices through Normalize.
func NormalizeEdit(in EditInput) (EditInput, []byte, [32]byte, error) {
	if _, err := ParseID(in.ExpenseID, "Expense"); err != nil || in.ExpectedVersion < 1 {
		return EditInput{}, nil, [32]byte{}, errors.New("invalid expense or version")
	}
	normalized, canonical, _, err := Normalize(in.Input)
	if err != nil {
		return EditInput{}, nil, [32]byte{}, err
	}
	in.Input = normalized
	var b strings.Builder
	b.WriteString(`["edit-expense-v1",`)
	writeJSONString(&b, in.ExpenseID)
	b.WriteByte(',')
	writeJSONString(&b, strconv.FormatInt(in.ExpectedVersion, 10))
	b.WriteByte(',')
	b.Write(canonical)
	b.WriteByte(']')
	data := []byte(b.String())
	return in, data, sha256.Sum256(data), nil
}
