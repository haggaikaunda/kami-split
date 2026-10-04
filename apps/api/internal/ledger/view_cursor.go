package ledger

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"strings"
)

// StructuredFilter selects face-value expense spending. MemberID matches payer
// OR explicit allocation (including zero); legacy Filter remains participant-only.
// GroupID selects one authorized source ledger; empty means the whole scope.
type StructuredFilter struct {
	GroupID  string `json:"group"`
	MemberID string `json:"member"`
	From     string `json:"from"`
	To       string `json:"to"`
	Category string `json:"category"`
}

// ValidateStructuredFilter validates wire syntax, never authorizes identifiers.
func ValidateStructuredFilter(f StructuredFilter) error {
	if ValidateFilter(Filter{From: f.From, To: f.To, Category: f.Category}) != nil {
		return errors.New("INVALID_INPUT")
	}
	for _, id := range []struct{ value, kind string }{{f.GroupID, "Group"}, {f.MemberID, "Membership"}} {
		if id.value != "" {
			if _, err := ParseID(id.value, id.kind); err != nil {
				return errors.New("INVALID_INPUT")
			}
		}
	}
	return nil
}

// SpaceRevision is one canonical original ledger's append-only traversal anchor.
// Revisions grant no access and must be rechecked against current authorized scope.
type SpaceRevision struct {
	GroupID  string `json:"group"`
	Revision int64  `json:"revision"`
}

// ExpenseViewCursor freezes the complete filtered dataset and strict global
// descending boundary. Eligibility is an opaque SHA256 actor/scope binding;
// no peer user identities enter the token. Anchors are sorted by GroupID.
type ExpenseViewCursor struct {
	Scope         string           `json:"scope"`
	Filter        StructuredFilter `json:"filter"`
	Eligibility   string           `json:"eligibility"`
	Anchors       []SpaceRevision  `json:"anchors"`
	EffectiveDate string           `json:"date"`
	CreatedAt     string           `json:"created"`
	GroupID       string           `json:"group"`
	ExpenseID     string           `json:"expense"`
}

type viewCursorEnvelope struct {
	Version int               `json:"v"`
	Cursor  ExpenseViewCursor `json:"cursor"`
}

const maxViewCursorBytes = 65536

func validViewCursor(v ExpenseViewCursor) bool {
	if v.Scope != "HOUSEHOLD" {
		if _, err := ParseID(v.Scope, "Group"); err != nil {
			return false
		}
	}
	if ValidateStructuredFilter(v.Filter) != nil || !ValidDate(v.EffectiveDate) {
		return false
	}
	var created DateTime
	if created.UnmarshalGQL(v.CreatedAt) != nil {
		return false
	}
	if len(v.Eligibility) != 64 {
		return false
	}
	if _, err := hex.DecodeString(v.Eligibility); err != nil {
		return false
	}
	if _, err := ParseID(v.GroupID, "Group"); err != nil {
		return false
	}
	if _, err := ParseID(v.ExpenseID, "Expense"); err != nil {
		return false
	}
	if len(v.Anchors) == 0 {
		return false
	}
	previous := ""
	found := false
	for _, a := range v.Anchors {
		if a.Revision < 0 || a.GroupID <= previous {
			return false
		}
		if _, err := ParseID(a.GroupID, "Group"); err != nil {
			return false
		}
		previous = a.GroupID
		if a.GroupID == v.GroupID {
			found = true
		}
	}
	return found
}

// EncodeExpenseView signs a complete traversal, rejecting over-budget tokens
// rather than dropping eligible ledgers. Signing keys use the existing rotation policy.
func (c *CursorCodec) EncodeExpenseView(v ExpenseViewCursor) (string, error) {
	if c == nil || !validViewCursor(v) {
		return "", errors.New("INVALID_CURSOR")
	}
	raw, err := json.Marshal(viewCursorEnvelope{2, v})
	if err != nil {
		return "", errors.New("INVALID_CURSOR")
	}
	prefix := c.active + "." + base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, c.keys[c.active])
	_, _ = mac.Write([]byte(prefix))
	token := prefix + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if len(token) > maxViewCursorBytes {
		return "", errors.New("INVALID_CURSOR")
	}
	return token, nil
}

// DecodeExpenseView authenticates canonical signed JSON and exact scope/filter
// before returning copied anchors. Current eligibility/revision checks belong to
// the application operation and precede any serialized cursor failure.
func (c *CursorCodec) DecodeExpenseView(token, scope string, filter StructuredFilter) (ExpenseViewCursor, error) {
	fail := func() (ExpenseViewCursor, error) { return ExpenseViewCursor{}, errors.New("INVALID_CURSOR") }
	if c == nil || len(token) > maxViewCursorBytes {
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
	signature, err := base64.RawURLEncoding.Strict().DecodeString(parts[2])
	if err != nil {
		return fail()
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return fail()
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(parts[1])
	if err != nil {
		return fail()
	}
	var env viewCursorEnvelope
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&env) != nil {
		return fail()
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF {
		return fail()
	}
	canonical, err := json.Marshal(env)
	if err != nil || !bytes.Equal(canonical, raw) {
		return fail()
	}
	if env.Version != 2 || !validViewCursor(env.Cursor) || env.Cursor.Scope != scope || env.Cursor.Filter != filter {
		return fail()
	}
	return env.Cursor, nil
}
