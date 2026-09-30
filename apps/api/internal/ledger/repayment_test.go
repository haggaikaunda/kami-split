package ledger

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"
)

func repaymentFixture() RepaymentInput {
	return RepaymentInput{GroupID: testID("Group", 1), Key: "00000000-0000-4000-8000-000000000001", SenderID: testID("Membership", 1), RecipientID: testID("Membership", 2), Amount: 500, Currency: "USD", EffectiveDate: "2026-09-30"}
}

func TestRepaymentCanonicalContract(t *testing.T) {
	in := repaymentFixture()
	normalized, data, hash, err := NormalizeRepayment(in)
	if err != nil {
		t.Fatal(err)
	}
	want, _ := json.Marshal([]string{"record-repayment-v1", in.GroupID, in.SenderID, in.RecipientID, "500", "USD", "2026-09-30", ""})
	if !bytes.Equal(data, want) || hash != sha256.Sum256(want) || normalized != in {
		t.Fatalf("unexpected normalization: %+v %s", normalized, data)
	}
	changes := []struct {
		name   string
		change func(*RepaymentInput)
	}{
		{"group", func(i *RepaymentInput) { i.GroupID = testID("Group", 2) }},
		{"sender", func(i *RepaymentInput) { i.SenderID = testID("Membership", 3) }},
		{"recipient", func(i *RepaymentInput) { i.RecipientID = testID("Membership", 3) }},
		{"direction", func(i *RepaymentInput) { i.SenderID, i.RecipientID = i.RecipientID, i.SenderID }},
		{"amount", func(i *RepaymentInput) { i.Amount++ }},
		{"currency", func(i *RepaymentInput) { i.Currency = "EUR" }},
		{"date", func(i *RepaymentInput) { i.EffectiveDate = "2026-10-01" }},
		{"note whitespace", func(i *RepaymentInput) { i.Note = " " }},
	}
	for _, tt := range changes {
		t.Run(tt.name, func(t *testing.T) {
			other := in
			tt.change(&other)
			_, got, h, e := NormalizeRepayment(other)
			if e != nil || bytes.Equal(got, data) || h == hash {
				t.Fatalf("distinct intent collapsed: %s %v", got, e)
			}
		})
	}
	other := in
	other.Key = "00000000-0000-4000-8000-000000000002"
	_, got, h, e := NormalizeRepayment(other)
	if e != nil || !bytes.Equal(got, data) || h != hash {
		t.Fatal("key belongs to operation scope, not canonical payload", e)
	}
	in.Note = " <é/\u2028>\n\t\"\\\x01 "
	normalized, data, _, err = NormalizeRepayment(in)
	if err != nil || normalized.Note != in.Note || !json.Valid(data) || !bytes.Contains(data, []byte("<é/\u2028>")) || !bytes.Contains(data, []byte(`\n\t\"\\\u0001`)) {
		t.Fatalf("lossy note encoding: %s %v", data, err)
	}
}

func TestRepaymentMalformedIdentityAndUnicode(t *testing.T) {
	tests := []struct {
		name   string
		change func(*RepaymentInput)
	}{
		{"group type", func(i *RepaymentInput) { i.GroupID = testID("Membership", 1) }},
		{"sender type", func(i *RepaymentInput) { i.SenderID = testID("Group", 1) }},
		{"recipient malformed", func(i *RepaymentInput) { i.RecipientID = "not-an-id" }},
		{"key malformed", func(i *RepaymentInput) { i.Key = "not-a-key" }},
		{"invalid utf8", func(i *RepaymentInput) { i.Note = string([]byte{0xff}) }},
		{"surrogate encoding", func(i *RepaymentInput) { i.Note = string([]byte{0xed, 0xa0, 0x80}) }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := repaymentFixture()
			tt.change(&in)
			if _, _, _, e := NormalizeRepayment(in); e == nil {
				t.Fatal("accepted malformed input")
			}
		})
	}
}

func TestRepaymentValidationBoundaries(t *testing.T) {
	for _, amount := range []int64{1, 500, 999999999} {
		for _, date := range []string{"0001-01-01", "2000-02-29", "9999-12-31"} {
			in := repaymentFixture()
			in.Amount = amount
			in.EffectiveDate = date
			in.Note = strings.Repeat("😀", 2000)
			if p := ValidateRepayment(in); len(p) != 0 {
				t.Fatalf("valid boundary rejected: %d %s %+v", amount, date, p)
			}
		}
	}
	tests := []struct {
		name, field, code string
		change            func(*RepaymentInput)
	}{
		{"zero", "amountMinor", "OUT_OF_RANGE", func(i *RepaymentInput) { i.Amount = 0 }},
		{"negative", "amountMinor", "OUT_OF_RANGE", func(i *RepaymentInput) { i.Amount = -1 }},
		{"above ceiling", "amountMinor", "OUT_OF_RANGE", func(i *RepaymentInput) { i.Amount = 1000000000 }},
		{"int64 max", "amountMinor", "OUT_OF_RANGE", func(i *RepaymentInput) { i.Amount = math.MaxInt64 }},
		{"int64 min", "amountMinor", "OUT_OF_RANGE", func(i *RepaymentInput) { i.Amount = math.MinInt64 }},
		{"currency", "currency", "INVALID_INPUT", func(i *RepaymentInput) { i.Currency = "EUR" }},
		{"invalid date", "effectiveDate", "INVALID_INPUT", func(i *RepaymentInput) { i.EffectiveDate = "1900-02-29" }},
		{"NUL", "note", "INVALID_INPUT", func(i *RepaymentInput) { i.Note = "a\x00b" }},
		{"long unicode", "note", "INVALID_INPUT", func(i *RepaymentInput) { i.Note = strings.Repeat("😀", 2001) }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := repaymentFixture()
			tt.change(&in)
			normalized, _, _, e := NormalizeRepayment(in)
			if e != nil {
				t.Fatalf("domain failure must remain bindable: %v", e)
			}
			found := false
			for _, p := range ValidateRepayment(normalized) {
				if reflect.DeepEqual(p.Path, []string{"input", tt.field}) && p.Code == tt.code && p.Message != "" {
					found = true
				}
			}
			if !found {
				t.Fatalf("missing safe %s/%s problem", tt.field, tt.code)
			}
		})
	}
	in := repaymentFixture()
	in.RecipientID = in.SenderID
	if p := ValidateRepayment(in); len(p) == 0 {
		t.Fatal("self repayment accepted")
	}
}

func TestRepaymentApprovedEffectsAndD2D4(t *testing.T) {
	a, b, c := testID("Membership", 1), testID("Membership", 2), testID("Membership", 3)
	cases := []struct {
		name        string
		total       int64
		positions   []Position
		nets        []int64
		obligations []Obligation
	}{
		{"partial", 2000, []Position{{MemberID: a, Owed: 2000, Sent: 500}, {MemberID: b, Paid: 2000, Received: 500}}, []int64{-1500, 1500}, []Obligation{{a, b, 1500}}},
		{"overpayment reverses", 2000, []Position{{MemberID: a, Owed: 2000, Sent: 2500}, {MemberID: b, Paid: 2000, Received: 2500}}, []int64{500, -500}, []Obligation{{b, a, 500}}},
		{"unmatched edge", 2000, []Position{{MemberID: a, Owed: 2000, Sent: 2600}, {MemberID: b, Paid: 2000, Received: 2500}, {MemberID: c, Received: 100}}, []int64{600, -500, -100}, []Obligation{{b, a, 500}, {c, a, 100}}},
		{"settled group accepts actual transfer", 0, []Position{{MemberID: a, Sent: 100}, {MemberID: b, Received: 100}}, []int64{100, -100}, []Obligation{{b, a, 100}}},
		{"D2 household paid", 2000, []Position{{MemberID: a, Owed: 2000, Sent: 2000}, {MemberID: b, Paid: 2000, Received: 2000}}, []int64{0, 0}, nil},
		{"D2 trip stays unpaid", 2000, []Position{{MemberID: a, Paid: 2000}, {MemberID: b, Owed: 2000}}, []int64{2000, -2000}, []Obligation{{b, a, 2000}}},
		{"D3 cycle", 6000, []Position{{MemberID: a, Paid: 2000, Owed: 2000}, {MemberID: b, Paid: 2000, Owed: 2000}, {MemberID: c, Paid: 2000, Owed: 2000}}, []int64{0, 0, 0}, nil},
		{"D3 actual transfer after cycle", 6000, []Position{{MemberID: a, Paid: 2000, Owed: 2000, Sent: 100}, {MemberID: b, Paid: 2000, Owed: 2000, Received: 100}, {MemberID: c, Paid: 2000, Owed: 2000}}, []int64{100, -100, 0}, []Obligation{{b, a, 100}}},
		{"D4 direct repayment", 4000, []Position{{MemberID: a, Owed: 2000, Sent: 2000}, {MemberID: b, Paid: 2000, Owed: 2000}, {MemberID: c, Paid: 2000, Received: 2000}}, []int64{0, 0, 0}, nil},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			original := append([]Position(nil), tt.positions...)
			got, e := Balances(tt.total, tt.positions)
			if e != nil {
				t.Fatal(e)
			}
			if got.Total != tt.total || got.Settled != (len(tt.obligations) == 0) || len(got.Obligations) != len(tt.obligations) {
				t.Fatalf("incorrect projection: %+v", got)
			}
			for i, p := range got.Positions {
				if p.Net != tt.nets[i] {
					t.Fatalf("net[%d]=%d want %d", i, p.Net, tt.nets[i])
				}
			}
			for i, o := range got.Obligations {
				if o != tt.obligations[i] {
					t.Fatalf("obligation %v want %v", o, tt.obligations[i])
				}
			}
			if !reflect.DeepEqual(original, tt.positions) {
				t.Fatal("mutated caller history")
			}
		})
	}
}

func TestRepaymentWideArithmeticAndInvalidAggregates(t *testing.T) {
	a, b := testID("Membership", 1), testID("Membership", 2)
	// paid+sent and owed+received exceed int64, while all exposed values fit.
	got, e := Balances(math.MaxInt64, []Position{{MemberID: a, Paid: math.MaxInt64, Sent: math.MaxInt64, Received: math.MaxInt64}, {MemberID: b, Owed: math.MaxInt64}})
	if e != nil || len(got.Obligations) != 1 || got.Obligations[0] != (Obligation{b, a, math.MaxInt64}) {
		t.Fatalf("valid cancellation overflowed: %+v %v", got, e)
	}
	cases := []struct {
		name      string
		total     int64
		positions []Position
	}{
		{"negative sent", 0, []Position{{MemberID: a, Sent: -1}, {MemberID: b, Received: -1}}},
		{"negative received", 0, []Position{{MemberID: a, Received: -1}, {MemberID: b, Sent: -1}}},
		{"unbalanced transfers", 0, []Position{{MemberID: a, Sent: 2}, {MemberID: b, Received: 1}}},
		{"expense conservation still required", 1, []Position{{MemberID: a, Sent: 1}, {MemberID: b, Received: 1}}},
		{"positive and negative net overflow", math.MaxInt64, []Position{{MemberID: a, Paid: math.MaxInt64, Sent: 1}, {MemberID: b, Owed: math.MaxInt64, Received: 1}}},
		{"min int64 magnitude forbidden", math.MaxInt64, []Position{{MemberID: a, Owed: math.MaxInt64, Received: 1}, {MemberID: b, Paid: math.MaxInt64, Sent: 1}}},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			got, e := Balances(tt.total, tt.positions)
			if e == nil {
				t.Fatalf("invalid ledger reported as available: %+v", got)
			}
		})
	}
}
