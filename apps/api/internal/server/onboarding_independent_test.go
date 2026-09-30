package server

import (
	"bytes"
	"encoding/json"
	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIndependentOnboardingTransportBoundary(t *testing.T) {
	app := New(config.Config{}, graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{}}), slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, tc := range []struct{ query, want string }{
		{`{previewInvitation(token:"invalid"){... on InvitationProblem{code}}}`, `"code":"UNAVAILABLE"`},
		{`{ownerInvitations(groupID:"invalid"){... on InvitationProblem{code}}}`, `UNAUTHENTICATED`},
		{`{a:previewInvitation(token:"invalid"){__typename} b:previewInvitation(token:"invalid"){__typename}}`, `Submit one invitation operation per request`},
		{`{previewInvitation(token:"invalid"){__typename} health{status}}`, `Submit one invitation operation per request`},
	} {
		body, _ := json.Marshal(map[string]string{"query": tc.query})
		req := httptest.NewRequest("POST", "/graphql", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		out := httptest.NewRecorder()
		app.Handler().ServeHTTP(out, req)
		if !strings.Contains(out.Body.String(), tc.want) {
			t.Fatalf("missing safe boundary %q: %s", tc.want, out.Body.String())
		}
	}
}
