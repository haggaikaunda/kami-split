//go:build integration

package invitation

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/profile"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type fixtureProvider struct{ emails map[string]string }

func (p *fixtureProvider) CurrentEmail(_ context.Context, subject string) (auth.ProviderEmail, error) {
	return auth.ProviderEmail{Subject: subject, Email: p.emails[subject], Verified: true}, nil
}

type fixture struct {
	t                    *testing.T
	db                   *database.DB
	admin                *pgx.Conn
	service              *Service
	group, owner, member uuid.UUID
	provider             *fixtureProvider
	verifier             *auth.Verifier
	signing              *ecdsa.PrivateKey
	retainData           bool
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
	if err != nil {
		t.Fatal(err)
	}
	db, err := database.Open(ctx, database.Config{URL: os.Getenv("TEST_DATABASE_URL"), MaxConns: 10, Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{t: t, admin: admin, db: db, group: uuid.New(), owner: uuid.New(), member: uuid.New(), provider: &fixtureProvider{emails: map[string]string{}}}
	f.provider.emails[f.owner.String()] = "owner@example.invalid"
	f.provider.emails[f.member.String()] = "member@example.invalid"
	f.exec(`INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4)`, f.owner, "owner@example.invalid", f.member, "member@example.invalid")
	tx, err := admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `SET LOCAL ROLE kami_migrator`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO app.users(id,auth_subject,live_auth_id,display_name) VALUES($1,$1,$1,'Owner')`, f.owner)
	if err != nil {
		t.Fatal(err)
	}
	ownerMembership := uuid.New()
	_, err = tx.Exec(ctx, `INSERT INTO app.groups(id,name,owner_membership_id) VALUES($1,'Synthetic group',$2)`, f.group, ownerMembership)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO app.memberships(id,group_id,user_id) VALUES($1,$2,$3)`, ownerMembership, f.group, f.owner)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	f.signing = key
	jwks, _ := json.Marshal(map[string]any{"keys": []any{map[string]string{"kty": "EC", "crv": "P-256", "kid": "test79", "alg": "ES256", "use": "sig", "x": base64.RawURLEncoding.EncodeToString(key.X.FillBytes(make([]byte, 32))), "y": base64.RawURLEncoding.EncodeToString(key.Y.FillBytes(make([]byte, 32)))}}})
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(jwks) }))
	t.Cleanup(remote.Close)
	f.verifier, err = auth.New(auth.Config{Issuer: "https://auth.example.invalid", Audience: "authenticated", JWKSURL: remote.URL})
	if err != nil {
		t.Fatal(err)
	}
	if err = f.verifier.Warm(ctx); err != nil {
		t.Fatal(err)
	}
	p, err := NewProtector("one", map[string][]byte{"one": make([]byte, 32)})
	if err != nil {
		t.Fatal(err)
	}
	f.service, err = New(db, p, f.provider)
	if err != nil {
		t.Fatal(err)
	}
	f.exec(`SET ROLE kami_migrator`)
	t.Cleanup(func() {
		cleanup := context.Background()
		defer db.Close()
		defer admin.Close(cleanup)
		// Financial-history fixtures stay intact for the disposable dump/replay check.
		if f.retainData {
			return
		}
		_, err := admin.Exec(cleanup, `BEGIN;SET LOCAL ROLE kami_migrator;
 DELETE FROM app.invitation_delivery WHERE action_id IN (SELECT id FROM app.invitation_actions WHERE group_id='`+f.group.String()+`');
 DELETE FROM app.invitation_actions WHERE group_id='`+f.group.String()+`';DELETE FROM app.invitations WHERE group_id='`+f.group.String()+`';
 DELETE FROM app.memberships WHERE group_id='`+f.group.String()+`';DELETE FROM app.groups WHERE id='`+f.group.String()+`';
 DELETE FROM app.users WHERE auth_subject IN ('`+f.owner.String()+`','`+f.member.String()+`');COMMIT;RESET ROLE;
 DELETE FROM auth.users WHERE id IN ('`+f.owner.String()+`','`+f.member.String()+`')`)
		if err != nil {
			t.Errorf("cleanup: %v", err)
		}
	})
	return f
}
func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.admin.Exec(context.Background(), sql, args...); err != nil {
		f.t.Fatal(err)
	}
}
func (f *fixture) actor(subject uuid.UUID) context.Context {
	f.t.Helper()
	now := time.Now()
	token := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{"sub": subject.String(), "iss": "https://auth.example.invalid", "aud": "authenticated", "exp": now.Add(time.Hour).Unix(), "iat": now.Unix(), "role": "authenticated"})
	token.Header["kid"] = "test79"
	raw, err := token.SignedString(f.signing)
	if err != nil {
		f.t.Fatal(err)
	}
	req := httptest.NewRequest("POST", "/", nil)
	req.Header.Set("Authorization", "Bearer "+raw)
	var ctx context.Context
	f.verifier.Authenticate(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { ctx = r.Context() })).ServeHTTP(httptest.NewRecorder(), req)
	return ctx
}
func (f *fixture) create(email string) (Result, string) {
	f.t.Helper()
	r, err := f.service.Create(f.actor(f.owner), f.group, email, uuid.New())
	if err != nil || r.Outcome != "SAVED" {
		f.t.Fatalf("create: %+v %v", r, err)
	}
	var cipher []byte
	var version string
	err = f.admin.QueryRow(context.Background(), `SELECT token_cipher,token_key FROM app.invitations WHERE id=$1`, r.InvitationID).Scan(&cipher, &version)
	if err != nil {
		f.t.Fatal(err)
	}
	token, err := f.service.protector.Decrypt(cipher, version, "TARGETED:"+r.InvitationID.String())
	if err != nil {
		f.t.Fatal(err)
	}
	return r, string(token)
}
func (f *fixture) allowResend() {
	f.exec(`UPDATE app.invitation_actions SET committed_at=committed_at-interval '2 minutes' WHERE group_id=$1`, f.group)
}
func requireOutcome(t *testing.T, r Result, err error, want string) {
	t.Helper()
	if err != nil || r.Outcome != want {
		t.Fatalf("want %s, got %+v err=%v", want, r, err)
	}
}

func TestTargetedLifecycle(t *testing.T) {
	f := newFixture(t)
	ctx := f.actor(f.owner)
	r, token := f.create(" Member@Example.Invalid ")
	preview, err := f.service.Preview(context.Background(), token)
	if err != nil || preview.GroupName != "Synthetic group" {
		t.Fatalf("preview %v %v", preview, err)
	}
	duplicate, err := f.service.Create(ctx, f.group, "member@example.invalid", uuid.New())
	requireOutcome(t, duplicate, err, "EXISTING")
	if duplicate.InvitationID != r.InvitationID || duplicate.Delivery != "NOT_REQUESTED" {
		t.Fatal("duplicate sent/changed identity")
	}
	f.exec(`UPDATE app.invitations SET expires_at=clock_timestamp() WHERE id=$1`, r.InvitationID)
	denied, err := f.service.Accept(f.actor(f.member), token, uuid.New())
	requireOutcome(t, denied, err, "UNAVAILABLE_LINK")
	var count int
	if err = f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.users WHERE auth_subject=$1`, f.member).Scan(&count); err != nil || count != 0 {
		t.Fatal("failed admission provisioned identity", err)
	}
	f.allowResend()
	resent, err := f.service.Resend(ctx, f.group, r.InvitationID, uuid.New())
	requireOutcome(t, resent, err, "APPLIED")
	accepted, err := f.service.Accept(f.actor(f.member), token, uuid.New())
	requireOutcome(t, accepted, err, "ADMITTED")
	if !accepted.HasAccess || accepted.MembershipID == uuid.Nil {
		t.Fatal("admission missing current membership")
	}
	var clean bool
	err = f.admin.QueryRow(context.Background(), `SELECT recipient IS NULL AND token_cipher IS NULL AND token_key IS NULL FROM app.invitations WHERE id=$1`, r.InvitationID).Scan(&clean)
	if err != nil || !clean {
		t.Fatal("terminal retained secret", err)
	}
	revoked, err := f.service.Revoke(ctx, f.group, r.InvitationID, uuid.New())
	requireOutcome(t, revoked, err, "ALREADY_ACCEPTED")
	// Save through the authenticated profile operation before leaving. Admission
	// later observes fresh provider email and proposes its email-derived initial
	// name, but must preserve this explicitly saved application name and identity.
	profiles := profile.New(f.db)
	originalProfile := profiles.Read(f.actor(f.member))
	if originalProfile.Code != "READY" {
		t.Fatal(originalProfile)
	}
	savedProfile := profiles.Update(f.actor(f.member), "Zoë 李 — saved profile", originalProfile.DisplayName)
	if savedProfile.Code != "READY" {
		t.Fatal(savedProfile)
	}
	f.exec(`UPDATE app.memberships SET active=false WHERE id=$1`, accepted.MembershipID)
	old, err := f.service.Accept(f.actor(f.member), token, uuid.New())
	requireOutcome(t, old, err, "HISTORICAL_ACCEPTANCE")
	if old.HasAccess {
		t.Fatal("old link restored access")
	}
	f.provider.emails[f.member.String()] = "fresh-provider-name@example.invalid"
	_, newToken := f.create("fresh-provider-name@example.invalid")
	readmit, err := f.service.Accept(f.actor(f.member), newToken, uuid.New())
	requireOutcome(t, readmit, err, "ADMITTED")
	if readmit.MembershipID != accepted.MembershipID {
		t.Fatal("changed permanent membership")
	}
	readmittedProfile := profiles.Read(f.actor(f.member))
	if readmittedProfile.Code != "READY" || readmittedProfile.ID != savedProfile.ID || readmittedProfile.DisplayName != savedProfile.DisplayName {
		t.Fatalf("later invitation admission reset saved application profile: before=%+v after=%+v", savedProfile, readmittedProfile)
	}
}

func TestActionsDeliveryAndRestrictedRole(t *testing.T) {
	f := newFixture(t)
	owner := f.actor(f.owner)
	key := uuid.New()
	r, err := f.service.Create(owner, f.group, "member@example.invalid", key)
	requireOutcome(t, r, err, "SAVED")
	replay, err := f.service.Create(owner, f.group, "member@example.invalid", key)
	requireOutcome(t, replay, err, "SAVED")
	if replay.ActionID != r.ActionID || !replay.ExpiresAt.Equal(r.ExpiresAt) {
		t.Fatal("action replay changed")
	}
	mismatch, err := f.service.Create(owner, f.group, "other@example.invalid", key)
	requireOutcome(t, mismatch, err, "KEY_REUSED")
	first, err := f.service.Claim(owner, r.ActionID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.service.Claim(owner, r.ActionID); err == nil {
		t.Fatal("concurrent lease claimed")
	}
	if ok, err := f.service.Complete(owner, first, "FAILED_DEFINITE"); err != nil || !ok {
		t.Fatal("failure completion", ok, err)
	}
	second, err := f.service.Claim(owner, r.ActionID)
	if err != nil {
		t.Fatal(err)
	}
	if first.ProviderKey() != second.ProviderKey() || string(first.Payload()) != string(second.Payload()) {
		t.Fatal("retry mutated provider payload/key")
	}
	if ok, err := f.service.Complete(owner, first, "PROVIDER_ACCEPTED"); err != nil || ok {
		t.Fatal("stale lease accepted", ok, err)
	}
	revoked, err := f.service.Revoke(owner, f.group, r.InvitationID, uuid.New())
	requireOutcome(t, revoked, err, "APPLIED")
	if ok, err := f.service.Complete(owner, second, "PROVIDER_ACCEPTED"); err != nil || ok {
		t.Fatal("late completion reversed terminal", ok, err)
	}
	for _, sql := range []string{`SELECT * FROM app.invitations`, `SELECT * FROM app.invitation_actions`, `SELECT * FROM app.invitation_delivery`, `UPDATE app.memberships SET active=true`, `SELECT * FROM auth.users`, `SELECT app.invitation_owner_lock('` + f.group.String() + `')`} {
		if _, err := database.IntegrationPool(f.db).Exec(context.Background(), sql); err == nil {
			t.Fatalf("runtime allowed %s", sql)
		}
	}
	for _, role := range []string{"anon", "authenticated", "service_role"} {
		tx, err := f.admin.Begin(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		_, err = tx.Exec(context.Background(), "SET LOCAL ROLE "+role)
		if err != nil {
			t.Fatal(err)
		}
		_, err = tx.Exec(context.Background(), `SELECT app.invitation_preview($1)`, make([]byte, 32))
		_ = tx.Rollback(context.Background())
		if err == nil {
			t.Fatalf("%s allowed capability operation", role)
		}
	}
	if _, err := f.service.List(f.actor(f.member), f.group, nil, 50); err == nil {
		t.Fatal("pending member can manage invitations")
	}
}

func TestConcurrentCreatesAndAcceptance(t *testing.T) {
	f := newFixture(t)
	var wg sync.WaitGroup
	results := make(chan Result, 6)
	failures := make(chan error, 6)
	for range 6 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, err := f.service.Create(f.actor(f.owner), f.group, "member@example.invalid", uuid.New())
			results <- r
			failures <- err
		}()
	}
	wg.Wait()
	close(results)
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	var invite uuid.UUID
	saved := 0
	for r := range results {
		if r.Outcome == "SAVED" {
			saved++
		}
		if invite != uuid.Nil && invite != r.InvitationID {
			t.Fatal("duplicate invitation")
		}
		invite = r.InvitationID
	}
	if saved != 1 {
		t.Fatalf("created %d", saved)
	}
	var cipher []byte
	var version string
	if err := f.admin.QueryRow(context.Background(), `SELECT token_cipher,token_key FROM app.invitations WHERE id=$1`, invite).Scan(&cipher, &version); err != nil {
		t.Fatal(err)
	}
	token, err := f.service.protector.Decrypt(cipher, version, "TARGETED:"+invite.String())
	if err != nil {
		t.Fatal(err)
	}
	key := uuid.New()
	results = make(chan Result, 2)
	failures = make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, err := f.service.Accept(f.actor(f.member), string(token), key)
			results <- r
			failures <- err
		}()
	}
	wg.Wait()
	close(results)
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	for r := range results {
		if r.Outcome != "ADMITTED" {
			t.Fatalf("retry %v", r)
		}
	}
}

func TestDeniedAcceptanceRollsBack(t *testing.T) {
	f := newFixture(t)
	_, token := f.create("someone-else@example.invalid")
	r, err := f.service.Accept(f.actor(f.member), token, uuid.New())
	requireOutcome(t, r, err, "WRONG_ACCOUNT")
	var n int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.users WHERE auth_subject=$1`, f.member).Scan(&n); err != nil || n != 0 {
		t.Fatal("wrong email left user", n, err)
	}
	if _, err := f.service.Accept(context.Background(), token, uuid.New()); err == nil {
		t.Fatal("unauthenticated accepted")
	}
}

func TestDeliveryDeadlinePurge(t *testing.T) {
	f := newFixture(t)
	r, _ := f.create("member@example.invalid")
	f.exec(`UPDATE app.invitation_delivery SET created_at=clock_timestamp()-interval '24 hours' WHERE action_id=$1`, r.ActionID)
	if _, err := f.service.Claim(f.actor(f.owner), r.ActionID); err == nil {
		t.Fatal("deadline claim")
	}
	if err := f.db.PurgeInvitationDelivery(context.Background()); err != nil {
		t.Fatal(err)
	}
	var clean bool
	if err := f.admin.QueryRow(context.Background(), `SELECT payload IS NULL AND payload_key IS NULL AND state='WINDOW_ENDED' FROM app.invitation_delivery WHERE action_id=$1`, r.ActionID).Scan(&clean); err != nil || !clean {
		t.Fatal("purge", clean, err)
	}
}

func TestProtectionFailuresAndRotation(t *testing.T) {
	f := newFixture(t)
	original, token := f.create("member@example.invalid")
	f.allowResend()
	keys := map[string][]byte{"one": make([]byte, 32), "two": make([]byte, 32)}
	keys["two"][0] = 2
	missing, err := NewProtector("two", map[string][]byte{"two": keys["two"]})
	if err != nil {
		t.Fatal(err)
	}
	f.service.protector = missing
	if _, err := f.service.Resend(f.actor(f.owner), f.group, original.InvitationID, uuid.New()); err == nil {
		t.Fatal("missing decrypt key regenerated token")
	}
	var expiry time.Time
	if err := f.admin.QueryRow(context.Background(), `SELECT expires_at FROM app.invitations WHERE id=$1`, original.InvitationID).Scan(&expiry); err != nil || !expiry.Equal(original.ExpiresAt) {
		t.Fatal("failed crypto changed expiry", err)
	}
	rotated, err := NewProtector("two", keys)
	if err != nil {
		t.Fatal(err)
	}
	f.service.protector = rotated
	resent, err := f.service.Resend(f.actor(f.owner), f.group, original.InvitationID, uuid.New())
	requireOutcome(t, resent, err, "APPLIED")
	dispatch, err := f.service.Claim(f.actor(f.owner), resent.ActionID)
	if err != nil {
		t.Fatal(err)
	}
	var m message
	if err := json.Unmarshal(dispatch.Payload(), &m); err != nil || m.Token != token {
		t.Fatal("rotation changed exact invitation token", err)
	}
}

func TestConcurrentActionAcrossProtectionVersions(t *testing.T) {
	f := newFixture(t)
	keys := map[string][]byte{"one": make([]byte, 32), "two": make([]byte, 32)}
	keys["two"][0] = 2
	old, err := NewProtector("one", keys)
	if err != nil {
		t.Fatal(err)
	}
	current, err := NewProtector("two", keys)
	if err != nil {
		t.Fatal(err)
	}
	services := []*Service{{f.db, old, f.provider}, {f.db, current, f.provider}}
	key := uuid.New()
	type answer struct {
		r   Result
		err error
	}
	done := make(chan answer, 2)
	for _, service := range services {
		go func(s *Service) {
			r, err := s.Create(f.actor(f.owner), f.group, "member@example.invalid", key)
			done <- answer{r, err}
		}(service)
	}
	first, second := <-done, <-done
	requireOutcome(t, first.r, first.err, "SAVED")
	requireOutcome(t, second.r, second.err, "SAVED")
	if first.r.ActionID != second.r.ActionID {
		t.Fatal("rotation race duplicated action")
	}
}

func TestAdmissionRecoveryAndDisabledAccount(t *testing.T) {
	f := newFixture(t)
	_, token := f.create("member@example.invalid")
	key := uuid.New()
	accepted, err := f.service.Accept(f.actor(f.member), token, key)
	requireOutcome(t, accepted, err, "ADMITTED")
	f.service.provider = nil
	recovered, err := f.service.Accept(f.actor(f.member), token, key)
	requireOutcome(t, recovered, err, "ADMITTED")
	if recovered.MembershipID != accepted.MembershipID {
		t.Fatal("receipt changed membership")
	}
	other, err := f.service.Recover(f.actor(f.owner), "ACCEPT", key)
	requireOutcome(t, other, err, "NOT_OBSERVED")
	f.exec(`UPDATE app.memberships SET active=false WHERE id=$1`, accepted.MembershipID)
	historical, err := f.service.Recover(f.actor(f.member), "ACCEPT", key)
	requireOutcome(t, historical, err, "ADMITTED")
	if historical.HasAccess {
		t.Fatal("inactive receipt grants access")
	}
	if err := f.db.WithIdentity(context.Background(), f.member.String(), func(tx pgx.Tx) error {
		var groupID pgtype.UUID
		_ = groupID.Scan(f.group.String())
		_, err := database.ReadGroup(context.Background(), tx, groupID)
		return err
	}); err == nil {
		t.Fatal("inactive member read group")
	}
	f.exec(`UPDATE app.users SET enabled=false WHERE auth_subject=$1`, f.member)
	if _, err := f.service.Recover(f.actor(f.member), "ACCEPT", key); !errors.Is(err, auth.Disabled) {
		t.Fatal("disabled receipt not denied", err)
	}
	_, fresh := f.create("member@example.invalid")
	f.service.provider = f.provider
	if _, err := f.service.Accept(f.actor(f.member), fresh, uuid.New()); !errors.Is(err, auth.Disabled) {
		t.Fatal("disabled actor readmitted", err)
	}
}
