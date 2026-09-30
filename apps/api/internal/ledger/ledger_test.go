package ledger

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"
)

func testID(kind string, n int) string {
	return PublicID(kind, fmt.Sprintf("00000000-0000-4000-8000-%012d", n))
}
func validInput() Input {
	return Input{GroupID: testID("Group", 1), Key: "00000000-0000-4000-8000-000000000001", Currency: "USD", Description: "Dinner", EffectiveDate: "2026-09-29", Category: "DINING", PayerID: testID("Membership", 3), Split: "EQUAL", Total: 1000, ParticipantIDs: []string{testID("Membership", 3), testID("Membership", 1), testID("Membership", 2)}}
}

func TestMinorUnitsExactWire(t *testing.T) {
	for _, s := range []string{"0", "1", "-1", "9007199254740993", "9223372036854775807", "-9223372036854775808"} {
		t.Run(s, func(t *testing.T) {
			var m MinorUnits
			if e := m.UnmarshalGQL(s); e != nil {
				t.Fatal(e)
			}
			var out bytes.Buffer
			m.MarshalGQL(&out)
			if out.String() != `"`+s+`"` {
				t.Fatal(out.String())
			}
		})
	}
	for _, v := range []any{nil, 1, int64(1), float64(1), json.Number("1"), "", "-0", "+1", "01", " 1", "1 ", "1.0", "1e2", "１２", "NaN", "Infinity", "9223372036854775808", "-9223372036854775809", "000000000000000000000"} {
		var m MinorUnits
		if m.UnmarshalGQL(v) == nil {
			t.Errorf("accepted %#v", v)
		}
	}
}
func TestOtherScalarBoundaries(t *testing.T) {
	for _, s := range []string{"0001-01-01", "9999-12-31", "2000-02-29"} {
		var d Date
		if e := d.UnmarshalGQL(s); e != nil {
			t.Fatal(s, e)
		}
	}
	for _, s := range []string{"0000-01-01", "1900-02-29", "2026-2-01", "2026-01-01Z", "2026-04-31"} {
		var d Date
		if d.UnmarshalGQL(s) == nil {
			t.Error(s)
		}
	}
	var r Revision
	if r.UnmarshalGQL("9223372036854775807") != nil || r.UnmarshalGQL("-1") == nil || r.UnmarshalGQL(1) == nil {
		t.Fatal("revision coercion")
	}
	var d DateTime
	if d.UnmarshalGQL("2026-09-29T12:34:56.123456Z") != nil {
		t.Fatal("UTC rejected")
	}
	for _, s := range []string{"2026-09-29T12:34:56Z", "2026-09-29T12:34:56.123456+00:00", "0000-01-01T00:00:00.000000Z"} {
		if d.UnmarshalGQL(s) == nil {
			t.Error(s)
		}
	}
	var k OperationKey
	for _, s := range []string{"00000000-0000-1000-8000-000000000001", "00000000-0000-4000-7000-000000000001", "00000000-0000-4000-8000-00000000000A", "{00000000-0000-4000-8000-000000000001}"} {
		if k.UnmarshalGQL(s) == nil {
			t.Error(s)
		}
	}
}
func TestTypedPublicIDs(t *testing.T) {
	for _, kind := range []string{"Viewer", "Group", "Membership", "Expense"} {
		if _, e := ParseID(testID(kind, 1), kind); e != nil {
			t.Fatal(e)
		}
	}
	for _, s := range []string{testID("User", 1), strings.Replace(testID("Group", 1), "ks1", "ks2", 1), testID("Viewer", 1), "1", strings.ToUpper(testID("Group", 1)), testID("Group", 1) + "x"} {
		if _, e := ParseID(s, "Group"); e == nil {
			t.Error(s)
		}
	}
}
func TestEqualSplitAndCanonicalIntent(t *testing.T) {
	original := validInput()
	in, data, hash, e := Normalize(original)
	if e != nil {
		t.Fatal(e)
	}
	a, p := Validate(in)
	if len(p) > 0 {
		t.Fatal(p)
	}
	if a[0].Amount != 334 || a[1].Amount != 333 || a[2].Amount != 333 {
		t.Fatal(a)
	}
	if original.ParticipantIDs[0] != testID("Membership", 3) {
		t.Fatal("mutated caller slice")
	}
	other := validInput()
	other.ParticipantIDs = []string{testID("Membership", 2), testID("Membership", 3), testID("Membership", 1)}
	other.Description = " \tDinner\r\n"
	_, data2, hash2, e := Normalize(other)
	if e != nil || !bytes.Equal(data, data2) || hash != hash2 {
		t.Fatal("equivalent input not canonical")
	}
	other.Note = " "
	_, data2, _, _ = Normalize(other)
	if bytes.Equal(data, data2) {
		t.Fatal("note whitespace lost")
	}
	other = validInput()
	other.ExactAllocations = []Allocation{}
	_, data2, _, _ = Normalize(other)
	if bytes.Equal(data, data2) {
		t.Fatal("nil and empty list conflated")
	}
	if _, p = Validate(other); len(p) == 0 {
		t.Fatal("equal accepted exact empty list")
	}
}
func TestCanonicalJSONPreservesUnicodeAndOnlyMandatoryEscapes(t *testing.T) {
	in := validInput()
	in.Description = "<é/\u2028>"
	in.Note = "line\n\t\"\\\x01"
	_, data, _, e := Normalize(in)
	if e != nil {
		t.Fatal(e)
	}
	if !json.Valid(data) || !bytes.Contains(data, []byte("<é/\u2028>")) || !bytes.Contains(data, []byte(`line\n\t\"\\\u0001`)) {
		t.Fatalf("unexpected canonical form: %s", data)
	}
	in.Note = string([]byte{0xff})
	if _, _, _, e = Normalize(in); e == nil {
		t.Fatal("invalid UTF8 accepted")
	}
}
func TestExactZeroAndValidation(t *testing.T) {
	in := validInput()
	in.Split = "EXACT"
	in.ParticipantIDs = []string{testID("Membership", 1), testID("Membership", 2)}
	in.ExactAllocations = []Allocation{{testID("Membership", 2), 0}, {testID("Membership", 1), 1000}}
	allocations, problems := Validate(in)
	if len(problems) > 0 || len(allocations) != 2 || allocations[1].Amount != 0 {
		t.Fatal(allocations, problems)
	}
	tests := []struct {
		name   string
		change func(*Input)
	}{
		{"zero total", func(i *Input) { i.Total = 0 }}, {"over limit", func(i *Input) { i.Total = MaxExpense + 1 }}, {"negative", func(i *Input) { i.Total = -1 }}, {"wrong currency", func(i *Input) { i.Currency = "EUR" }},
		{"blank description", func(i *Input) { i.Description = " \n\t" }}, {"long description", func(i *Input) { i.Description = strings.Repeat("é", 121) }}, {"NUL", func(i *Input) { i.Note = "\x00" }}, {"long note", func(i *Input) { i.Note = strings.Repeat("界", 2001) }},
		{"date", func(i *Input) { i.EffectiveDate = "2026-02-30" }}, {"category", func(i *Input) { i.Category = "TRIP" }}, {"no participants", func(i *Input) { i.ParticipantIDs = nil }}, {"duplicates", func(i *Input) { i.ParticipantIDs = append(i.ParticipantIDs, i.ParticipantIDs[0]) }},
		{"negative share", func(i *Input) { i.ExactAllocations[0].Amount = -1 }}, {"too large share", func(i *Input) { i.ExactAllocations[0].Amount = math.MaxInt64 }}, {"missing share", func(i *Input) { i.ExactAllocations = i.ExactAllocations[:1] }}, {"sum mismatch", func(i *Input) { i.ExactAllocations[1].Amount = 999 }}, {"duplicate allocation", func(i *Input) { i.ExactAllocations[0].ParticipantID = i.ExactAllocations[1].ParticipantID }}, {"extra participant", func(i *Input) { i.ExactAllocations[0].ParticipantID = testID("Membership", 4) }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			copyIn := in
			copyIn.ParticipantIDs = append([]string(nil), in.ParticipantIDs...)
			copyIn.ExactAllocations = append([]Allocation(nil), in.ExactAllocations...)
			tt.change(&copyIn)
			if a, p := Validate(copyIn); len(p) == 0 || a != nil {
				t.Fatal(a, p)
			}
		})
	}
	in.Description = strings.Repeat("😀", 120)
	in.Note = strings.Repeat("😀", 2000)
	if _, p := Validate(in); len(p) > 0 {
		t.Fatal("counted UTF16/bytes instead of codepoints", p)
	}
}
func TestCompleteBalanceChainsCyclesAndConservation(t *testing.T) {
	a, b, c := testID("Membership", 1), testID("Membership", 2), testID("Membership", 3)
	positions := []Position{{c, 2000, 0}, {b, 2000, 2000}, {a, 0, 2000}}
	balance, e := Balances(4000, positions)
	if e != nil {
		t.Fatal(e)
	}
	if balance.Settled || !reflect.DeepEqual(balance.Obligations, []Obligation{{a, c, 2000}}) || balance.Positions[1].Net != 0 {
		t.Fatal(balance)
	}
	if positions[0].MemberID != c {
		t.Fatal("mutated input")
	}
	cycle, e := Balances(6000, []Position{{a, 2000, 2000}, {b, 2000, 2000}, {c, 2000, 2000}})
	if e != nil || !cycle.Settled || len(cycle.Obligations) != 0 {
		t.Fatal(cycle, e)
	}
	empty, e := Balances(0, []Position{{a, 0, 0}})
	if e != nil || !empty.Settled {
		t.Fatal(empty, e)
	}
	if _, e := Balances(4000, []Position{{a, 1, 2000}, {b, 2000, 2000}, {c, 2000, 0}}); e == nil {
		t.Fatal("unreconciled aggregate accepted")
	}
	if _, e := Balances(math.MaxInt64, []Position{{a, math.MaxInt64, 0}, {b, 1, math.MaxInt64}}); e == nil {
		t.Fatal("overflow accepted")
	}
	large, e := Balances(math.MaxInt64, []Position{{a, math.MaxInt64, 0}, {b, 0, math.MaxInt64}})
	if e != nil || large.Obligations[0].Amount != math.MaxInt64 {
		t.Fatal(large, e)
	}
	if _, e := CheckedAdd(math.MaxInt64, 1); e == nil {
		t.Fatal("positive overflow")
	}
	if _, e := CheckedAdd(math.MinInt64, -1); e == nil {
		t.Fatal("negative overflow")
	}
}
func TestCursorScopeRotationTamperingAndRestart(t *testing.T) {
	key := bytes.Repeat([]byte{1}, 32)
	codec, e := NewCursorCodec("a", map[string][]byte{"a": key})
	if e != nil {
		t.Fatal(e)
	}
	boundary := Cursor{GroupID: testID("Group", 1), Filter: Filter{From: "2026-01-01", ParticipantID: testID("Membership", 2)}, Revision: 3, EffectiveDate: "2026-09-29", CreatedAt: "2026-09-29T12:34:56.123456Z", ExpenseID: testID("Expense", 1)}
	token, e := codec.Encode(boundary)
	if e != nil {
		t.Fatal(e)
	}
	key[0] = 99
	got, e := codec.Decode(token, boundary.GroupID, boundary.Filter, 4)
	if e != nil || got != boundary {
		t.Fatal(got, e)
	}
	for _, bad := range []string{token + "x", token + "=", strings.Repeat("x", 2049), "a.e30.AAAA", strings.Replace(token, "a.", "b.", 1)} {
		if _, e := codec.Decode(bad, boundary.GroupID, boundary.Filter, 4); e == nil {
			t.Fatal("accepted tampering")
		}
	}
	if _, e := codec.Decode(token, testID("Group", 2), boundary.Filter, 4); e == nil {
		t.Fatal("cross group")
	}
	if _, e := codec.Decode(token, boundary.GroupID, Filter{}, 4); e == nil {
		t.Fatal("filter mismatch")
	}
	if _, e := codec.Decode(token, boundary.GroupID, boundary.Filter, 2); e == nil {
		t.Fatal("future revision")
	}
	rotated, _ := NewCursorCodec("b", map[string][]byte{"a": bytes.Repeat([]byte{1}, 32), "b": bytes.Repeat([]byte{2}, 32)})
	if _, e := rotated.Decode(token, boundary.GroupID, boundary.Filter, 4); e != nil {
		t.Fatal("rotation/restart", e)
	}
	retired, _ := NewCursorCodec("b", map[string][]byte{"b": bytes.Repeat([]byte{2}, 32)})
	if _, e := retired.Decode(token, boundary.GroupID, boundary.Filter, 4); e == nil {
		t.Fatal("retired key")
	}
	if _, e := NewCursorCodec("a", map[string][]byte{"a": {1}}); e == nil {
		t.Fatal("short key")
	}
}
