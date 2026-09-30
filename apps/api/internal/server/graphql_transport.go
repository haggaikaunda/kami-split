package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"
)

type graphResponse struct {
	header http.Header
	body   bytes.Buffer
	status int
}

func (r *graphResponse) Header() http.Header { return r.header }
func (r *graphResponse) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
}
func (r *graphResponse) Write(p []byte) (int, error) {
	if r.status == 0 {
		r.status = 200
	}
	return r.body.Write(p)
}

// GraphQL transports buffer their bounded JSON response so pre-execution auth
// and coercion failures receive contract HTTP codes while field errors preserve
// partial data. No response or request content is logged.
func graphTransport(next http.Handler) http.Handler {
	return graphTransportWithTimeout(next, 10*time.Second)
}

// The execution deadline cancels database lock waits; socket WriteTimeout alone
// does not cancel a blocked handler. Tests inject a shorter budget.
func graphTransportWithTimeout(next http.Handler, timeout time.Duration) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
		if err != nil {
			http.Error(w, "request too large", http.StatusRequestEntityTooLarge)
			return
		}
		var envelope struct {
			Query string `json:"query"`
		}
		if !utf8.Valid(body) || !validSurrogates(string(body)) || json.Unmarshal(body, &envelope) != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, `{"errors":[{"message":"Invalid request.","extensions":{"code":"BAD_USER_INPUT"}}]}`)
			return
		}
		query, valid := normalizeGraphQLUnicode(envelope.Query)
		if !valid {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, `{"errors":[{"message":"Invalid request.","extensions":{"code":"BAD_USER_INPUT"}}]}`)
			return
		}
		if query != envelope.Query {
			var fields map[string]json.RawMessage
			if json.Unmarshal(body, &fields) != nil {
				return
			}
			fields["query"], _ = json.Marshal(query)
			body, _ = json.Marshal(fields)
			r.ContentLength = int64(len(body))
		}
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		r = r.WithContext(ctx)
		r.Body = io.NopCloser(bytes.NewReader(body))
		out := &graphResponse{header: make(http.Header)}
		next.ServeHTTP(out, r)
		var result struct {
			Data   json.RawMessage `json:"data"`
			Errors []struct {
				Extensions map[string]any `json:"extensions"`
			} `json:"errors"`
		}
		_ = json.Unmarshal(out.body.Bytes(), &result)
		status := out.status
		if status == 0 {
			status = 200
		}
		if status == 422 {
			status = 400
		}
		for _, e := range result.Errors {
			switch e.Extensions["code"] {
			case "UNAUTHENTICATED":
				status = 401
			case "AUTH_UNAVAILABLE":
				status = 503
			case "BAD_USER_INPUT":
				if len(result.Data) == 0 || string(result.Data) == "null" {
					status = 400
				}
			}
		}
		// The private marker distinguishes pre-execution verification outages from
		// domain field failures; clients see only the approved UNAVAILABLE code.
		responseBody := bytes.ReplaceAll(out.body.Bytes(), []byte(`"code":"AUTH_UNAVAILABLE"`), []byte(`"code":"UNAVAILABLE"`))
		for key, values := range out.header {
			w.Header()[key] = values
		}
		w.Header().Set("Cache-Control", "no-store")
		if status == 401 {
			w.Header().Set("WWW-Authenticate", "Bearer")
		}
		w.WriteHeader(status)
		_, _ = w.Write(responseBody)
	})
}

// JSON normally replaces lone surrogate escapes; reject them before decoding
// so malformed strings cannot silently become different canonical intents.
func validSurrogates(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] != '\\' {
			continue
		}
		i++
		if i >= len(s) {
			return true
		}
		if s[i] != 'u' {
			continue
		}
		if i+4 >= len(s) {
			return false
		}
		n, e := strconv.ParseUint(s[i+1:i+5], 16, 16)
		if e != nil {
			return false
		}
		i += 4
		if n >= 0xDC00 && n <= 0xDFFF {
			return false
		}
		if n < 0xD800 || n > 0xDBFF {
			continue
		}
		if i+6 >= len(s) || s[i+1:i+3] != "\\u" {
			return false
		}
		low, e := strconv.ParseUint(s[i+3:i+7], 16, 16)
		if e != nil || low < 0xDC00 || low > 0xDFFF {
			return false
		}
		i += 6
	}
	return true
}

// Normalize only ordinary GraphQL string tokens. Comments and block strings do
// not interpret Unicode escapes. The pinned parser writes surrogate halves as
// replacement characters, so valid pairs are combined before parsing; malformed
// pairs fail rather than changing a financial intent.
func normalizeGraphQLUnicode(source string) (string, bool) {
	var result strings.Builder
	for i := 0; i < len(source); {
		if source[i] == '#' {
			end := strings.IndexAny(source[i:], "\r\n")
			if end < 0 {
				result.WriteString(source[i:])
				break
			}
			result.WriteString(source[i : i+end])
			i += end
			continue
		}
		if strings.HasPrefix(source[i:], `"""`) {
			start := i
			i += 3
			for i < len(source) {
				if strings.HasPrefix(source[i:], `\"""`) {
					i += 4
					continue
				}
				if strings.HasPrefix(source[i:], `"""`) {
					i += 3
					break
				}
				i++
			}
			result.WriteString(source[start:i])
			continue
		}
		if source[i] != '"' {
			result.WriteByte(source[i])
			i++
			continue
		}
		start := i
		i++
		for i < len(source) {
			if source[i] == '\\' {
				i++
				if i < len(source) {
					i++
				}
				continue
			}
			if source[i] == '"' {
				i++
				break
			}
			i++
		}
		token := source[start:i]
		if !validSurrogates(token) {
			return "", false
		}
		for j := 0; j < len(token); {
			if token[j] != '\\' || j+1 >= len(token) {
				result.WriteByte(token[j])
				j++
				continue
			}
			if token[j+1] == 'u' && j+5 < len(token) {
				high, err := strconv.ParseUint(token[j+2:j+6], 16, 16)
				if err == nil && high >= 0xD800 && high <= 0xDBFF {
					low, _ := strconv.ParseUint(token[j+8:j+12], 16, 16)
					result.WriteRune(utf16.DecodeRune(rune(high), rune(low)))
					j += 12
					continue
				}
			}
			result.WriteString(token[j : j+2])
			j += 2
		}
	}
	return result.String(), true
}
