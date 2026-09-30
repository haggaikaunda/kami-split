package ledger

import (
	"bytes"
	"encoding/base64"
	"testing"
)

func TestLoadCursorCodecConfiguration(t *testing.T) {
	key := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32))
	lookup := func(values map[string]string) func(string) (string, bool) {
		return func(name string) (string, bool) { v, ok := values[name]; return v, ok }
	}
	if c, e := LoadCursorCodec(lookup(nil)); c != nil || e != nil {
		t.Fatal("health-only", c, e)
	}
	values := map[string]string{"CURSOR_ACTIVE_KEY_ID": "current", "CURSOR_SIGNING_KEYS": `{"current":"` + key + `"}`}
	if c, e := LoadCursorCodec(lookup(values)); c == nil || e != nil {
		t.Fatal(c, e)
	}
	for _, bad := range []map[string]string{
		{"CURSOR_ACTIVE_KEY_ID": "current"},
		{"CURSOR_SIGNING_KEYS": `{}`},
		{"CURSOR_ACTIVE_KEY_ID": "", "CURSOR_SIGNING_KEYS": `{}`},
		{"CURSOR_ACTIVE_KEY_ID": "missing", "CURSOR_SIGNING_KEYS": values["CURSOR_SIGNING_KEYS"]},
		{"CURSOR_ACTIVE_KEY_ID": "current", "CURSOR_SIGNING_KEYS": `{"current":"` + key + `","current":"` + key + `"}`},
		{"CURSOR_ACTIVE_KEY_ID": "current", "CURSOR_SIGNING_KEYS": `{"current":"` + key + `="}`},
		{"CURSOR_ACTIVE_KEY_ID": "current", "CURSOR_SIGNING_KEYS": `{"current":null}`},
		{"CURSOR_ACTIVE_KEY_ID": "current", "CURSOR_SIGNING_KEYS": values["CURSOR_SIGNING_KEYS"] + ` {}`},
		{"CURSOR_ACTIVE_KEY_ID": "current", "CURSOR_SIGNING_KEYS": `{"current":"short"}`},
	} {
		if c, e := LoadCursorCodec(lookup(bad)); c != nil || e == nil {
			t.Fatalf("accepted invalid config %#v", bad)
		}
	}
}
