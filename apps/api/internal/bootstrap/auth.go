package bootstrap

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

// CreateAuthUser invokes supported Supabase administrative creation exactly
// once, with an unconfirmed address and a random unshared initial password held
// only in memory. It returns only the explicit Auth ID. An uncertain response
// requires operator inspection of the selected Auth project; there is no automatic
// retry, email lookup, confirmation, invitation, logging or application write.
func CreateAuthUser(ctx context.Context, base, key, email string) (string, error) {
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "/auth/v1" || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost" || u.Hostname() == "::1"))) {
		return "", errors.New("explicit HTTPS Auth URL required (loopback HTTP allowed locally)")
	}
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email || key == "" {
		return "", errors.New("explicit email and administrative credential required")
	}
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return "", errors.New("password randomness unavailable")
	}
	// Include every ordinary provider character class without reducing entropy.
	password := base64.RawURLEncoding.EncodeToString(random) + "aA1!"
	payload, _ := json.Marshal(struct {
		Email        string `json:"email"`
		Password     string `json:"password"`
		EmailConfirm bool   `json:"email_confirm"`
	}{email, password, false})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/admin/users", bytes.NewReader(payload))
	if err != nil {
		return "", errors.New("Auth request unavailable")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", key)
	req.Header.Set("Authorization", "Bearer "+key)
	client := &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return "", errors.New("Auth creation outcome unknown; inspect selected project before retry")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return "", errors.New("Auth creation not confirmed; inspect selected project before retry")
	}
	var user struct {
		ID               string  `json:"id"`
		EmailConfirmedAt *string `json:"email_confirmed_at"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&user); err != nil {
		return "", errors.New("Auth creation response invalid; inspect selected project")
	}
	id, err := uuid.Parse(user.ID)
	if err != nil || id == uuid.Nil || id.String() != user.ID || (user.EmailConfirmedAt != nil && strings.TrimSpace(*user.EmailConfirmedAt) != "") {
		return "", errors.New("Auth creation identity/verification unexpected; inspect selected project")
	}
	return user.ID, nil
}
