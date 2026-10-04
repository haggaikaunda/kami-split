package expense

import (
	"errors"
	"testing"
)

func TestCheckedSpendingPreservesExactBoundsAndFailsClosed(t *testing.T) {
	for _, tc := range []struct {
		value   string
		want    int64
		invalid bool
	}{{"0", 0, false}, {"9007199254740993", 9007199254740993, false}, {"9223372036854775807", 9223372036854775807, false}, {"9223372036854775808", 0, true}, {"-1", 0, true}, {"bad", 0, true}} {
		got, err := checkedSpending(tc.value)
		if tc.invalid {
			if !errors.Is(err, Failure("AMOUNT_OVERFLOW")) {
				t.Fatal(tc, err)
			}
			continue
		}
		if err != nil || got != tc.want {
			t.Fatal(tc, got, err)
		}
	}
}
