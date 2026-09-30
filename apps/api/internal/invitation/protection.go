package invitation

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
)

// Protector retains a copied, versioned AES-256 keyring. Old keys must remain
// available while ciphertext or action receipts reference their versions.
type Protector struct {
	current string
	keys    map[string][]byte
	random  io.Reader
}

// NewProtector validates and copies all supplied keys; it never generates keys.
func NewProtector(current string, keys map[string][]byte) (*Protector, error) {
	p := &Protector{current: current, keys: make(map[string][]byte), random: rand.Reader}
	for version, key := range keys {
		if version == "" || len(key) != 32 {
			return nil, errors.New("invalid invitation protection key")
		}
		p.keys[version] = append([]byte(nil), key...)
	}
	if _, ok := p.keys[current]; !ok {
		return nil, errors.New("missing current invitation protection key")
	}
	return p, nil
}

// CurrentVersion identifies the key used for new ciphertext and receipts.
func (p *Protector) CurrentVersion() string { return p.current }

// NewToken creates a 256-bit opaque bearer token and its SHA-256 lookup digest.
func NewToken() (string, []byte, error) { return newToken(rand.Reader) }
func newToken(random io.Reader) (string, []byte, error) {
	raw := make([]byte, 32)
	if _, err := io.ReadFull(random, raw); err != nil {
		return "", nil, errors.New("invitation randomness unavailable")
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	return token, TokenHash(token), nil
}

// TokenHash is appropriate only for high-entropy bearer tokens, never emails.
func TokenHash(token string) []byte {
	raw, err := base64.RawURLEncoding.Strict().DecodeString(token)
	if err != nil || len(raw) != 32 || len(token) != 43 {
		return nil
	}
	hash := sha256.Sum256([]byte(token))
	return hash[:]
}

func (p *Protector) aead(version string) (cipher.AEAD, error) {
	key, ok := p.keys[version]
	if !ok {
		return nil, errors.New("invitation protection key unavailable")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, errors.New("invitation protection unavailable")
	}
	return cipher.NewGCM(block)
}

// Encrypt binds confidential bytes to caller-supplied record/purpose context.
// The result includes its nonce; persist the returned key version alongside it.
func (p *Protector) Encrypt(plaintext []byte, aad string) ([]byte, string, error) {
	aead, err := p.aead(p.current)
	if err != nil {
		return nil, "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err = io.ReadFull(p.random, nonce); err != nil {
		return nil, "", errors.New("invitation randomness unavailable")
	}
	return aead.Seal(nonce, nonce, plaintext, []byte(aad)), p.current, nil
}

// Decrypt fails closed for missing versions, changed ciphertext, or wrong context.
// Rotation decrypts then encrypts the same bytes; it must not create a new token.
func (p *Protector) Decrypt(ciphertext []byte, version, aad string) ([]byte, error) {
	aead, err := p.aead(version)
	if err != nil {
		return nil, err
	}
	if len(ciphertext) < aead.NonceSize() {
		return nil, errors.New("invalid invitation ciphertext")
	}
	plain, err := aead.Open(nil, ciphertext[:aead.NonceSize()], ciphertext[aead.NonceSize():], []byte(aad))
	if err != nil {
		return nil, errors.New("invalid invitation ciphertext")
	}
	return plain, nil
}

// ActionDigest authenticates canonical action bytes without a dictionary-testable
// email hash. Persist its version and reuse that version when comparing retries.
func (p *Protector) ActionDigest(canonical []byte, version string) ([]byte, error) {
	if version == "" {
		version = p.current
	}
	key, ok := p.keys[version]
	if !ok {
		return nil, errors.New("invitation protection key unavailable")
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("kami-split/invitation/action/v1\x00"))
	mac.Write(canonical)
	return mac.Sum(nil), nil
}

// NewToken uses this protector's cryptographic entropy source.
func (p *Protector) NewToken() (string, []byte, error) { return newToken(p.random) }
func equalDigest(a, b []byte) bool                     { return hmac.Equal(a, b) }

// String redacts all key material in diagnostics.
func (*Protector) String() string { return "[redacted invitation protector]" }

// GoString also redacts Go-syntax diagnostic formatting.
func (p *Protector) GoString() string { return p.String() }
