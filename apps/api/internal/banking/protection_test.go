package banking

import (
	"bytes"
	"fmt"
	"strings"
	"testing"
)

func TestProtectionContextRotationAndOwnership(t *testing.T) {
	old := bytes.Repeat([]byte{1}, 32)
	next := bytes.Repeat([]byte{2}, 32)
	p, err := NewProtector("old", map[string][]byte{"old": old})
	if err != nil {
		t.Fatal(err)
	}
	old[0] = 9
	protected, version, err := p.encrypt([]byte("synthetic-secret"), "owner", "record", "sandbox")
	if err != nil {
		t.Fatal(err)
	}
	rotated, err := NewProtector("next", map[string][]byte{"old": bytes.Repeat([]byte{1}, 32), "next": next})
	if err != nil {
		t.Fatal(err)
	}
	plain, err := rotated.decrypt(protected, version, "owner", "record", "sandbox")
	if err != nil || string(plain) != "synthetic-secret" {
		t.Fatal("rotation lost old ciphertext")
	}
	for _, context := range [][3]string{{"other", "record", "sandbox"}, {"owner", "other", "sandbox"}, {"owner", "record", "production"}} {
		if _, err := rotated.decrypt(protected, version, context[0], context[1], context[2]); err == nil {
			t.Fatal("wrong authenticated context accepted")
		}
	}
	corrupted := append([]byte(nil), protected...)
	corrupted[len(corrupted)-1] ^= 1
	for _, bad := range [][]byte{nil, corrupted} {
		if _, err := p.decrypt(bad, version, "owner", "record", "sandbox"); err == nil {
			t.Fatal("corruption accepted")
		}
	}
	missing, _ := NewProtector("next", map[string][]byte{"next": next})
	if _, err := missing.decrypt(protected, version, "owner", "record", "sandbox"); err == nil {
		t.Fatal("missing key accepted")
	}
	// Another purpose cannot authenticate the access-token ciphertext.
	aead, _ := p.aead(version)
	aad := bytes.ReplaceAll(credentialContext("owner", "record", "sandbox"), []byte("access_token"), []byte("temporary_token"))
	if _, err := aead.Open(nil, protected[:aead.NonceSize()], protected[aead.NonceSize():], aad); err == nil {
		t.Fatal("wrong purpose accepted")
	}
	for _, value := range []any{p, Credential{raw: []byte("synthetic-secret")}, ConnectionInput{AccessToken: "synthetic-secret"}} {
		if strings.Contains(fmt.Sprintf("%v %#v", value, value), "synthetic-secret") {
			t.Fatal("diagnostic disclosed secret")
		}
	}
	for _, keys := range []map[string][]byte{{}, {"x": make([]byte, 31)}, {"": make([]byte, 32)}} {
		if _, err := NewProtector("x", keys); err == nil {
			t.Fatal("invalid keys accepted")
		}
	}
}
