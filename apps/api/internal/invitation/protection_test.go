package invitation

import (
	"bytes"
	"errors"
	"testing"
)

type failedRandom struct{}

func (failedRandom) Read([]byte) (int, error) { return 0, errors.New("random failed") }
func TestProtectionRotation(t *testing.T) {
	keys := map[string][]byte{"old": bytes.Repeat([]byte{1}, 32)}
	p, err := NewProtector("old", keys)
	if err != nil {
		t.Fatal(err)
	}
	keys["old"][0] = 9
	token, hash, err := NewToken()
	if err != nil || len(token) != 43 || len(hash) != 32 {
		t.Fatal("invalid token")
	}
	ct, v, err := p.Encrypt([]byte(token), "id:token")
	if err != nil {
		t.Fatal(err)
	}
	next, err := NewProtector("new", map[string][]byte{"old": bytes.Repeat([]byte{1}, 32), "new": bytes.Repeat([]byte{2}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	plain, err := next.Decrypt(ct, v, "id:token")
	if err != nil || string(plain) != token {
		t.Fatal("rotation failed")
	}
	ct2, v2, err := next.Encrypt(plain, "id:token")
	if err != nil || v2 != "new" {
		t.Fatal("reencryption failed")
	}
	plain, err = next.Decrypt(ct2, v2, "id:token")
	if err != nil || !bytes.Equal(TokenHash(string(plain)), hash) {
		t.Fatal("bearer changed")
	}
	if _, err = next.Decrypt(ct, v, "other:token"); err == nil {
		t.Fatal("AAD not bound")
	}
	if _, err = next.Decrypt(ct, "missing", "id:token"); err == nil {
		t.Fatal("missing key accepted")
	}
	ct[len(ct)-1] ^= 1
	if _, err = next.Decrypt(ct, v, "id:token"); err == nil {
		t.Fatal("tamper accepted")
	}
	a, _ := p.ActionDigest([]byte("email"), "old")
	b, _ := next.ActionDigest([]byte("email"), "old")
	c, _ := next.ActionDigest([]byte("email"), "")
	if !bytes.Equal(a, b) || bytes.Equal(a, c) || bytes.Equal(a, TokenHash("email")) {
		t.Fatal("digest key scope wrong")
	}
	p.random = failedRandom{}
	if _, _, err = p.Encrypt([]byte(token), "id"); err == nil {
		t.Fatal("rng failure ignored")
	}
	if _, _, err = newToken(failedRandom{}); err == nil {
		t.Fatal("rng failure ignored")
	}
}
func TestInvalidKeys(t *testing.T) {
	for _, keys := range []map[string][]byte{nil, {"v": {1}}, {"": bytes.Repeat([]byte{1}, 32)}} {
		if _, err := NewProtector("v", keys); err == nil {
			t.Fatal("invalid keys accepted")
		}
	}
}

func TestTokenHashRejectsMalformed(t *testing.T) {
	for _, token := range []string{"", "email@example.com", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"} {
		if TokenHash(token) != nil {
			t.Fatal("malformed token accepted")
		}
	}
}
