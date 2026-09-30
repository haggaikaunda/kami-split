// Package auth verifies request identity and binds it to the application database boundary.
package auth

import (
	"errors"
	"net/url"
	"strings"
)

// Config contains trusted deployment values. Token headers never override these values.
type Config struct{ Issuer, Audience, JWKSURL string }

// Load enables verification only when all three AUTH settings are present.
// An absent configuration retains public health-only development mode.
func Load(lookup func(string) (string, bool)) (*Config, error) {
	var c Config
	values := []*string{&c.Issuer, &c.Audience, &c.JWKSURL}
	count := 0
	for i, key := range []string{"AUTH_ISSUER", "AUTH_AUDIENCE", "AUTH_JWKS_URL"} {
		if value, ok := lookup(key); ok {
			*values[i] = value
			count++
		}
	}
	if count == 0 {
		return nil, nil
	}
	if count != 3 || c.validate() != nil {
		return nil, errors.New("AUTH_ISSUER, AUTH_AUDIENCE and AUTH_JWKS_URL must form a complete valid configuration")
	}
	return &c, nil
}

func (c Config) validate() error {
	if !trustedURL(c.Issuer) || !trustedURL(c.JWKSURL) || c.Audience == "" || strings.TrimSpace(c.Audience) != c.Audience {
		return errors.New("invalid authentication configuration")
	}
	return nil
}

func trustedURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Fragment != "" || u.RawQuery != "" {
		return false
	}
	return u.Scheme == "https" || (u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"))
}
