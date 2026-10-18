package banking

import (
	"encoding/base64"
	"encoding/json"
	"errors"
)

// Runtime contains the separate banking dependencies for explicitly opted-in
// ingress and cleanup. Loading it grants no enrollment or collection authority.
// Its protector retains old key versions for unfinished cleanup operations.
type Runtime struct {
	Protector *Protector
	Provider  *PlaidProvider
}

// String prevents runtime configuration from exposing credentials or keys.
func (*Runtime) String() string { return "[redacted banking runtime]" }

// GoString prevents Go-syntax diagnostics from exposing runtime secrets.
func (r *Runtime) GoString() string { return r.String() }

// LoadRuntime enables banking only when BANKING_ENVIRONMENT is explicitly
// sandbox or production and provider credentials and an independent keyring are
// complete. BANKING_KEYS is a JSON object mapping versions to standard padded
// base64-encoded 32-byte keys; BANKING_KEY_CURRENT selects the encryption key.
// An absent environment and absent dependent settings returns nil. Values never
// appear in errors; no network request or provider provisioning occurs here.
func LoadRuntime(lookup func(string) (string, bool)) (*Runtime, error) {
	environment, enabled := lookup("BANKING_ENVIRONMENT")
	invalid := errors.New("invalid banking runtime configuration")
	if !enabled {
		for _, key := range []string{"PLAID_CLIENT_ID", "PLAID_SECRET", "BANKING_KEY_CURRENT", "BANKING_KEYS"} {
			if _, set := lookup(key); set {
				return nil, invalid
			}
		}
		return nil, nil
	}
	if environment != "sandbox" && environment != "production" {
		return nil, invalid
	}
	clientID, _ := lookup("PLAID_CLIENT_ID")
	secret, _ := lookup("PLAID_SECRET")
	current, _ := lookup("BANKING_KEY_CURRENT")
	encoded, _ := lookup("BANKING_KEYS")
	if len(encoded) > 16384 {
		return nil, invalid
	}
	var raw map[string]string
	if json.Unmarshal([]byte(encoded), &raw) != nil {
		return nil, invalid
	}
	keys := make(map[string][]byte, len(raw))
	defer func() {
		for _, key := range keys {
			clear(key)
		}
	}()
	for version, value := range raw {
		key, err := base64.StdEncoding.Strict().DecodeString(value)
		if err != nil || len(key) != 32 {
			return nil, invalid
		}
		keys[version] = key
	}
	protector, err := NewProtector(current, keys)
	if err != nil {
		return nil, invalid
	}
	provider, err := NewPlaidProvider(PlaidConfig{Environment: environment, ClientID: clientID, Secret: secret}, nil)
	if err != nil {
		return nil, invalid
	}
	return &Runtime{Protector: protector, Provider: provider}, nil
}
