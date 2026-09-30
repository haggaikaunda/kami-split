package main

import (
	"strings"
	"testing"
)

func TestPrivateInputRejectsAmbiguityWithoutEcho(t *testing.T) {
	for _, input := range []string{`{"email":"secret@example.invalid","password":"private"}`, `{"email":"secret@example.invalid"} {}`, `{"email":`, strings.Repeat(" ", 8193)} {
		var target struct {
			Email string `json:"email"`
		}
		err := readInput(strings.NewReader(input), &target)
		if err == nil || strings.Contains(err.Error(), "secret@example.invalid") || strings.Contains(err.Error(), "private") {
			t.Fatal("ambiguous input or leaked input")
		}
	}
	var target struct {
		Email string `json:"email"`
	}
	if err := readInput(strings.NewReader(`{"email":"synthetic@example.invalid"}`), &target); err != nil || target.Email != "synthetic@example.invalid" {
		t.Fatal("valid input rejected")
	}
}
