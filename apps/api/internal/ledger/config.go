package ledger

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strings"
)

// LoadCursorCodec loads deployment-managed signing material from
// CURSOR_ACTIVE_KEY_ID and CURSOR_SIGNING_KEYS. The latter is a JSON object of
// key IDs to unpadded base64url-encoded secrets of at least 32 bytes. Missing both
// returns nil for health-only operation; protected business configuration must
// require a codec. Errors never contain key material. Retain keys across restart
// and include previous IDs during rotation; no ephemeral keys are generated.
func LoadCursorCodec(lookup func(string) (string, bool)) (*CursorCodec, error) {
	active, activeSet := lookup("CURSOR_ACTIVE_KEY_ID")
	encoded, keysSet := lookup("CURSOR_SIGNING_KEYS")
	if !activeSet && !keysSet {
		return nil, nil
	}
	fail := func() (*CursorCodec, error) { return nil, errors.New("invalid cursor signing configuration") }
	if !activeSet || !keysSet || active == "" || len(encoded) > 16384 {
		return fail()
	}
	// Decode entries individually to reject duplicate key IDs rather than silently
	// accepting a different secret according to object member order.
	decoder := json.NewDecoder(strings.NewReader(encoded))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return fail()
	}
	keys := map[string][]byte{}
	for decoder.More() {
		token, err = decoder.Token()
		if err != nil {
			return fail()
		}
		id, ok := token.(string)
		if !ok {
			return fail()
		}
		if _, exists := keys[id]; exists {
			return fail()
		}
		var value string
		if decoder.Decode(&value) != nil {
			return fail()
		}
		decoded, e := base64.RawURLEncoding.Strict().DecodeString(value)
		if e != nil || base64.RawURLEncoding.EncodeToString(decoded) != value {
			return fail()
		}
		keys[id] = decoded
	}
	if token, err = decoder.Token(); err != nil || token != json.Delim('}') {
		return fail()
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF {
		return fail()
	}
	codec, err := NewCursorCodec(active, keys)
	if err != nil {
		return fail()
	}
	return codec, nil
}
