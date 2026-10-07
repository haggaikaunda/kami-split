package profile

import (
	"strings"
	"testing"
)

func TestCanonicalName(t *testing.T) {
	for _, test := range []struct {
		input, want string
		valid       bool
	}{
		{"\u0085\u3000 Zoë 李 \u00a0", "Zoë 李", true},
		{"\u200b", "\u200b", true}, {"\ufeff", "\ufeff", true},
		{"\t\n\u202f", "", false},
		{strings.Repeat("😀", 120), strings.Repeat("😀", 120), true},
		{strings.Repeat("😀", 121), strings.Repeat("😀", 121), false},
		{"bad\x00name", "bad\x00name", false}, {"\xff", "", false},
	} {
		got, valid := canonicalName(test.input)
		if got != test.want || valid != test.valid {
			t.Errorf("canonicalName(%q)=(%q,%v), want (%q,%v)", test.input, got, valid, test.want, test.valid)
		}
	}
}
