package banking

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func runtimeEnvironment() map[string]string {
	raw, _ := json.Marshal(map[string]string{"v1": base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32)), "old": base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{9}, 32))})
	return map[string]string{"BANKING_ENVIRONMENT": "sandbox", "PLAID_CLIENT_ID": "private-client", "PLAID_SECRET": "private-secret", "BANKING_KEY_CURRENT": "v1", "BANKING_KEYS": string(raw)}
}

func TestLoadRuntimeOptInAndKeyRotation(t *testing.T) {
	for _, environment := range []string{"sandbox", "production"} {
		t.Run(environment, func(t *testing.T) {
			values := runtimeEnvironment()
			values["BANKING_ENVIRONMENT"] = environment
			runtime, err := LoadRuntime(func(key string) (string, bool) { v, ok := values[key]; return v, ok })
			if err != nil || runtime == nil {
				t.Fatalf("runtime unavailable: %v", err)
			}
			raw := []byte("protected cleanup credential")
			encrypted, version, err := runtime.Protector.encrypt(raw, "owner", "connection", environment)
			if err != nil || version != "v1" {
				t.Fatalf("encrypt: %v", err)
			}
			decrypted, err := runtime.Protector.decrypt(encrypted, version, "owner", "connection", environment)
			if err != nil || !bytes.Equal(decrypted, raw) {
				t.Fatalf("decrypt: %v", err)
			}
			// Retained old versions remain usable when retries outlive rotation.
			runtime.Protector.current = "old"
			encrypted, version, err = runtime.Protector.encrypt(raw, "owner", "connection", environment)
			runtime.Protector.current = "v1"
			decrypted, decryptErr := runtime.Protector.decrypt(encrypted, version, "owner", "connection", environment)
			if err != nil || decryptErr != nil || !bytes.Equal(decrypted, raw) {
				t.Fatal("retained key unavailable")
			}
			formatted := fmt.Sprintf("%v %#v", runtime, runtime)
			for _, secret := range []string{values["PLAID_CLIENT_ID"], values["PLAID_SECRET"], values["BANKING_KEYS"]} {
				if strings.Contains(formatted, secret) {
					t.Fatal("runtime formatting exposed secrets")
				}
			}
		})
	}
	runtime, err := LoadRuntime(func(string) (string, bool) { return "", false })
	if err != nil || runtime != nil {
		t.Fatal("absent configuration enabled banking")
	}
}

func TestLoadRuntimeRejectsIncompleteOrInvalidConfiguration(t *testing.T) {
	cases := []struct {
		name, key, value string
		remove           bool
	}{
		{name: "missing environment", key: "BANKING_ENVIRONMENT", remove: true},
		{name: "empty environment", key: "BANKING_ENVIRONMENT"},
		{name: "unsupported environment", key: "BANKING_ENVIRONMENT", value: "development"},
		{name: "missing client", key: "PLAID_CLIENT_ID", remove: true},
		{name: "empty secret", key: "PLAID_SECRET"},
		{name: "missing current", key: "BANKING_KEY_CURRENT", remove: true},
		{name: "unknown current", key: "BANKING_KEY_CURRENT", value: "unknown"},
		{name: "missing keys", key: "BANKING_KEYS", remove: true},
		{name: "malformed keys", key: "BANKING_KEYS", value: "private-malformed-json"},
		{name: "nonobject keys", key: "BANKING_KEYS", value: "[]"},
		{name: "null keys", key: "BANKING_KEYS", value: "null"},
		{name: "short key", key: "BANKING_KEYS", value: `{"v1":"c2hvcnQ="}`},
		{name: "invalid base64", key: "BANKING_KEYS", value: `{"v1":"%%%"}`},
		{name: "empty version", key: "BANKING_KEYS", value: `{"":"` + base64.StdEncoding.EncodeToString(make([]byte, 32)) + `"}`},
		{name: "oversized keyring", key: "BANKING_KEYS", value: strings.Repeat("x", 16385)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			values := runtimeEnvironment()
			if tc.remove {
				delete(values, tc.key)
			} else {
				values[tc.key] = tc.value
			}
			runtime, err := LoadRuntime(func(key string) (string, bool) { v, ok := values[key]; return v, ok })
			if err == nil || runtime != nil {
				t.Fatal("invalid configuration enabled runtime")
			}
			if err.Error() != "invalid banking runtime configuration" {
				t.Fatal("unsafe configuration error")
			}
		})
	}
	// Each banking-dependent setting alone fails closed instead of being ignored.
	for _, key := range []string{"PLAID_CLIENT_ID", "PLAID_SECRET", "BANKING_KEY_CURRENT", "BANKING_KEYS"} {
		_, err := LoadRuntime(func(k string) (string, bool) { return "private", k == key })
		if err == nil {
			t.Fatalf("orphan setting %s accepted", key)
		}
	}
}

func TestEnrollmentRuntimeDefaultsAndCapabilityGates(t *testing.T) {
	values := runtimeEnvironment()
	lookup := func(key string) (string, bool) { v, ok := values[key]; return v, ok }
	runtime, err := LoadRuntime(lookup)
	if err != nil || runtime.Enrollment.Enabled || runtime.Provider.EnrollmentCapabilities().UserScopedRemoval {
		t.Fatal("enrollment enabled by cleanup configuration")
	}
	values["BANKING_ENROLLMENT_ENABLED"] = "true"
	if _, err := LoadRuntime(lookup); err == nil {
		t.Fatal("missing capabilities accepted")
	}
	values["BANKING_USER_DISCOVERY_VERIFIED"] = "true"
	values["BANKING_USER_REMOVAL_VERIFIED"] = "true"
	values["BANKING_WEBHOOK_ORIGIN"] = "https://api.example.invalid"
	runtime, err = LoadRuntime(lookup)
	if err != nil || !runtime.Enrollment.Enabled {
		t.Fatal("explicit configuration rejected")
	}
	values["BANKING_ENROLLMENT_ENABLED"] = "yes"
	if _, err := LoadRuntime(lookup); err == nil {
		t.Fatal("malformed gate ignored")
	}
}
