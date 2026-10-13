//go:build integration

package graph_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
	"github.com/haggaikaunda/kami-split/apps/api/internal/invitation"
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
	"sync"
	"testing"
	"time"
)

func TestIndependentHTTPOnboardingRoundTrip(t *testing.T) {
	for _, keys := range []struct {
		name, public, admin string
	}{
		{"legacy", os.Getenv("TEST_AUTH_ANON_KEY"), os.Getenv("TEST_AUTH_SERVICE_KEY")},
		{"modern", os.Getenv("TEST_AUTH_PUBLISHABLE_KEY"), os.Getenv("TEST_AUTH_SECRET_KEY")},
	} {
		t.Run(keys.name, func(t *testing.T) {
			if keys.public == "" || keys.admin == "" {
				t.Fatal("disposable Auth keys required")
			}
			independentHTTPOnboardingRoundTrip(t, keys.public, keys.admin)
		})
	}
}

func independentHTTPOnboardingRoundTrip(t *testing.T, anon, adminKey string) {
	t.Helper()
	ctx := context.Background()
	base := os.Getenv("TEST_AUTH_URL")
	if !strings.HasPrefix(base, "http://127.0.0.1:") {
		t.Fatal("disposable provider required")
	}
	client := &http.Client{Timeout: 10 * time.Second}
	provider := func(method, path, bearer string, payload any) map[string]any {
		t.Helper()
		raw, _ := json.Marshal(payload)
		req, _ := http.NewRequest(method, base+path, bytes.NewReader(raw))
		req.Header.Set("apikey", anon)
		req.Header.Set("Content-Type", "application/json")
		if bearer == adminKey {
			req.Header.Set("apikey", adminKey)
			if !strings.HasPrefix(adminKey, "sb_secret_") {
				req.Header.Set("Authorization", "Bearer "+adminKey)
			}
		} else if bearer != "" {
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
		u := provider(http.MethodPost, "/admin/users", adminKey, map[string]any{"email": email, "password": password, "email_confirm": true})
		s := provider(http.MethodPost, "/token?grant_type=password", "", map[string]any{"email": email, "password": password})
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
	authAdmin, err := pgx.Connect(ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer authAdmin.Close(ctx)
	assertAuthUsers := func(email string, want int) {
		t.Helper()
		var count int
		if err := authAdmin.QueryRow(ctx, `SELECT count(*) FROM auth.users WHERE email=$1`, email).Scan(&count); err != nil || count != want {
			t.Fatalf("Auth identity count: got %d, want %d (query failed: %t)", count, want, err != nil)
		}
	}
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
		{`INSERT INTO app.users(id, auth_subject, live_auth_id, display_name)
VALUES($1, $1, $1, 'Independent owner'), ($2, $3, $3, 'Existing member')`, []any{owner, existingUser, existing}},
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
	// Interpose only a local synthetic transport for controlled failure/race tests.
	var hookMu sync.Mutex
	var targetHook func(map[string]any) bool
	var failUser, failBeforeGeneration bool
	providerProxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hookMu.Lock()
		blockedUser := failUser
		blockedGeneration := failBeforeGeneration
		hookMu.Unlock()
		if r.URL.Path == "/admin/generate_link" && blockedGeneration {
			w.WriteHeader(503)
			return
		}
		if r.URL.Path == "/user" && blockedUser {
			w.WriteHeader(503)
			return
		}
		request, err := http.NewRequestWithContext(r.Context(), r.Method, base+r.URL.RequestURI(), r.Body)
		if err != nil {
			t.Error("proxy request invalid")
			return
		}
		request.Header = r.Header.Clone()
		response, err := client.Do(request)
		if err != nil {
			t.Error("proxy request failed")
			w.WriteHeader(503)
			return
		}
		defer response.Body.Close()
		raw, err := io.ReadAll(response.Body)
		if err != nil {
			t.Error("proxy response failed")
			return
		}
		if r.URL.Path == "/admin/generate_link" {
			hookMu.Lock()
			hook := targetHook
			hookMu.Unlock()
			if hook != nil {
				payload := map[string]any{}
				if json.Unmarshal(raw, &payload) != nil {
					t.Error("proxy response invalid")
					return
				}
				if hook(payload) {
					w.WriteHeader(503)
					return
				}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(response.StatusCode)
		_, _ = w.Write(raw)
	}))
	defer providerProxy.Close()
	setHook := func(hook func(map[string]any) bool) { hookMu.Lock(); targetHook = hook; hookMu.Unlock() }
	settings := map[string]string{"INVITATION_ACTIVE_KEY_ID": "test", "INVITATION_KEYS": `{"test":"` + base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{39}, 32)) + `"}`, "ONBOARDING_AUTH_URL": providerProxy.URL, "ONBOARDING_AUTH_PUBLIC_KEY": anon, "RESEND_API_KEY": "synthetic", "ONBOARDING_ORIGIN": "http://127.0.0.1:3000", "INVITATION_FROM": "invites@example.invalid", "ONBOARDING_LOCAL_DELIVERY_URL": mail.URL}
	factory, err := onboarding.Load(func(k string) (string, bool) { v, ok := settings[k]; return v, ok }, db)
	if err != nil {
		t.Fatal(err)
	}
	verifier, err := auth.New(auth.Config{Issuer: base, Audience: "authenticated", JWKSURL: base + "/.well-known/jwks.json"})
	if err != nil || verifier.Warm(ctx) != nil {
		t.Fatal("verifier setup failed")
	}
	var providerLogs bytes.Buffer
	h, err := onboarding.NewHandler(factory, verifier, "http://127.0.0.1:3000", adminKey, slog.New(slog.NewJSONHandler(&providerLogs, nil)))
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
	originalCapability := deliveryToken
	originalDigest := hex.EncodeToString(invitation.TokenHash(originalCapability))
	cookie := start(originalCapability)
	_, preview := post("/onboarding/preview", map[string]string{}, "", cookie)
	if len(preview) != 3 || preview["kind"] != "TARGETED" || preview["groupName"] != "Independent household" || preview["inviterDisplayName"] != "Independent owner" {
		t.Fatal("preview leaked or omitted fields")
	}
	_, wrong := post("/onboarding/accept", map[string]string{"key": uuid.NewString(), "tokenDigest": originalDigest}, strangerAccess, cookie)
	if wrong["code"] != "WRONG_ACCOUNT" {
		t.Fatal("unrelated user not denied")
	}
	var count int
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM app.users WHERE auth_subject=$1`, stranger).Scan(&count); err != nil || count != 0 {
		t.Fatal("wrong-account acceptance left app identity")
	}
	assertAuthUsers(newEmail, 0)
	if strings.HasPrefix(adminKey, "sb_secret_") {
		// Reproduce the deployed pre-fix header pair against the real disposable
		// gateway; a publishable apikey cannot authorize a secret-key bearer.
		raw, err := json.Marshal(map[string]string{"email": newEmail})
		if err != nil {
			t.Fatal("pre-fix probe encoding failed")
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/invite", bytes.NewReader(raw))
		if err != nil {
			t.Fatal("pre-fix probe request invalid")
		}
		req.Header.Set("apikey", anon)
		req.Header.Set("Authorization", "Bearer "+adminKey)
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal("pre-fix probe transport failed")
		}
		resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			t.Fatal("pre-fix modern-key headers unexpectedly provisioned account")
		}
		t.Logf("pre-fix modern-key header pair rejected with HTTP %d", resp.StatusCode)
		assertAuthUsers(newEmail, 0)
	}
	wrongEmail := "wrong-http162+" + suffix + "@example.invalid"
	wrongResponse, wrongProvision := post("/onboarding/provision", map[string]string{"email": wrongEmail, "tokenDigest": originalDigest}, "", cookie)
	assertAuthUsers(wrongEmail, 0)
	if !strings.Contains(providerLogs.String(), `"outcome":"ineligible"`) {
		t.Fatal("ineligible provisioning omitted server diagnostic")
	}
	genericResponse, generic := post("/onboarding/provision", map[string]string{"email": "ineligible-" + newEmail, "tokenDigest": originalDigest}, "", cookie)
	if genericResponse.Code != http.StatusOK || generic["code"] != "CHECK_EMAIL" {
		t.Fatal("eligible provisioning failed")
	}
	if wrongResponse.Code != genericResponse.Code || wrongResponse.Body.String() != genericResponse.Body.String() || wrongProvision["code"] != "CHECK_EMAIL" {
		t.Fatal("wrong email provisioning disclosed eligibility")
	}
	assertAuthUsers(newEmail, 0)
	// GET scanners cannot consume the explicit continuation.
	scanner := httptest.NewRequest(http.MethodGet, "/onboarding/targeted-continuation", nil)
	scanner.AddCookie(cookie)
	scannerOut := httptest.NewRecorder()
	app.Handler().ServeHTTP(scannerOut, scanner)
	if scannerOut.Code != 405 {
		t.Fatal("scanner request accepted")
	}
	hookMu.Lock()
	failUser = true
	hookMu.Unlock()
	_, observationFailure := post("/onboarding/targeted-continuation", map[string]string{"tokenDigest": originalDigest}, strangerAccess, cookie)
	hookMu.Lock()
	failUser = false
	hookMu.Unlock()
	if observationFailure["code"] != "UNAVAILABLE" || !strings.Contains(providerLogs.String(), `"outcome":"email_observation_failure"`) {
		t.Fatal("current-email provider failure lost safe owning diagnostic")
	}
	_, wrongTarget := post("/onboarding/targeted-continuation", map[string]string{"tokenDigest": originalDigest}, strangerAccess, cookie)
	if wrongTarget["code"] != "WRONG_ACCOUNT" {
		t.Fatal("wrong current account not rejected before claim")
	}
	_, continuation := post("/onboarding/targeted-continuation", map[string]string{"tokenDigest": originalDigest}, "", cookie)
	if continuation["code"] != "READY" || continuation["needsPassword"] != true || continuation["type"] != "signup" {
		t.Fatal("new targeted Auth continuation failed")
	}
	assertAuthUsers(newEmail, 1)
	_, replay := post("/onboarding/targeted-continuation", map[string]string{"tokenDigest": originalDigest}, "", cookie)
	if replay["code"] != "TARGET_CONTINUATION_USED" {
		t.Fatal("targeted proof replay minted another token")
	}
	for _, sensitive := range []string{newEmail, wrongEmail, originalCapability, originalDigest, adminKey, anon, cookie.Value, continuation["tokenHash"].(string)} {
		if strings.Contains(providerLogs.String(), sensitive) {
			t.Fatal("provider diagnostics exposed sensitive input")
		}
	}
	assertNoVerificationEmail(t, client, newEmail)
	session := provider(http.MethodPost, "/verify", "", map[string]string{"type": continuation["type"].(string), "token_hash": continuation["tokenHash"].(string)})
	newAccess := session["access_token"].(string)
	newSubject := session["user"].(map[string]any)["id"].(string)
	// The browser's /auth/password step updates the verified session before
	// returning to the original invitation for explicit admission.
	provider(http.MethodPut, "/user", newAccess, map[string]string{"password": password})
	signedIn := provider(http.MethodPost, "/token?grant_type=password", "", map[string]string{"email": newEmail, "password": password})
	if signedIn["user"].(map[string]any)["id"] != newSubject {
		t.Fatal("password sign-in changed the verified identity")
	}
	newAccess = signedIn["access_token"].(string)
	repeatResponse, _ := post("/onboarding/provision", map[string]string{"email": newEmail, "tokenDigest": originalDigest}, "", cookie)
	if repeatResponse.Code != genericResponse.Code || repeatResponse.Body.String() != genericResponse.Body.String() {
		t.Fatal("repeated provisioning disclosed existing account")
	}
	assertAuthUsers(newEmail, 1)
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM app.memberships m JOIN app.users u ON u.id=m.user_id WHERE u.auth_subject=$1 AND m.group_id=$2`, newSubject, group).Scan(&count); err != nil || count != 0 {
		t.Fatal("provisioning or verification admitted without explicit acceptance")
	}
	entry := create(existingEmail)
	send(entry["actionID"])
	existingDigest := hex.EncodeToString(invitation.TokenHash(deliveryToken))
	existingCookie := start(deliveryToken)
	_, existingContinuation := post("/onboarding/targeted-continuation", map[string]string{"tokenDigest": existingDigest}, "", existingCookie)
	if existingContinuation["code"] != "READY" || existingContinuation["needsPassword"] != false || existingContinuation["type"] != "magiclink" {
		t.Fatal("existing targeted Auth continuation failed")
	}
	existingSession := provider(http.MethodPost, "/verify", "", map[string]string{"type": existingContinuation["type"].(string), "token_hash": existingContinuation["tokenHash"].(string)})
	if existingSession["user"].(map[string]any)["id"] != existing {
		t.Fatal("existing continuation changed identity")
	}
	existingAccess = existingSession["access_token"].(string)
	operation := uuid.NewString()
	// Tab A keeps its reviewed capability while tab B replaces the shared cookie.
	// Both first completion and original-key recovery must reject that mismatch.
	for _, payload := range []map[string]string{{"key": operation, "tokenDigest": originalDigest}, {"key": uuid.NewString(), "tokenDigest": originalDigest}, {"key": uuid.NewString()}} {
		response, result := post("/onboarding/accept", payload, newAccess, existingCookie)
		if response.Code != 409 || result["code"] != "ORIGINAL_LINK_REQUIRED" {
			t.Fatal("cross-tab first acceptance changed invitation")
		}
	}
	response, result := post("/onboarding/provision", map[string]string{"email": existingEmail, "tokenDigest": originalDigest}, "", existingCookie)
	if response.Code != 409 || result["code"] != "ORIGINAL_LINK_REQUIRED" {
		t.Fatal("cross-tab provisioning changed invitation")
	}

	_, accepted := post("/onboarding/accept", map[string]string{"key": operation, "tokenDigest": originalDigest}, newAccess, cookie)
	if accepted["code"] != "ADMITTED" || accepted["hasAccess"] != true || accepted["groupID"] != groupID {
		t.Fatal("verified new account not admitted")
	}
	_, repeated := post("/onboarding/accept", map[string]string{"key": operation, "tokenDigest": originalDigest}, newAccess, cookie)
	if repeated["hasAccess"] != true {
		t.Fatal("same-action recovery lost admission")
	}
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM app.memberships m JOIN app.users u ON u.id=m.user_id WHERE u.auth_subject=$1 AND m.group_id=$2`, newSubject, group).Scan(&count); err != nil || count != 1 {
		t.Fatal("repeated admission duplicated membership")
	}
	response, result = post("/onboarding/accept", map[string]string{"key": operation, "tokenDigest": originalDigest}, newAccess, existingCookie)
	if response.Code != 409 || result["code"] != "ORIGINAL_LINK_REQUIRED" {
		t.Fatal("cross-tab same-key retry changed invitation")
	}

	_, admitted := post("/onboarding/accept", map[string]string{"key": uuid.NewString(), "tokenDigest": existingDigest}, existingAccess, existingCookie)
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
	_, disabled := post("/onboarding/accept", map[string]string{"key": uuid.NewString(), "tokenDigest": existingDigest}, existingAccess, existingCookie)
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
	// A reusable shared link starts independent verification for multiple accounts.
	shared := gql(fmt.Sprintf(`mutation{createSharedInvitation(groupID:%q,key:%q)%s}`, groupID, uuid.NewString(), selection), ownerAccess, "createSharedInvitation")
	_, copied := post("/onboarding/copy-shared", map[string]string{"groupID": groupID, "invitationID": shared["invitationID"].(string)}, ownerAccess, nil)
	sharedToken := strings.Split(copied["link"].(string), "#")[1]
	sharedDigest := hex.EncodeToString(invitation.TokenHash(sharedToken))
	for index := 0; index < 2; index++ {
		sharedCookie := start(sharedToken)
		_, shortcut := post("/onboarding/targeted-continuation", map[string]string{"tokenDigest": sharedDigest}, "", sharedCookie)
		if shortcut["code"] != "UNAVAILABLE_LINK" {
			t.Fatal("shared link accepted as mailbox proof")
		}
		email := fmt.Sprintf("shared-http164-%d+%s@example.invalid", index, suffix)
		_, sent := post("/onboarding/provision", map[string]string{"email": email, "tokenDigest": sharedDigest}, "", sharedCookie)
		if sent["code"] != "CHECK_EMAIL" {
			t.Fatal("shared verification not started")
		}
		challenge, state := independentDeliveredChallenge(t, client, email)
		_, restored := post("/onboarding/callback-state", map[string]string{"state": state}, "", sharedCookie)
		if restored["code"] != "READY" || restored["tokenDigest"] != sharedDigest || restored["kind"] != "SHARED" {
			t.Fatal("shared callback did not recover original context")
		}
		verified := provider(http.MethodPost, "/verify", "", map[string]string{"type": "invite", "token_hash": challenge})
		sharedAccess := verified["access_token"].(string)
		subject := verified["user"].(map[string]any)["id"].(string)
		provider(http.MethodPut, "/user", sharedAccess, map[string]string{"password": password})
		if err := admin.QueryRow(ctx, `SELECT count(*) FROM app.users WHERE auth_subject=$1`, subject).Scan(&count); err != nil || count != 0 {
			t.Fatal("shared verification created application membership")
		}
		_, joined := post("/onboarding/accept", map[string]string{"key": uuid.NewString(), "tokenDigest": sharedDigest}, sharedAccess, sharedCookie)
		if joined["code"] != "ADMITTED" || joined["groupID"] != groupID {
			t.Fatal("verified shared account not admitted")
		}
	}

	// Auth uncertainty is durable across handler restart and a new browser context.
	for _, lostAfterCommit := range []bool{false, true} {
		failedEmail := fmt.Sprintf("failed-http164-%t+%s@example.invalid", lostAfterCommit, suffix)
		failed := create(failedEmail)
		send(failed["actionID"])
		failedToken := deliveryToken
		failedDigest := hex.EncodeToString(invitation.TokenHash(failedToken))
		failedCookie := start(failedToken)
		if lostAfterCommit {
			setHook(func(map[string]any) bool { return true })
		}
		hookMu.Lock()
		failBeforeGeneration = !lostAfterCommit
		hookMu.Unlock()
		_, failedResult := post("/onboarding/targeted-continuation", map[string]string{"tokenDigest": failedDigest}, "", failedCookie)
		if failedResult["code"] != "TARGET_CONTINUATION_USED" || failedResult["tokenHash"] != nil {
			t.Fatal("uncertain provider response released credentials")
		}
		setHook(nil)
		hookMu.Lock()
		failBeforeGeneration = false
		hookMu.Unlock()
		wantUsers := 0
		if lostAfterCommit {
			wantUsers = 1
		}
		assertAuthUsers(failedEmail, wantUsers)
		restarted, err := onboarding.NewHandler(factory, verifier, "http://127.0.0.1:3000", adminKey, slog.New(slog.NewJSONHandler(&providerLogs, nil)))
		if err != nil {
			t.Fatal(err)
		}
		app = serverForIndependent(factory, verifier)
		app.Use(restarted.Wrap)
		failedCookie = start(failedToken)
		_, afterRestart := post("/onboarding/targeted-continuation", map[string]string{"tokenDigest": failedDigest}, "", failedCookie)
		if afterRestart["code"] != "TARGET_CONTINUATION_USED" {
			t.Fatal("restart reset durable Auth claim")
		}
		revokedFailed := gql(fmt.Sprintf(`mutation{revokeInvitation(groupID:%q,id:%q,key:%q)%s}`, groupID, failed["invitationID"], uuid.NewString(), selection), ownerAccess, "revokeInvitation")
		if revokedFailed["outcome"] != "APPLIED" {
			t.Fatal("failed invitation replacement revoke failed")
		}
		replacement := create(failedEmail)
		send(replacement["actionID"])
		replacementDigest := hex.EncodeToString(invitation.TokenHash(deliveryToken))
		replacementCookie := start(deliveryToken)
		_, replacementResult := post("/onboarding/targeted-continuation", map[string]string{"tokenDigest": replacementDigest}, "", replacementCookie)
		if replacementResult["code"] != "READY" || replacementResult["needsPassword"] != true {
			t.Fatal("replacement failed interrupted first-time setup")
		}
		replacementSession := provider(http.MethodPost, "/verify", "", map[string]string{"type": replacementResult["type"].(string), "token_hash": replacementResult["tokenHash"].(string)})
		provider(http.MethodPut, "/user", replacementSession["access_token"].(string), map[string]string{"password": password})
		assertAuthUsers(failedEmail, 1)

	}

	// A revocation or disabled application identity during provider I/O must
	// suppress the generated OTP even though Auth has already created the user.
	for _, change := range []string{"revoke", "disable"} {
		email := change + "-http164+" + suffix + "@example.invalid"
		pending := create(email)
		send(pending["actionID"])
		digest := hex.EncodeToString(invitation.TokenHash(deliveryToken))
		pendingCookie := start(deliveryToken)
		invitationID, err := ledger.ParseID(pending["invitationID"].(string), "Invitation")
		if err != nil {
			t.Fatal(err)
		}
		setHook(func(result map[string]any) bool {
			var err error
			if change == "revoke" {
				_, err = admin.Exec(ctx, `UPDATE app.invitations SET revoked_at=clock_timestamp(),recipient=NULL,token_cipher=NULL,token_key=NULL WHERE id=$1`, invitationID)
			} else {
				_, err = admin.Exec(ctx, `INSERT INTO app.users(id,auth_subject,live_auth_id,display_name,enabled) VALUES($1,$1,$1,'Disabled fixture',false)`, result["id"])
			}
			if err != nil {
				t.Error("concurrent lifecycle fixture failed", err)
			}
			return false
		})
		_, blocked := post("/onboarding/targeted-continuation", map[string]string{"tokenDigest": digest}, "", pendingCookie)
		setHook(nil)
		want := "UNAVAILABLE_LINK"
		if change == "disable" {
			want = "ACCESS_DISABLED"
		}
		if blocked["code"] != want || blocked["tokenHash"] != nil {
			t.Fatal("lifecycle change released Auth continuation")
		}
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
					if u.Scheme != "http" || u.Host != "127.0.0.1:3000" || u.Path != "/auth/confirm" {
						t.Fatal("verification email did not target the configured confirmation page")
					}
					return fragment.Get("token_hash"), fragment.Get("state")
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("actual invitation verification email missing")
	return "", ""
}

func assertNoVerificationEmail(t *testing.T, client *http.Client, email string) {
	t.Helper()
	response, err := client.Get(os.Getenv("TEST_SMTP_URL") + "/api/v1/search?query=" + url.QueryEscape("to:"+email))
	if err != nil {
		t.Fatal("SMTP unavailable")
	}
	defer response.Body.Close()
	var box struct{ Messages []struct{ ID string } }
	if json.NewDecoder(response.Body).Decode(&box) != nil || len(box.Messages) != 0 {
		t.Fatal("targeted continuation sent an extra verification email")
	}
}
