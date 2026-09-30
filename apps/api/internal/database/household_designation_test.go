package database

import (
	"context"
	"errors"
	"testing"
)

func TestHouseholdDesignationRejectsMalformedCommandsBeforeIO(t *testing.T) {
	first := "13000000-0000-4000-8000-000000000001"
	second := "13000000-0000-4000-8000-000000000002"
	for _, input := range []HouseholdDesignationInput{
		{Action: "REPLACE"},
		{Action: "READ", Version: -1},
		{Action: "PROPOSE", FirstUserID: first, SecondUserID: first},
		{Action: "PROPOSE", FirstUserID: second, SecondUserID: first},
		{Action: "CONSENT", FirstUserID: first},
		{Action: "CONSENT", FirstUserID: "invalid", SecondUserID: second},
		{Action: "END", FirstUserID: first},
	} {
		t.Run(input.Action+input.FirstUserID, func(t *testing.T) {
			var db *DB
			_, err := db.HouseholdDesignation(context.Background(), first, input)
			if !errors.Is(err, ErrHouseholdDesignationInput) {
				t.Fatalf("got %v", err)
			}
		})
	}
}
