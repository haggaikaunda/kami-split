package ledger

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
)

// ActivityAnchor fixes each source ledger revision for a complete traversal.
// GroupID is a raw UUID internal to the application boundary.
type ActivityAnchor struct {
	GroupID  string `json:"group"`
	Revision int64  `json:"revision"`
}

// ActivityCursor binds an event boundary to the actor, authorized source set,
// workspace and filters. Reauthorize all anchors before decoding a continuation.
type ActivityCursor struct {
	Version    int              `json:"v"`
	Actor      string           `json:"actor"`
	Scope      string           `json:"scope"`
	EventKind  string           `json:"kind"`
	Source     string           `json:"source"`
	Anchors    []ActivityAnchor `json:"anchors"`
	Timestamp  string           `json:"timestamp"`
	RecordKind string           `json:"recordKind"`
	RecordID   string           `json:"record"`
}

// EncodeActivity signs an independent versioned activity cursor using the
// deployment-managed keyring. It never accepts expense or repayment cursors.
func (c *CursorCodec) EncodeActivity(cursor ActivityCursor) (string, error) {
	if c == nil || !validActivityCursor(cursor) {
		return "", errors.New("INVALID_CURSOR")
	}
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	prefix := c.active + "." + base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, c.keys[c.active])
	_, _ = mac.Write([]byte("activity-v1:" + prefix))
	token := prefix + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if len(token) > 65536 {
		return "", errors.New("INVALID_CURSOR")
	}
	return token, nil
}

// DecodeActivity verifies integrity and exact actor/workspace/filter/source-set
// binding. Current revisions may advance, but cannot precede signed anchors.
func (c *CursorCodec) DecodeActivity(token, actor, scope, kind, source string, current []ActivityAnchor) (ActivityCursor, error) {
	fail := func() (ActivityCursor, error) { return ActivityCursor{}, errors.New("INVALID_CURSOR") }
	if c == nil || len(token) > 65536 {
		return fail()
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return fail()
	}
	key, ok := c.keys[parts[0]]
	if !ok {
		return fail()
	}
	sig, err := base64.RawURLEncoding.Strict().DecodeString(parts[2])
	if err != nil {
		return fail()
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte("activity-v1:" + parts[0] + "." + parts[1]))
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return fail()
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(parts[1])
	if err != nil {
		return fail()
	}
	var cursor ActivityCursor
	if json.Unmarshal(raw, &cursor) != nil || !validActivityCursor(cursor) {
		return fail()
	}
	canonical, _ := json.Marshal(cursor)
	if string(canonical) != string(raw) {
		return fail()
	}
	if cursor.Actor != actor || cursor.Scope != scope || cursor.EventKind != kind || cursor.Source != source || len(cursor.Anchors) != len(current) {
		return fail()
	}
	for i, a := range cursor.Anchors {
		if a.GroupID != current[i].GroupID || a.Revision > current[i].Revision {
			return fail()
		}
	}
	return cursor, nil
}
func validActivityCursor(c ActivityCursor) bool {
	if c.Version != 1 || c.Actor == "" || c.Scope == "" || len(c.Anchors) == 0 {
		return false
	}
	if c.EventKind != "" && c.EventKind != "EXPENSE_CREATED" && c.EventKind != "REPAYMENT_RECORDED" {
		return false
	}
	for i, a := range c.Anchors {
		if _, err := ParseID(PublicID("Group", a.GroupID), "Group"); err != nil || a.Revision < 0 {
			return false
		}
		if i > 0 && c.Anchors[i-1].GroupID >= a.GroupID {
			return false
		}
	}
	var timestamp DateTime
	if timestamp.UnmarshalGQL(c.Timestamp) != nil {
		return false
	}
	if c.RecordKind != "EXPENSE_CREATED" && c.RecordKind != "REPAYMENT_RECORDED" {
		return false
	}
	_, err := ParseID(PublicID("Group", c.RecordID), "Group")
	return err == nil
}
