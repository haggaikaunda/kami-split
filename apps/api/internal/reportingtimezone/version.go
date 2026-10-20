package reportingtimezone

import (
	"errors"
	"io"
	"strconv"
)

// Version is the positive independent preference counter, serialized as a decimal
// string and bounded to the exact JavaScript integer range for downstream consumers.
type Version int64

// UnmarshalGQL rejects numeric, noncanonical, zero and out-of-range versions.
func (v *Version) UnmarshalGQL(input any) error {
	text, ok := input.(string)
	if !ok {
		return errors.New("expected positive preference version string")
	}
	value, err := strconv.ParseInt(text, 10, 64)
	if err != nil || value < 1 || value > 9007199254740991 || strconv.FormatInt(value, 10) != text {
		return errors.New("expected positive preference version string")
	}
	*v = Version(value)
	return nil
}

// MarshalGQL writes the preference version without floating-point conversion.
func (v Version) MarshalGQL(w io.Writer) {
	_, _ = io.WriteString(w, strconv.Quote(strconv.FormatInt(int64(v), 10)))
}
