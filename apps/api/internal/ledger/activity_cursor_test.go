package ledger

import (
	"strings"
	"testing"
)

func TestActivityCursorBindsTraversal(t *testing.T) {
	codec, err := NewCursorCodec("test", map[string][]byte{"test": []byte(strings.Repeat("a", 32))})
	if err != nil {
		t.Fatal(err)
	}
	id := "00000000-0000-4000-8000-000000000001"
	anchors := []ActivityAnchor{{GroupID: id, Revision: 2}}
	original := ActivityCursor{Version: 1, Actor: "actor", Scope: "household", Anchors: anchors, Timestamp: "2026-10-04T12:00:00.000000Z", RecordKind: "EXPENSE_CREATED", RecordID: id}
	token, err := codec.EncodeActivity(original)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, actor, scope, kind, source string
		anchors                          []ActivityAnchor
		token                            string
		valid                            bool
	}{
		{"same", "actor", "household", "", "", anchors, token, true},
		{"advance", "actor", "household", "", "", []ActivityAnchor{{id, 3}}, token, true},
		{"actor", "other", "household", "", "", anchors, token, false},
		{"scope", "actor", id, "", "", anchors, token, false},
		{"kind", "actor", "household", "REPAYMENT_RECORDED", "", anchors, token, false},
		{"source", "actor", "household", "", id, anchors, token, false},
		{"lost access", "actor", "household", "", "", nil, token, false},
		{"revision", "actor", "household", "", "", []ActivityAnchor{{id, 1}}, token, false},
		{"tampered", "actor", "household", "", "", anchors, token + "x", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := codec.DecodeActivity(tc.token, tc.actor, tc.scope, tc.kind, tc.source, tc.anchors)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v err=%v", tc.valid, err)
			}
		})
	}
	if _, err := codec.Decode(token, PublicID("Group", id), Filter{}, 3); err == nil {
		t.Fatal("activity accepted as expense cursor")
	}
	anchors[0].Revision = 99
	if got, err := codec.DecodeActivity(token, "actor", "household", "", "", anchors); err != nil || got.Anchors[0].Revision != 2 {
		t.Fatal("caller mutation changed signed anchor")
	}
}
