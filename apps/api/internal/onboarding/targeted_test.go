package onboarding

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestTargetGenerationHeadersAndResponseValidation(t *testing.T) {
	for _, key := range []string{"legacy-synthetic-jwt", "sb_secret_synthetic"} {
		t.Run(key, func(t *testing.T) {
			kind := "signup"
			email := "recipient@example.invalid"
			h := independentHandler(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.URL.Path != "/admin/generate_link" || r.Header.Get("apikey") != key {
					t.Error("wrong privileged provider request")
				}
				wantBearer := ""
				if key == "legacy-synthetic-jwt" {
					wantBearer = "Bearer " + key
				}
				if r.Header.Get("Authorization") != wantBearer {
					t.Error("wrong key family bearer header")
				}
				var body map[string]string
				if json.NewDecoder(r.Body).Decode(&body) != nil || len(body) != 2 || body["type"] != "magiclink" || body["email"] != "recipient@example.invalid" {
					t.Error("unexpected provider payload")
				}
				_ = json.NewEncoder(w).Encode(map[string]string{"id": uuid.NewString(), "email": email, "verification_type": kind, "hashed_token": "synthetic-hash"})
			}))
			h.adminKey = key
			result, ok := h.generateTargetLink(context.Background(), "recipient@example.invalid")
			if !ok || result.Type != "signup" {
				t.Fatal("new account link rejected")
			}
			kind = "magiclink"
			if _, ok := h.generateTargetLink(context.Background(), "recipient@example.invalid"); !ok {
				t.Fatal("existing account link rejected")
			}
			kind = "recovery"
			if _, ok := h.generateTargetLink(context.Background(), "recipient@example.invalid"); ok {
				t.Fatal("unexpected provider type accepted")
			}
			kind = "magiclink"
			email = "different@example.invalid"
			if _, ok := h.generateTargetLink(context.Background(), "recipient@example.invalid"); ok {
				t.Fatal("different provider recipient accepted")
			}
		})
	}
}
