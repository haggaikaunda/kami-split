package ledger

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strings"
)

// Filter is an inclusive expense-page filter. Zero-share allocations count as
// participation; payer-only identity does not. Empty fields mean no restriction.
type Filter struct {
	From          string `json:"from"`
	To            string `json:"to"`
	Category      string `json:"category"`
	ParticipantID string `json:"participant"`
}

// Cursor binds a forward traversal to an authorized group, exact filter and
// append-only financial revision, plus its strict descending order boundary.
// IDs are typed public IDs and CreatedAt uses canonical UTC microseconds.
type Cursor struct {
	GroupID       string `json:"group"`
	Filter        Filter `json:"filter"`
	Revision      int64  `json:"revision"`
	EffectiveDate string `json:"date"`
	CreatedAt     string `json:"created"`
	ExpenseID     string `json:"expense"`
	// Kind is empty for legacy expense cursors; Repayment separates transfer history.
	Kind string `json:"kind,omitempty"`
}

type cursorEnvelope struct {
	Version int    `json:"v"`
	Cursor  Cursor `json:"cursor"`
}

// CursorCodec holds copied deployment-managed keys. Preserve previous keys while
// rotating and across restarts; retirement explicitly invalidates old cursors.
type CursorCodec struct {
	active string
	keys   map[string][]byte
}

// NewCursorCodec requires a named active HMAC key and at least 256 bits per key.
// It copies the key map and material so configuration cannot mutate live signing.
func NewCursorCodec(activeKeyID string, keys map[string][]byte) (*CursorCodec, error) {
	c := &CursorCodec{active: activeKeyID, keys: make(map[string][]byte, len(keys))}
	for id, key := range keys {
		if len(id) < 1 || len(id) > 32 || len(key) < 32 {
			return nil, errors.New("invalid cursor key configuration")
		}
		for _, ch := range id {
			if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '_' || ch == '-') {
				return nil, errors.New("invalid cursor key ID")
			}
		}
		c.keys[id] = append([]byte(nil), key...)
	}
	if _, ok := c.keys[activeKeyID]; !ok {
		return nil, errors.New("missing active cursor key")
	}
	return c, nil
}

// ValidateFilter checks syntax only; current group authorization and membership
// existence must be checked before returning a page or cursor error.
func ValidateFilter(f Filter) error {
	if f.From != "" && !ValidDate(f.From) || f.To != "" && !ValidDate(f.To) || f.From != "" && f.To != "" && f.From > f.To {
		return errors.New("INVALID_INPUT")
	}
	if f.Category != "" {
		switch f.Category {
		case "DINING", "GROCERIES", "ACCOMMODATION", "TRANSPORT", "ACTIVITIES", "HOME", "OTHER":
		default:
			return errors.New("INVALID_INPUT")
		}
	}
	if f.ParticipantID != "" {
		if _, e := ParseID(f.ParticipantID, "Membership"); e != nil {
			return errors.New("INVALID_INPUT")
		}
	}
	return nil
}

func validCursor(c Cursor) bool {
	if _, e := ParseID(c.GroupID, "Group"); e != nil {
		return false
	}
	kind := "Expense"
	if c.Kind == "Repayment" {
		kind = "Repayment"
	} else if c.Kind != "" {
		return false
	}
	if _, e := ParseID(c.ExpenseID, kind); e != nil {
		return false
	}
	var created DateTime
	return c.Revision >= 0 && ValidateFilter(c.Filter) == nil && ValidDate(c.EffectiveDate) && created.UnmarshalGQL(c.CreatedAt) == nil
}

// Encode signs a validated boundary. The key ID is authenticated along with the
// payload, and neither credentials nor actor identity enter the token.
func (c *CursorCodec) Encode(cursor Cursor) (string, error) {
	if c == nil || !validCursor(cursor) {
		return "", errors.New("INVALID_CURSOR")
	}
	payload, e := json.Marshal(cursorEnvelope{1, cursor})
	if e != nil {
		return "", errors.New("INVALID_CURSOR")
	}
	prefix := c.active + "." + base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, c.keys[c.active])
	_, _ = mac.Write([]byte(prefix))
	token := prefix + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if len(token) > 2048 {
		return "", errors.New("INVALID_CURSOR")
	}
	return token, nil
}

// Decode verifies the MAC before interpreting JSON, then requires exact scope,
// filter and a nonfuture anchor. Call only after current group authorization.
func (c *CursorCodec) Decode(token, groupID string, filter Filter, currentRevision int64) (Cursor, error) {
	return c.decode(token, groupID, filter, currentRevision, "")
}

// DecodeRepayment verifies a repayment-only cursor under the existing signing
// protocol. Expense cursors are rejected even when group and anchor match.
func (c *CursorCodec) DecodeRepayment(token, groupID string, currentRevision int64) (Cursor, error) {
	return c.decode(token, groupID, Filter{}, currentRevision, "Repayment")
}
func (c *CursorCodec) decode(token, groupID string, filter Filter, currentRevision int64, kind string) (Cursor, error) {
	fail := func() (Cursor, error) { return Cursor{}, errors.New("INVALID_CURSOR") }
	if c == nil || len(token) > 2048 {
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
	supplied, e := base64.RawURLEncoding.Strict().DecodeString(parts[2])
	if e != nil {
		return fail()
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(supplied, mac.Sum(nil)) {
		return fail()
	}
	payload, e := base64.RawURLEncoding.Strict().DecodeString(parts[1])
	if e != nil {
		return fail()
	}
	var env cursorEnvelope
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&env) != nil {
		return fail()
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF {
		return fail()
	}
	// Reject alternate/duplicate JSON forms even if a trusted signer produced one.
	canonical, e := json.Marshal(env)
	if e != nil || !bytes.Equal(canonical, payload) {
		return fail()
	}
	cur := env.Cursor
	if env.Version != 1 || !validCursor(cur) || cur.GroupID != groupID || cur.Filter != filter || cur.Revision > currentRevision || cur.Kind != kind {
		return fail()
	}
	return cur, nil
}
