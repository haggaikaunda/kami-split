package onboarding

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/invitation"
)

// Factory retains only deployment dependencies. It creates a separate email
// provider per HTTP request; privileged provisioning is confined to Handler.
type Factory struct {
	db              *database.DB
	protector       *invitation.Protector
	authURL, apiKey string
	Sender          *Sender
}

type requestTokenKey struct{}

// Request binds only this HTTP request's bearer for the provider lookup. The
// independent auth verifier must still authorize every authenticated operation.
func Request(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := ""
		headers := r.Header.Values("Authorization")
		if len(headers) == 1 {
			p := strings.Fields(headers[0])
			if len(p) == 2 && strings.EqualFold(p[0], "Bearer") {
				token = p[1]
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestTokenKey{}, token)))
	})
}

// Service returns a request-scoped adapter over #79, never a second lifecycle.
func (f *Factory) Service(ctx context.Context) (*invitation.Service, error) {
	if f == nil {
		return nil, invitation.Unavailable
	}
	var provider *EmailProvider
	if token, _ := ctx.Value(requestTokenKey{}).(string); token != "" {
		var err error
		provider, err = NewEmailProvider(f.authURL, f.apiKey, token)
		if err != nil {
			return nil, err
		}
	}
	if provider == nil {
		return invitation.New(f.db, f.protector, nil)
	}
	return invitation.New(f.db, f.protector, provider)
}

// Load enables onboarding only with a complete deployment configuration. No
// secrets or URL values are included in configuration errors.
func Load(lookup func(string) (string, bool), db *database.DB) (*Factory, error) {
	active, set := lookup("INVITATION_ACTIVE_KEY_ID")
	if !set {
		return nil, nil
	}
	failure := func() (*Factory, error) { return nil, errors.New("invalid onboarding configuration") }
	encoded, _ := lookup("INVITATION_KEYS")
	var raw map[string]string
	if len(encoded) > 16384 || json.Unmarshal([]byte(encoded), &raw) != nil {
		return failure()
	}
	keys := map[string][]byte{}
	for id, value := range raw {
		key, err := base64.RawURLEncoding.Strict().DecodeString(value)
		if err != nil {
			return failure()
		}
		keys[id] = key
	}
	p, err := invitation.NewProtector(active, keys)
	if err != nil || db == nil {
		return failure()
	}
	authURL, _ := lookup("ONBOARDING_AUTH_URL")
	apiKey, _ := lookup("ONBOARDING_AUTH_PUBLIC_KEY")
	if !trustedEndpoint(authURL) || apiKey == "" {
		return failure()
	}
	resendKey, _ := lookup("RESEND_API_KEY")
	origin, _ := lookup("ONBOARDING_ORIGIN")
	from, _ := lookup("INVITATION_FROM")
	deliveryURL := "https://api.resend.com/emails"
	if local, ok := lookup("ONBOARDING_LOCAL_DELIVERY_URL"); ok {
		u, err := url.Parse(local)
		if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return failure()
		}
		deliveryURL = local
	}
	sender, err := NewSender(deliveryURL, resendKey, origin, from)
	if err != nil {
		return failure()
	}
	return &Factory{db, p, authURL, apiKey, sender}, nil
}
