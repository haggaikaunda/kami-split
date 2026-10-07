package ledger

import (
	"bytes"
	"strings"
	"testing"
)

func TestExpenseViewCursorAuthenticatesCompleteScopeAndFilter(t *testing.T) {
	codec, err := NewCursorCodec("active", map[string][]byte{"active": bytes.Repeat([]byte{7}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	group := PublicID("Group", "16900000-0000-4000-8000-000000000001")
	input := ExpenseViewCursor{Scope: "HOUSEHOLD", Filter: StructuredFilter{GroupID: group, Category: "HOME", From: "2026-01-01", To: "2026-12-31"}, Eligibility: strings.Repeat("a", 64), Anchors: []SpaceRevision{{GroupID: group, Revision: 42}}, EffectiveDate: "2026-10-01", CreatedAt: "2026-10-01T00:00:00.000001Z", GroupID: group, ExpenseID: PublicID("Expense", "16900000-0000-4000-8000-000000000002")}
	token, err := codec.EncodeExpenseView(input)
	if err != nil {
		t.Fatal(err)
	}
	got, err := codec.DecodeExpenseView(token, "HOUSEHOLD", input.Filter)
	if err != nil || got.Anchors[0] != input.Anchors[0] || got.Eligibility != input.Eligibility {
		t.Fatal(got, err)
	}
	changed := input.Filter
	changed.To = "2026-11-30"
	for _, tc := range []struct {
		token, scope string
		filter       StructuredFilter
	}{{token, group, input.Filter}, {token, "HOUSEHOLD", changed}, {token + "x", "HOUSEHOLD", input.Filter}, {strings.Repeat("x", 65537), "HOUSEHOLD", input.Filter}} {
		if _, err := codec.DecodeExpenseView(tc.token, tc.scope, tc.filter); err == nil {
			t.Fatal("cursor misuse accepted")
		}
	}
	// Version/type separation prevents a valid existing group cursor from being
	// repurposed as a cross-space view traversal.
	old, err := codec.Encode(Cursor{GroupID: group, Filter: Filter{}, Revision: 42, EffectiveDate: input.EffectiveDate, CreatedAt: input.CreatedAt, ExpenseID: input.ExpenseID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := codec.DecodeExpenseView(old, group, StructuredFilter{}); err == nil {
		t.Fatal("legacy cursor accepted")
	}
}

func TestStructuredFiltersRejectInvalidSyntaxWithoutChangingLegacyMeaning(t *testing.T) {
	for _, f := range []StructuredFilter{{From: "2026-02-30"}, {From: "2026-10-01", To: "2026-09-30"}, {Category: "SHOPPING"}, {GroupID: "unknown"}, {MemberID: PublicID("Group", "16900000-0000-4000-8000-000000000001")}} {
		if ValidateStructuredFilter(f) == nil {
			t.Fatal("malformed filter accepted", f)
		}
	}
	member := PublicID("Membership", "16900000-0000-4000-8000-000000000001")
	if ValidateStructuredFilter(StructuredFilter{MemberID: member}) != nil {
		t.Fatal("valid same-group identity rejected")
	}
}
