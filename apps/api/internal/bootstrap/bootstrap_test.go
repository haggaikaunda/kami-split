package bootstrap

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func validTarget() Target {
	return Target{uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), "Synthetic Owner"}
}

func TestTargetValidation(t *testing.T) {
	if err := validTarget().Validate(); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*Target){
		func(t *Target) { t.AuthUserID = "" }, func(t *Target) { t.AuthUserID = "first" },
		func(t *Target) { t.AuthUserID = uuid.Nil.String() }, func(t *Target) { t.UserID = "00000000-0000-1000-8000-000000000001" },
		func(t *Target) { t.GroupID = t.UserID }, func(t *Target) { t.DisplayName = " " },
		func(t *Target) { t.DisplayName = strings.Repeat("x", 121) }, func(t *Target) { t.DisplayName = "name\x00" },
	} {
		target := validTarget()
		change(&target)
		if err := target.Validate(); err == nil {
			t.Fatal("invalid plan accepted")
		}
	}
}

func TestCreateAuthUserKeepsPasswordPrivateAndUnconfirmed(t *testing.T) {
	id := uuid.NewString()
	var passwords []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/auth/v1/admin/users" || r.Header.Get("Authorization") != "Bearer test-secret" {
			t.Error("wrong administrative request")
		}
		var input struct {
			Email    string `json:"email"`
			Password string `json:"password"`
			Confirm  *bool  `json:"email_confirm"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Fatal("invalid body")
		}
		if input.Email != "synthetic@example.invalid" || len(input.Password) < 43 || input.Confirm == nil || *input.Confirm {
			t.Error("creation must use fresh password and unconfirmed address")
		}
		passwords = append(passwords, input.Password)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "email_confirmed_at": nil})
	}))
	defer server.Close()
	for range 2 {
		got, err := CreateAuthUser(context.Background(), server.URL+"/auth/v1", "test-secret", "synthetic@example.invalid")
		if err != nil || got != id {
			t.Fatal("creation failed")
		}
	}
	if passwords[0] == passwords[1] {
		t.Fatal("password reused")
	}
}

func TestCreateAuthUserRejectsUnsafeAndAmbiguousResponses(t *testing.T) {
	for _, status := range []int{http.StatusFound, http.StatusBadRequest, http.StatusOK} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.Header().Set("Location", "/credential-leak")
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"id":"` + uuid.NewString() + `","email_confirmed_at":"unexpected-secret"}`))
			}))
			defer server.Close()
			_, err := CreateAuthUser(context.Background(), server.URL+"/auth/v1", "secret-key", "synthetic@example.invalid")
			if err == nil || strings.Contains(err.Error(), "unexpected-secret") || strings.Contains(err.Error(), "secret-key") || calls != 1 {
				t.Fatal("unsafe response or redirect handled incorrectly")
			}
		})
	}
	for _, base := range []string{"http://remote.example/auth/v1", "https://user:password@example.invalid/auth/v1", "https://example.invalid/auth/v1?secret=1", "https://example.invalid"} {
		if _, err := CreateAuthUser(context.Background(), base, "key", "synthetic@example.invalid"); err == nil {
			t.Fatal("unsafe URL accepted")
		}
	}
}
