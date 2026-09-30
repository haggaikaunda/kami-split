package onboarding

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const syntheticSnapshot = `{"recipient":"synthetic@example.invalid","token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","expiresAt":"2026-10-01T00:00:00Z","template":"targeted-v1"}`

func TestDeliveryStableAndSeparateOutcomes(t *testing.T) {
	var bodies []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(body))
		if r.Header.Get("Idempotency-Key") != "original-action" {
			t.Error("changed action")
		}
		if len(bodies) == 1 {
			w.WriteHeader(503)
		} else {
			fmt.Fprint(w, `{"id":"provider-id"}`)
		}
	}))
	defer server.Close()
	sender, err := NewSender(server.URL, "key", "https://kami.example", "Kami <invites@kami.example>")
	if err != nil {
		t.Fatal(err)
	}
	if sender.send(context.Background(), []byte(syntheticSnapshot), "original-action") != "UNKNOWN" || sender.send(context.Background(), []byte(syntheticSnapshot), "original-action") != "PROVIDER_ACCEPTED" {
		t.Fatal("wrong send outcomes")
	}
	if len(bodies) != 2 || bodies[0] != bodies[1] {
		t.Fatal("retry payload changed")
	}
	var payload struct {
		To   []string `json:"to"`
		Text string   `json:"text"`
	}
	if json.Unmarshal([]byte(bodies[0]), &payload) != nil {
		t.Fatal("invalid payload")
	}
	if len(payload.To) != 1 || payload.To[0] != "synthetic@example.invalid" || !strings.Contains(payload.Text, "https://kami.example/join#AAAAAAAA") {
		t.Fatal("wrong recipient/link")
	}
}

func TestDeliveryFailureClassification(t *testing.T) {
	for _, tc := range []struct {
		status     int
		body, want string
	}{{400, `{}`, "FAILED_DEFINITE"}, {429, `{}`, "FAILED_DEFINITE"}, {408, `{}`, "UNKNOWN"}, {409, `{}`, "UNKNOWN"}, {200, `{}`, "UNKNOWN"}, {200, `{`, "UNKNOWN"}, {500, `{}`, "UNKNOWN"}} {
		t.Run(fmt.Sprint(tc.status, tc.body), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.status); fmt.Fprint(w, tc.body) }))
			defer server.Close()
			sender, _ := NewSender(server.URL, "key", "https://kami.example", "invites@kami.example")
			if got := sender.send(context.Background(), []byte(syntheticSnapshot), "action"); got != tc.want {
				t.Fatalf("got %s want %s", got, tc.want)
			}
		})
	}
}
