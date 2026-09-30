//go:build integration

package graph_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/haggaikaunda/kami-split/apps/api/internal/onboarding"
	"github.com/haggaikaunda/kami-split/apps/api/internal/server"
	"github.com/jackc/pgx/v5"
	"html"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestIndependentHTTPOnboardingRoundTrip(t *testing.T) {
	ctx := context.Background()
	base, anon, adminKey := os.Getenv("TEST_AUTH_URL"), os.Getenv("TEST_AUTH_ANON_KEY"), os.Getenv("TEST_AUTH_SERVICE_KEY")
	if !strings.HasPrefix(base, "http://127.0.0.1:") {
		t.Fatal("disposable provider required")
	}
	client := &http.Client{Timeout: 10 * time.Second}
	provider := func(path, bearer string, payload any) map[string]any {
		t.Helper()
		raw, _ := json.Marshal(payload)
		req, _ := http.NewRequest("POST", base+path, bytes.NewReader(raw))
		req.Header.Set("apikey", anon)
		req.Header.Set("Content-Type", "application/json")
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal("provider request failed")
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("provider status %d", resp.StatusCode)
		}
		out := map[string]any{}
		if json.NewDecoder(resp.Body).Decode(&out) != nil {
			t.Fatal("provider response invalid")
		}
		return out
	}
	suffix := uuid.NewString()
	password := "Synthetic80!" + suffix
	account := func(label string) (string, string, string) {
		t.Helper()
		email := label + "+" + suffix + "@example.invalid"
		u := provider("/admin/users", adminKey, map[string]any{"email": email, "password": password, "email_confirm": true})
		s := provider("/token?grant_type=password", "", map[string]any{"email": email, "password": password})
		return u["id"].(string), email, s["access_token"].(string)
	}
	owner, _, ownerAccess := account("owner-http80")
	existing, existingEmail, existingAccess := account("existing-http80")
	stranger, _, strangerAccess := account("stranger-http80")
	admin, err := pgx.Connect(ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close(ctx)
	db, err := database.Open(ctx, database.Config{URL: os.Getenv("TEST_DATABASE_URL"), MaxConns: 5, Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	group, ownerMembership, existingUser := uuid.New(), uuid.New(), uuid.New()
	tx, err := admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`SET LOCAL ROLE kami_migrator`, nil},
		{`INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES($1,$1,$1,'Independent owner'),($2,$3,$3,'Existing member')`, []any{owner, existingUser, existing}},
		{`INSERT INTO app.groups(id,name,owner_membership_id) VALUES($1,'Independent household',$2)`, []any{group, ownerMembership}},
		{`INSERT INTO app.memberships(id,group_id,user_id) VALUES($1,$2,$3)`, []any{ownerMembership, group, owner}},
	} {
		if _, err := tx.Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	if tx.Commit(ctx) != nil {
		t.Fatal("fixture commit failed")
	}
	if _, err := admin.Exec(ctx, "SET ROLE kami_migrator"); err != nil {
		t.Fatal(err)
	}
	// Fixtures intentionally remain for the disposable full backup/replay assertion.
	var deliveryToken string
	deliveries := 0
	mail := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		deliveries++
		var p struct {
			Text string `json:"text"`
		}
		if json.NewDecoder(r.Body).Decode(&p) != nil {
			t.Error("delivery invalid")
		}
		for _, line := range strings.Split(p.Text, "\n") {
			if strings.HasPrefix(line, "http://127.0.0.1:3000/join#") {
				deliveryToken = strings.TrimPrefix(line, "http://127.0.0.1:3000/join#")
			}
		}
		fmt.Fprint(w, `{"id":"synthetic-delivery"}`)
	}))
	defer mail.Close()
	settings := map[string]string{"INVITATION_ACTIVE_KEY_ID": "test", "INVITATION_KEYS": `{"test":"` + base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{39}, 32)) + `"}`, "ONBOARDING_AUTH_URL": base, "ONBOARDING_AUTH_PUBLIC_KEY": anon, "RESEND_API_KEY": "synthetic", "ONBOARDING_ORIGIN": "http://127.0.0.1:3000", "INVITATION_FROM": "invites@example.invalid", "ONBOARDING_LOCAL_DELIVERY_URL": mail.URL}
	factory, err := onboarding.Load(func(k string) (string, bool) { v, ok := settings[k]; return v, ok }, db)
	if err != nil {
		t.Fatal(err)
	}
	verifier, err := auth.New(auth.Config{Issuer: base, Audience: "authenticated", JWKSURL: base + "/.well-known/jwks.json"})
	if err != nil || verifier.Warm(ctx) != nil {
		t.Fatal("verifier setup failed")
	}
	h, err := onboarding.NewHandler(factory, verifier, "http://127.0.0.1:3000", adminKey)
	if err != nil {
		t.Fatal(err)
	}
	app := serverForIndependent(factory, verifier)
	app.Use(h.Wrap)
	post := func(path string, payload any, access string, cookie *http.Cookie) (*httptest.ResponseRecorder, map[string]any) {
		t.Helper()
		raw, _ := json.Marshal(payload)
		req := httptest.NewRequest("POST", path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "http://127.0.0.1:3000")
		if access != "" {
			req.Header.Set("Authorization", "Bearer "+access)
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		out := httptest.NewRecorder()
		app.Handler().ServeHTTP(out, req)
		value := map[string]any{}
		if json.Unmarshal(out.Body.Bytes(), &value) != nil {
			t.Fatal("invalid application response")
		}
		return out, value
	}
	gql := func(query, access, field string) map[string]any {
		t.Helper()
		_, out := post("/graphql", map[string]string{"query": query}, access, nil)
		data, ok := out["data"].(map[string]any)
		if !ok {
			t.Fatal("GraphQL operation failed before domain response")
		}
		result, ok := data[field].(map[string]any)
		if !ok {
			t.Fatal("GraphQL omitted domain response")
		}
		return result
	}
	selection := `{... on InvitationActionResult{outcome actionID invitationID hasAccess groupID} ... on InvitationProblem{code}}`
	groupID := ledger.PublicID("Group", group.String())
	create := func(email string) map[string]any {
		return gql(fmt.Sprintf(`mutation{createTargetedInvitation(groupID:%q,email:%q,key:%q)%s}`, groupID, email, uuid.NewString(), selection), ownerAccess, "createTargetedInvitation")
	}
	newEmail := "new-http80+" + suffix + "@example.invalid"
	created := create(newEmail)
	if created["outcome"] != "SAVED" {
		t.Fatal("owner create failed")
	}
	if duplicate := create(newEmail); duplicate["outcome"] != "EXISTING" || duplicate["invitationID"] != created["invitationID"] || deliveries != 0 {
		t.Fatal("duplicate create renewed or delivered")
	}
	send := func(action any) {
		t.Helper()
		result := gql(fmt.Sprintf(`mutation{retryInvitationDelivery(actionID:%q){... on InvitationDeliveryResult{status} ... on InvitationProblem{code}}}`, action), ownerAccess, "retryInvitationDelivery")
		if result["status"] != "ATTEMPTED" || deliveryToken == "" {
			t.Fatal("committed delivery failed")
		}
	}
	send(created["actionID"])
	start := func(token string) *http.Cookie {
		t.Helper()
		out, _ := post("/onboarding/start", map[string]string{"token": token}, "", nil)
		cookies := out.Result().Cookies()
		if out.Code != 200 || len(cookies) != 1 {
			t.Fatal("context start failed")
		}
		return cookies[0]
	}
	cookie := start(deliveryToken)
	_, preview := post("/onboarding/preview", map[string]string{}, "", cookie)
	if len(preview) != 2 || preview["groupName"] != "Independent household" || preview["inviterDisplayName"] != "Independent owner" {
		t.Fatal("preview leaked or omitted fields")
	}
	_, wrong := post("/onboarding/accept", map[string]string{"key": uuid.NewString()}, strangerAccess, cookie)
	if wrong["code"] != "WRONG_ACCOUNT" {
		t.Fatal("unrelated user not denied")
	}
	var count int
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM app.users WHERE auth_subject=$1`, stranger).Scan(&count); err != nil || count != 0 {
		t.Fatal("wrong-account acceptance left app identity")
	}
	_, generic := post("/onboarding/provision", map[string]string{"email": newEmail}, "", cookie)
	if generic["code"] != "CHECK_EMAIL" {
		t.Fatal("eligible provisioning failed")
	}
	challenge, state := independentDeliveredChallenge(t, client, newEmail)
	_, callback := post("/onboarding/callback-state", map[string]string{"state": state}, "", cookie)
	if callback["code"] != "READY" {
		t.Fatal("actual email browser state rejected")
	}
	session := provider("/verify", "", map[string]string{"type": "invite", "token_hash": challenge})
	newAccess := session["access_token"].(string)
	newSubject := session["user"].(map[string]any)["id"].(string)
	operation := uuid.NewString()
	_, accepted := post("/onboarding/accept", map[string]string{"key": operation}, newAccess, cookie)
	if accepted["code"] != "ADMITTED" || accepted["hasAccess"] != true || accepted["groupID"] != groupID {
		t.Fatal("verified new account not admitted")
	}
	_, repeated := post("/onboarding/accept", map[string]string{"key": operation}, newAccess, cookie)
	if repeated["hasAccess"] != true {
		t.Fatal("same-action recovery lost admission")
	}
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM app.memberships m JOIN app.users u ON u.id=m.user_id WHERE u.auth_subject=$1 AND m.group_id=$2`, newSubject, group).Scan(&count); err != nil || count != 1 {
		t.Fatal("repeated admission duplicated membership")
	}
	entry := create(existingEmail)
	send(entry["actionID"])
	existingCookie := start(deliveryToken)
	_, admitted := post("/onboarding/accept", map[string]string{"key": uuid.NewString()}, existingAccess, existingCookie)
	if admitted["code"] != "ADMITTED" {
		t.Fatal("existing account admission failed")
	}
	var actualUser string
	if err := admin.QueryRow(ctx, `SELECT user_id::text FROM app.memberships WHERE group_id=$1 AND user_id=$2`, group, existingUser).Scan(&actualUser); err != nil || actualUser != existingUser.String() {
		t.Fatal("existing application identity replaced")
	}
	if _, err := admin.Exec(ctx, `UPDATE app.users SET enabled=false WHERE id=$1`, existingUser); err != nil {
		t.Fatal(err)
	}
	_, disabled := post("/onboarding/accept", map[string]string{"key": uuid.NewString()}, existingAccess, existingCookie)
	if disabled["hasAccess"] == true || disabled["code"] == "ADMITTED" {
		t.Fatal("disabled application identity regained access")
	}

	// Owner renewal preserves an expired capability; retries preserve the action.
	outstanding := create("terminal-http80+" + suffix + "@example.invalid")
	send(outstanding["actionID"])
	originalToken := deliveryToken
	rawID, err := ledger.ParseID(outstanding["invitationID"].(string), "Invitation")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, `UPDATE app.invitations SET expires_at=clock_timestamp() WHERE id=$1`, rawID); err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, `UPDATE app.invitation_actions SET committed_at=committed_at-interval '2 minutes' WHERE group_id=$1`, group); err != nil {
		t.Fatal(err)
	}
	resendKey := uuid.NewString()
	resendQuery := fmt.Sprintf(`mutation{resendInvitation(groupID:%q,id:%q,key:%q)%s}`, groupID, outstanding["invitationID"], resendKey, selection)
	renewed := gql(resendQuery, ownerAccess, "resendInvitation")
	if renewed["outcome"] != "APPLIED" {
		t.Fatal("expired owner resend failed")
	}
	retryRenewal := gql(resendQuery, ownerAccess, "resendInvitation")
	if retryRenewal["actionID"] != renewed["actionID"] {
		t.Fatal("same-key resend created new action")
	}
	send(renewed["actionID"])
	if deliveryToken != originalToken {
		t.Fatal("expired resend rotated application link")
	}
	revoked := gql(fmt.Sprintf(`mutation{revokeInvitation(groupID:%q,id:%q,key:%q)%s}`, groupID, outstanding["invitationID"], uuid.NewString(), selection), ownerAccess, "revokeInvitation")
	if revoked["outcome"] != "APPLIED" {
		t.Fatal("owner revoke failed")
	}
	deniedStart, _ := post("/onboarding/start", map[string]string{"token": originalToken}, "", nil)
	if deniedStart.Code != 400 {
		t.Fatal("revoked link recovered preview context")
	}
	terminal := gql(fmt.Sprintf(`mutation{resendInvitation(groupID:%q,id:%q,key:%q)%s}`, groupID, outstanding["invitationID"], uuid.NewString(), selection), ownerAccess, "resendInvitation")
	if terminal["outcome"] != "ALREADY_REVOKED" {
		t.Fatal("revoked invitation renewed")
	}
	page := gql(fmt.Sprintf(`{ownerInvitations(groupID:%q){... on OwnerInvitationPage{items{id recipient lifecycle}} ... on InvitationProblem{code}}}`, groupID), ownerAccess, "ownerInvitations")
	items, ok := page["items"].([]any)
	if !ok || len(items) != 3 {
		t.Fatal("owner invitation list omitted history")
	}
	for _, entry := range items {
		item := entry.(map[string]any)
		if item["recipient"] != nil {
			t.Fatal("terminal management response retained recipient")
		}
	}
	denied := gql(fmt.Sprintf(`{ownerInvitations(groupID:%q){... on InvitationProblem{code}}}`, groupID), newAccess, "ownerInvitations")
	if denied["code"] != "ACCESS_DENIED" {
		t.Fatal("nonowner inspected invitations")
	}
}

func serverForIndependent(factory *onboarding.Factory, verifier *auth.Verifier) *server.Server {
	return server.NewWithAuthentication(config.Config{}, graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{Invitations: factory}}), slog.New(slog.NewTextHandler(io.Discard, nil)), verifier)
}
func independentDeliveredChallenge(t *testing.T, client *http.Client, email string) (string, string) {
	t.Helper()
	base := os.Getenv("TEST_SMTP_URL")
	if !strings.HasPrefix(base, "http://127.0.0.1:") {
		t.Fatal("disposable SMTP required")
	}
	for attempt := 0; attempt < 30; attempt++ {
		resp, err := client.Get(base + "/api/v1/search?query=" + url.QueryEscape("to:"+email))
		if err != nil {
			t.Fatal("SMTP unavailable")
		}
		var box struct{ Messages []struct{ ID string } }
		err = json.NewDecoder(resp.Body).Decode(&box)
		resp.Body.Close()
		if err != nil {
			t.Fatal("SMTP mailbox invalid")
		}
		for _, item := range box.Messages {
			resp, err := client.Get(base + "/api/v1/message/" + url.PathEscape(item.ID))
			if err != nil {
				t.Fatal("SMTP unavailable")
			}
			var msg struct{ HTML, Text string }
			err = json.NewDecoder(resp.Body).Decode(&msg)
			resp.Body.Close()
			if err != nil {
				t.Fatal("SMTP message invalid")
			}
			for _, link := range regexp.MustCompile(`https?://[^\s<>"']+`).FindAllString(html.UnescapeString(msg.HTML+" "+msg.Text), -1) {
				u, e := url.Parse(link)
				if e != nil {
					continue
				}
				fragment, e := url.ParseQuery(u.Fragment)
				if e == nil && fragment.Get("type") == "invite" && fragment.Get("token_hash") != "" && fragment.Get("state") != "" {
					return fragment.Get("token_hash"), fragment.Get("state")
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("actual invitation verification email missing")
	return "", ""
}
