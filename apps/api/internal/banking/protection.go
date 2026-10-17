package banking

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
)

// Protector owns an independent banking-only versioned AES-256 keyring. Callers
// must supply banking secrets, never invitation keys, and retain old versions
// until both ciphertext and operation digests have migrated or been purged.
type Protector struct {
	current string
	keys    map[string][]byte
}

// NewProtector validates and copies banking keys without generating or loading
// invitation configuration. Missing versions fail closed, including on retries.
func NewProtector(current string, keys map[string][]byte) (*Protector, error) {
	p := &Protector{current: current, keys: make(map[string][]byte)}
	for version, key := range keys {
		if version == "" || len(key) != 32 {
			return nil, errors.New("invalid banking protection configuration")
		}
		p.keys[version] = append([]byte(nil), key...)
	}
	if _, ok := p.keys[current]; !ok {
		return nil, errors.New("missing current banking protection key")
	}
	return p, nil
}
func (p *Protector) aead(version string) (cipher.AEAD, error) {
	key, ok := p.keys[version]
	if !ok {
		return nil, errors.New("banking protection unavailable")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, errors.New("banking protection unavailable")
	}
	return cipher.NewGCM(block)
}
func credentialContext(owner, record, environment string) []byte {
	// A tuple encoding prevents delimiter ambiguity and authenticates the purpose.
	raw, _ := json.Marshal([]string{"kami-split/banking/v1", "access_token", owner, record, environment})
	return raw
}
func (p *Protector) encrypt(plain []byte, owner, record, environment string) ([]byte, string, error) {
	aead, err := p.aead(p.current)
	if err != nil {
		return nil, "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, "", errors.New("banking protection unavailable")
	}
	return aead.Seal(nonce, nonce, plain, credentialContext(owner, record, environment)), p.current, nil
}
func (p *Protector) decrypt(protected []byte, version, owner, record, environment string) ([]byte, error) {
	aead, err := p.aead(version)
	if err != nil {
		return nil, err
	}
	if len(protected) < aead.NonceSize() {
		return nil, errors.New("banking credential unavailable")
	}
	plain, err := aead.Open(nil, protected[:aead.NonceSize()], protected[aead.NonceSize():], credentialContext(owner, record, environment))
	if err != nil {
		return nil, errors.New("banking credential unavailable")
	}
	return plain, nil
}
func (p *Protector) digest(canonical []byte, version string) ([]byte, error) {
	key, ok := p.keys[version]
	if !ok {
		return nil, errors.New("banking protection unavailable")
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("kami-split/banking/operation/v1\x00"))
	mac.Write(canonical)
	return mac.Sum(nil), nil
}

// String prevents key disclosure in ordinary diagnostics.
func (*Protector) String() string { return "[redacted banking protector]" }

// GoString prevents key disclosure in Go-syntax diagnostics.
func (p *Protector) GoString() string { return p.String() }
