package ledger

import (
	"bytes"
	"testing"
)

func TestEditCanonicalBindsVersionExpenseAndPercentageIntent(t *testing.T) {
	id := func(kind, raw string) string { return PublicID(kind, raw) }
	a := id("Membership", "00000000-0000-4000-8000-000000000001")
	b := id("Membership", "00000000-0000-4000-8000-000000000002")
	in := EditInput{Input: Input{GroupID: id("Group", "00000000-0000-4000-8000-000000000003"), Key: "00000000-0000-4000-8000-000000000004", Currency: "USD", Total: 1, Description: " food ", EffectiveDate: "2026-10-06", Category: "DINING", PayerID: a, ParticipantIDs: []string{b, a}, Split: "PERCENTAGE", Percentages: []Percentage{{ParticipantID: b, Hundredths: 4900}, {ParticipantID: a, Hundredths: 5100}}}, ExpenseID: id("Expense", "00000000-0000-4000-8000-000000000005"), ExpectedVersion: 1}
	normalized, canonical, _, err := NormalizeEdit(in)
	if err != nil {
		t.Fatal(err)
	}
	if in.ParticipantIDs[0] != b || normalized.Description != "food" {
		t.Fatal("canonicalization ownership or trim")
	}
	reordered := in
	reordered.ParticipantIDs = []string{a, b}
	reordered.Percentages = []Percentage{{ParticipantID: a, Hundredths: 5100}, {ParticipantID: b, Hundredths: 4900}}
	_, same, _, _ := NormalizeEdit(reordered)
	if !bytes.Equal(canonical, same) {
		t.Fatal("order changed canonical edit")
	}
	for _, change := range []func(*EditInput){func(v *EditInput) { v.ExpectedVersion++ }, func(v *EditInput) { v.ExpenseID = id("Expense", "00000000-0000-4000-8000-000000000006") }, func(v *EditInput) {
		v.Percentages = []Percentage{{ParticipantID: a, Hundredths: 5200}, {ParticipantID: b, Hundredths: 4800}}
	}, func(v *EditInput) { v.Note = " " }} {
		modified := in
		change(&modified)
		_, other, _, e := NormalizeEdit(modified)
		if e != nil || bytes.Equal(canonical, other) {
			t.Fatal("material intent failed canonical binding")
		}
	}
}
