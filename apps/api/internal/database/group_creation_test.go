package database

import (
	"errors"
	"testing"
)

func TestGroupCreationScalarBoundary(t *testing.T) {
	base := GroupCreationInput{OperationKey: "a3000000-0000-4000-8000-000000000001", Name: "group", Kind: "TRIP", Trip: &GroupTripInput{StartDate: "0001-01-01", EndDate: "9999-12-31"}}
	if err := validateGroupCreationScalars(base); err != nil {
		t.Fatal(err)
	}
	for _, date := range []string{"0000-01-01", "2026-02-29", "2024-2-01", "2024-01-01T00:00:00Z", "10000-01-01", "2024-01-01 BC"} {
		t.Run(date, func(t *testing.T) {
			input := base
			input.Trip = &GroupTripInput{StartDate: date, EndDate: "2026-01-01"}
			if !errors.Is(validateGroupCreationScalars(input), ErrGroupCreationInput) {
				t.Fatal("accepted invalid date")
			}
		})
	}
	for _, name := range []string{"a\x00b", string([]byte{0xed, 0xa0, 0x80}), string([]byte{0xff})} {
		input := base
		input.Name = name
		if !errors.Is(validateGroupCreationScalars(input), ErrGroupCreationInput) {
			t.Fatal("accepted invalid Unicode")
		}
	}
	// Domain errors must reach SQL and durably reserve the operation key.
	input := base
	input.Name = " \t\r\n"
	input.Kind = "ORDINARY"
	if err := validateGroupCreationScalars(input); err != nil {
		t.Fatal("domain validation incorrectly rejected before persistence")
	}
}
