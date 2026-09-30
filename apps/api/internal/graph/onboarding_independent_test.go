package graph

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/haggaikaunda/kami-split/apps/api/internal/onboarding"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIndependentInvitationGraphQLAuthorization(t *testing.T) {
	settings := map[string]string{"INVITATION_ACTIVE_KEY_ID": "test", "INVITATION_KEYS": `{"test":"` + base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{31}, 32)) + `"}`, "ONBOARDING_AUTH_URL": "https://auth.example", "ONBOARDING_AUTH_PUBLIC_KEY": "synthetic", "RESEND_API_KEY": "synthetic", "ONBOARDING_ORIGIN": "https://kami.example", "INVITATION_FROM": "invite@example.invalid"}
	factory, err := onboarding.Load(func(k string) (string, bool) { v, ok := settings[k]; return v, ok }, &database.DB{})
	if err != nil {
		t.Fatal(err)
	}
	server := handler.NewDefaultServer(NewExecutableSchema(Config{Resolvers: &Resolver{Invitations: factory}}))
	id := ledger.PublicID("Group", uuid.NewString())
	invite := ledger.PublicID("Invitation", uuid.NewString())
	action := ledger.PublicID("InvitationAction", uuid.NewString())
	key := uuid.NewString()
	for _, query := range []string{
		fmt.Sprintf(`mutation { createTargetedInvitation(groupID:%q,email:"synthetic@example.invalid",key:%q) {... on InvitationProblem {code}}}`, id, key),
		fmt.Sprintf(`mutation { resendInvitation(groupID:%q,id:%q,key:%q) {... on InvitationProblem {code}}}`, id, invite, key),
		fmt.Sprintf(`mutation { revokeInvitation(groupID:%q,id:%q,key:%q) {... on InvitationProblem {code}}}`, id, invite, key),
		fmt.Sprintf(`mutation { retryInvitationDelivery(actionID:%q) {... on InvitationProblem {code}}}`, action),
		fmt.Sprintf(`mutation { acceptInvitation(token:%q,key:%q) {... on InvitationProblem {code}}}`, strings.Repeat("A", 43), key),
		fmt.Sprintf(`{ ownerInvitations(groupID:%q) {... on InvitationProblem {code}}}`, id),
		fmt.Sprintf(`{ invitationAction(kind:ACCEPT,key:%q) {... on InvitationProblem {code}}}`, key),
	} {
		body, _ := json.Marshal(map[string]string{"query": query})
		req := httptest.NewRequest("POST", "/graphql", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		out := httptest.NewRecorder()
		server.ServeHTTP(out, req)
		if out.Code != 200 || !strings.Contains(out.Body.String(), `"code":"UNAUTHENTICATED"`) || strings.Contains(out.Body.String(), `"errors"`) {
			t.Fatalf("anonymous operation did not return typed denial: %s", out.Body.String())
		}
	}
}
