//go:build integration

package graph_test

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/banking"
	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
	"github.com/haggaikaunda/kami-split/apps/api/internal/server"
	"github.com/jackc/pgx/v5"
)

type bankingHTTPTransport func(*http.Request) (*http.Response, error)

func (f bankingHTTPTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type bankingHTTPItem struct{ user, webhook string }

// Only the external provider is controlled. HTTP authentication, application
// operations, authorization, protected storage and transactions are the real code.
type bankingHTTPProvider struct {
	mu                      sync.Mutex
	adapter                 *banking.PlaidProvider
	links                   map[string]banking.EnrollmentPreparation
	items                   map[string]bankingHTTPItem
	preparations, exchanges int
	loseExchange            bool
}

func newBankingHTTPProvider(t *testing.T) *bankingHTTPProvider {
	t.Helper()
	p := &bankingHTTPProvider{links: map[string]banking.EnrollmentPreparation{}, items: map[string]bankingHTTPItem{}}
	adapter, err := banking.NewPlaidProvider(banking.PlaidConfig{Environment: "sandbox", ClientID: "client-http-fixture", Secret: "secret-http-fixture", UserScopedDiscovery: true, UserScopedRemoval: true}, &http.Client{Transport: bankingHTTPTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Scheme != "https" || r.URL.Host != "sandbox.plaid.com" || r.URL.Path != "/item/public_token/exchange" {
			t.Fatal("controlled provider reached unexpected destination")
		}
		var request struct {
			Public string `json:"public_token"`
		}
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			t.Fatal("invalid controlled exchange request")
		}
		p.mu.Lock()
		defer p.mu.Unlock()
		p.exchanges++
		input, ok := p.links[request.Public]
		if !ok {
			return &http.Response{StatusCode: 400, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"error_code":"INVALID_PUBLIC_TOKEN"}`))}, nil
		}
		item := "item-private-" + strings.TrimPrefix(request.Public, "public-private-")
		p.items[item] = bankingHTTPItem{input.UserID, input.WebhookURL}
		if p.loseExchange {
			return nil, fmt.Errorf("synthetic response loss containing %s", request.Public)
		}
		raw, _ := json.Marshal(map[string]string{"item_id": item, "access_token": "access-private-" + item})
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(bytes.NewReader(raw))}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	p.adapter = adapter
	return p
}

func (*bankingHTTPProvider) EnrollmentCapabilities() banking.EnrollmentCapabilities {
	return banking.EnrollmentCapabilities{UserScopedDiscovery: true, UserScopedRemoval: true}
}
func (*bankingHTTPProvider) EnsureUser(_ context.Context, _, client string) (string, error) {
	return "usr_" + client, nil
}
func (p *bankingHTTPProvider) Prepare(_ context.Context, input banking.EnrollmentPreparation) (banking.LinkPreparation, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	id := input.WebhookURL[strings.LastIndex(input.WebhookURL, "/")+1:]
	p.links["public-private-"+id] = input
	p.preparations++
	return banking.LinkPreparation{UserID: input.UserID, LinkToken: "link-private-" + id, ExpiresAt: time.Now().Add(time.Hour)}, nil
}
func (p *bankingHTTPProvider) Exchange(ctx context.Context, environment string, token banking.PublicToken) (banking.ExchangeResult, error) {
	return p.adapter.Exchange(ctx, environment, token)
}
func (*bankingHTTPProvider) Accounts(_ context.Context, _ string, token banking.Credential) (banking.AccountInventory, error) {
	return banking.AccountInventory{ItemID: strings.TrimPrefix(string(token.Bytes()), "access-private-"), InstitutionID: "institution-private", CountryCode: "US", Accounts: []banking.ProviderAccount{
		{ID: "selected-checking", Name: "Selected checking", Type: "depository", Subtype: "checking", Currency: "USD", StableID: "stable-private-checking"},
		{ID: "unselected-savings", Name: "Unselected bank metadata", Type: "depository", Subtype: "savings", Currency: "USD", StableID: "stable-private-savings"},
		{ID: "unsupported-loan", Name: "Unsupported bank metadata", Type: "loan", Subtype: "mortgage", Currency: "USD"},
		{ID: "foreign-checking", Name: "Unsupported bank metadata", Type: "depository", Subtype: "checking", Currency: "EUR"},
	}}, nil
}
func (p *bankingHTTPProvider) Discover(_ context.Context, _ string, correlation banking.EnrollmentCorrelation) ([]string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	items := []string{}
	for id, item := range p.items {
		if item.user == correlation.UserID && item.webhook == correlation.WebhookURL {
			items = append(items, id)
		}
	}
	return items, nil
}
func (p *bankingHTTPProvider) RemoveDiscovered(_ context.Context, _ string, correlation banking.EnrollmentCorrelation, id string) (banking.RemovalResult, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	item, ok := p.items[id]
	if !ok || item.user != correlation.UserID || item.webhook != correlation.WebhookURL {
		return banking.RemovalResult{}, &banking.RemovalError{}
	}
	delete(p.items, id)
	return banking.RemovalResult{Confirmed: true}, nil
}
func (p *bankingHTTPProvider) counts() (int, int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.preparations, p.exchanges
}

type bankingHTTPFixture struct {
	t                      *testing.T
	admin                  *pgx.Conn
	db                     *database.DB
	storage                *banking.Service
	provider               *bankingHTTPProvider
	verifier               *auth.Verifier
	key                    *ecdsa.PrivateKey
	owner, other, disabled uuid.UUID
	logs                   bytes.Buffer
}

func newBankingHTTPFixture(t *testing.T) *bankingHTTPFixture {
	t.Helper()
	ctx := context.Background()
	if os.Getenv("TEST_DATABASE_URL") == "" || os.Getenv("TEST_DATABASE_ADMIN_URL") == "" {
		t.Fatal("disposable restricted database fixture required")
	}
	admin, err := pgx.Connect(ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
	if err != nil {
		t.Fatal("database admin fixture unavailable")
	}
	db, err := database.Open(ctx, database.Config{URL: os.Getenv("TEST_DATABASE_URL"), MaxConns: 5, Timeout: 2 * time.Second})
	if err != nil {
		_ = admin.Close(ctx)
		t.Fatal("restricted API database unavailable")
	}
	f := &bankingHTTPFixture{t: t, admin: admin, db: db, provider: newBankingHTTPProvider(t), owner: uuid.New(), other: uuid.New(), disabled: uuid.New()}
	t.Cleanup(func() {
		db.Close()
		if err := admin.Close(context.Background()); err != nil {
			t.Error("fixture close failed")
		}
	})
	f.exec(`INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4),($5,$6)`, f.owner, f.owner.String()+"@bank-http.example.invalid", f.other, f.other.String()+"@bank-http.example.invalid", f.disabled, f.disabled.String()+"@bank-http.example.invalid")
	f.exec(`SET ROLE kami_migrator`)
	f.exec(`INSERT INTO app.users(id,auth_subject,live_auth_id,display_name,enabled) VALUES($1,$1,$1,'HTTP bank owner',true),($2,$2,$2,'HTTP other owner',true),($3,$3,$3,'HTTP disabled owner',false)`, f.owner, f.other, f.disabled)
	// Same-group membership deliberately grants no access to private banking.
	tx, err := admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	groupID, membershipID := uuid.New(), uuid.New()
	if _, err := tx.Exec(ctx, `INSERT INTO app.groups(id,name,owner_membership_id) VALUES($1,'HTTP banking isolation',$2)`, groupID, membershipID); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO app.memberships(id,group_id,user_id) VALUES($1,$2,$3),($4,$2,$5)`, membershipID, groupID, f.owner, uuid.New(), f.other); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	if tx.Commit(ctx) != nil {
		t.Fatal("group fixture commit failed")
	}
	f.key, err = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	jwks, _ := json.Marshal(map[string]any{"keys": []any{map[string]string{"kty": "EC", "crv": "P-256", "kid": "bank-http", "alg": "ES256", "use": "sig", "x": base64.RawURLEncoding.EncodeToString(f.key.X.FillBytes(make([]byte, 32))), "y": base64.RawURLEncoding.EncodeToString(f.key.Y.FillBytes(make([]byte, 32)))}}})
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(jwks) }))
	t.Cleanup(remote.Close)
	f.verifier, err = auth.New(auth.Config{Issuer: "https://bank-http-auth.example.invalid", Audience: "authenticated", JWKSURL: remote.URL})
	if err != nil || f.verifier.Warm(ctx) != nil {
		t.Fatal("local signed authentication fixture unavailable")
	}
	protector, err := banking.NewProtector("http", map[string][]byte{"http": bytes.Repeat([]byte{87}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	f.storage, err = banking.New(db, protector)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		// Scheduler-visible fixtures must not affect the lifecycle package's
		// later shared-cluster assertions. Delete only these synthetic owners'
		// banking rows; retain their ordinary identity/group backup fixtures.
		for _, query := range []string{
			`DELETE FROM app.banking_enrollment_jobs WHERE attempt_id IN(SELECT id FROM app.banking_enrollments WHERE owner_id IN($1,$2,$3))`,
			`DELETE FROM app.banking_enrollment_receipts WHERE attempt_id IN(SELECT id FROM app.banking_enrollments WHERE owner_id IN($1,$2,$3))`,
			`DELETE FROM app.banking_webhook_receipts WHERE correlation_id IN(SELECT id FROM app.banking_enrollments WHERE owner_id IN($1,$2,$3))`,
			`DELETE FROM app.banking_webhook_correlations WHERE connection_id IN(SELECT id FROM app.banking_connections WHERE owner_id IN($1,$2,$3))`,
			`DELETE FROM app.banking_enrollment_accounts WHERE owner_id IN($1,$2,$3)`,
			`DELETE FROM app.banking_reconciliation WHERE binding_id IN(SELECT id FROM app.banking_bindings WHERE owner_id IN($1,$2,$3))`,
			`DELETE FROM app.banking_bindings WHERE owner_id IN($1,$2,$3)`,
			`DELETE FROM app.banking_accounts WHERE owner_id IN($1,$2,$3)`,
			`DELETE FROM app.banking_enrollments WHERE owner_id IN($1,$2,$3)`,
			`DELETE FROM app.banking_work WHERE connection_id IN(SELECT id FROM app.banking_connections WHERE owner_id IN($1,$2,$3))`,
			`DELETE FROM app.banking_credentials WHERE owner_id IN($1,$2,$3)`,
			`DELETE FROM app.banking_connections WHERE owner_id IN($1,$2,$3)`,
		} {
			if _, err := admin.Exec(context.Background(), query, f.owner, f.other, f.disabled); err != nil {
				t.Error("owned banking fixture cleanup failed", err)
			}
		}
	})
	return f
}
func (f *bankingHTTPFixture) exec(query string, args ...any) {
	f.t.Helper()
	if _, err := f.admin.Exec(context.Background(), query, args...); err != nil {
		f.t.Fatal(err)
	}
}
func (f *bankingHTTPFixture) token(subject uuid.UUID) string {
	f.t.Helper()
	now := time.Now()
	token := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{"sub": subject.String(), "iss": "https://bank-http-auth.example.invalid", "aud": "authenticated", "exp": now.Add(time.Hour).Unix(), "iat": now.Unix(), "role": "authenticated"})
	token.Header["kid"] = "bank-http"
	raw, err := token.SignedString(f.key)
	if err != nil {
		f.t.Fatal(err)
	}
	return raw
}
func (f *bankingHTTPFixture) handler(enabled bool) http.Handler {
	f.t.Helper()
	enrollment, err := banking.NewEnrollment(f.storage, f.provider, banking.EnrollmentConfig{Enabled: enabled, Environment: "sandbox", WebhookOrigin: "https://bank-http.example.invalid"})
	if err != nil {
		f.t.Fatal(err)
	}
	return server.NewWithAuthentication(config.Config{}, graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{Banking: enrollment, BankingStorage: f.storage}}), slog.New(slog.NewJSONHandler(&f.logs, nil)), f.verifier).Handler()
}
func (f *bankingHTTPFixture) post(handler http.Handler, query, token string, allowLink bool) map[string]any {
	f.t.Helper()
	raw, _ := json.Marshal(map[string]string{"query": query})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	r := httptest.NewRequest(http.MethodPost, "/graphql", bytes.NewReader(raw)).WithContext(ctx)
	r.Header.Set("Content-Type", "application/json")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	var envelope map[string]any
	if json.Unmarshal(w.Body.Bytes(), &envelope) != nil {
		f.t.Fatal("invalid GraphQL HTTP response")
	}
	for _, secret := range []string{"access-private-", "public-private-", "item-private-", "stable-private-", "institution-private", "Unselected bank metadata", "Unsupported bank metadata"} {
		if strings.Contains(w.Body.String(), secret) || strings.Contains(f.logs.String(), secret) {
			f.t.Fatal("GraphQL result/error/log disclosed provider data")
		}
	}
	if !allowLink && strings.Contains(w.Body.String(), "link-private-") {
		f.t.Fatal("temporary Link token escaped start handoff")
	}
	if strings.Contains(f.logs.String(), "link-private-") || (token != "" && strings.Contains(f.logs.String(), token)) {
		f.t.Fatal("server diagnostics disclosed token")
	}
	return envelope
}
func (f *bankingHTTPFixture) operation(handler http.Handler, query, token, field string, allowLink bool) map[string]any {
	f.t.Helper()
	envelope := f.post(handler, query, token, allowLink)
	if envelope["errors"] != nil {
		f.t.Fatal("GraphQL operation failed before safe domain response")
	}
	data, ok := envelope["data"].(map[string]any)
	if !ok {
		f.t.Fatal("GraphQL omitted data")
	}
	result, ok := data[field].(map[string]any)
	if !ok {
		f.t.Fatal("GraphQL omitted operation result")
	}
	return result
}

const bankingHTTPSelection = `{code state attemptId connectionId linkToken expiresAt}`
const bankingHTTPConnectionSelection = `{code connection{id state accounts{id streamId name kind currency requestedHistoryDays}}}`

func bankingHTTPStart(id uuid.UUID, intent string) string {
	return fmt.Sprintf(`mutation{startBankingEnrollment(input:{attemptId:%q,intent:%s})%s}`, id.String(), intent, bankingHTTPSelection)
}
func bankingHTTPFinish(id uuid.UUID, selected string) string {
	return fmt.Sprintf(`mutation{finishBankingEnrollment(input:{attemptId:%q,publicToken:%q,accountIds:[%q]})%s}`, id.String(), "public-private-"+id.String(), selected, bankingHTTPSelection)
}
func bankingHTTPStatus(id uuid.UUID) string {
	return fmt.Sprintf(`query{bankingEnrollment(attemptId:%q)%s}`, id.String(), bankingHTTPSelection)
}
func bankingHTTPCancel(id uuid.UUID) string {
	return fmt.Sprintf(`mutation{cancelBankingEnrollment(attemptId:%q)%s}`, id.String(), bankingHTTPSelection)
}
func bankingHTTPConnection(id string) string {
	return fmt.Sprintf(`query{bankingConnection(connectionId:%q)%s}`, id, bankingHTTPConnectionSelection)
}

func TestBankingHTTPAwaitingImportOwnershipAndSecrecy(t *testing.T) {
	f := newBankingHTTPFixture(t)
	handler := f.handler(true)
	owner, other, disabled := f.token(f.owner), f.token(f.other), f.token(f.disabled)
	id := uuid.New()
	operations := []struct{ query, field string }{
		{bankingHTTPStart(id, "DIFFERENT"), "startBankingEnrollment"}, {bankingHTTPFinish(id, "selected-checking"), "finishBankingEnrollment"}, {bankingHTTPStatus(id), "bankingEnrollment"}, {bankingHTTPCancel(id), "cancelBankingEnrollment"}, {bankingHTTPConnection(uuid.NewString()), "bankingConnection"},
	}
	for _, operation := range operations {
		envelope := f.post(handler, operation.query, "", false)
		errors, ok := envelope["errors"].([]any)
		if !ok || len(errors) != 1 {
			t.Fatal("unauthenticated banking operation not rejected")
		}
		failure := errors[0].(map[string]any)
		if failure["extensions"].(map[string]any)["code"] != "UNAUTHENTICATED" {
			t.Fatal("unauthenticated operation exposed domain state")
		}
		if got := f.operation(handler, operation.query, disabled, operation.field, false); got["code"] != "FORBIDDEN" {
			t.Fatal("disabled identity reached banking operation")
		}
	}
	if preparations, exchanges := f.provider.counts(); preparations != 0 || exchanges != 0 {
		t.Fatal("denied request reached external provider")
	}
	start := f.operation(handler, bankingHTTPStart(id, "DIFFERENT"), owner, "startBankingEnrollment", true)
	if start["code"] != "PREPARED" || start["state"] != "prepared" || start["attemptId"] != id.String() || start["linkToken"] != "link-private-"+id.String() {
		t.Fatal("owner start did not return exact expiring Link handoff")
	}
	if _, err := time.Parse(time.RFC3339, start["expiresAt"].(string)); err != nil {
		t.Fatal("handoff expiry omitted")
	}
	replay := f.operation(handler, bankingHTTPStart(id, "DIFFERENT"), owner, "startBankingEnrollment", true)
	if !reflect.DeepEqual(start, replay) {
		t.Fatal("same canonical start failed to recover original handoff")
	}
	if changed := f.operation(handler, bankingHTTPStart(id, "EXISTING"), owner, "startBankingEnrollment", false); changed["code"] != "CONFLICT" {
		t.Fatal("changed-input attempt reuse did not conflict")
	}
	status := f.operation(handler, bankingHTTPStatus(id), owner, "bankingEnrollment", false)
	if status["code"] != "PREPARED" || status["linkToken"] != nil {
		t.Fatal("status lost preparation or exposed handoff")
	}
	for _, operation := range operations[:4] {
		got := f.operation(handler, operation.query, other, operation.field, false)
		if got["code"] != "NOT_FOUND" || got["attemptId"] != nil || got["connectionId"] != nil || got["linkToken"] != nil {
			t.Fatal("same-group other owner accessed attempt")
		}
	}
	finished := f.operation(handler, bankingHTTPFinish(id, "selected-checking"), owner, "finishBankingEnrollment", false)
	if finished["code"] != "AWAITING_INITIAL_IMPORT" || finished["state"] != "ready" || finished["connectionId"] == nil || finished["linkToken"] != nil {
		t.Fatal("finish did not persist honest awaiting-import outcome")
	}
	connectionID := finished["connectionId"].(string)
	if repeated := f.operation(handler, bankingHTTPFinish(id, "selected-checking"), owner, "finishBankingEnrollment", false); !reflect.DeepEqual(finished, repeated) {
		t.Fatal("finish replay did not recover original result")
	}
	if changed := f.operation(handler, bankingHTTPFinish(id, "unselected-savings"), owner, "finishBankingEnrollment", false); changed["code"] != "CONFLICT" {
		t.Fatal("changed selection overwrote the original completion")
	}
	if preparations, exchanges := f.provider.counts(); preparations != 1 || exchanges != 1 {
		t.Fatal("replays or cross-owner requests repeated provider effect")
	}
	connection := f.operation(handler, bankingHTTPConnection(connectionID), owner, "bankingConnection", false)
	if connection["code"] != "READY" {
		t.Fatal("owner could not read persisted connection")
	}
	projection := connection["connection"].(map[string]any)
	accounts := projection["accounts"].([]any)
	if len(accounts) != 1 || projection["state"] != "active" {
		t.Fatal("unselected accounts were exposed or selected connection not active")
	}
	account := accounts[0].(map[string]any)
	if account["name"] != "Selected checking" || account["kind"] != "checking" || account["currency"] != "USD" || account["requestedHistoryDays"] != float64(365) || account["id"] == nil || account["streamId"] == nil {
		t.Fatal("selected stream identity and requested history were not persisted")
	}
	foreign := f.operation(handler, bankingHTTPConnection(connectionID), other, "bankingConnection", false)
	absent := f.operation(handler, bankingHTTPConnection(uuid.NewString()), other, "bankingConnection", false)
	if foreign["code"] != "NOT_FOUND" || !reflect.DeepEqual(foreign, absent) {
		t.Fatal("connection lookup disclosed other-owner existence")
	}
	// The previously valid bearer cannot bypass current database enablement.
	f.exec(`UPDATE app.users SET enabled=false WHERE id=$1`, f.owner)
	for _, operation := range []struct{ query, field string }{{bankingHTTPStatus(id), "bankingEnrollment"}, {bankingHTTPConnection(connectionID), "bankingConnection"}, {bankingHTTPFinish(id, "selected-checking"), "finishBankingEnrollment"}, {bankingHTTPCancel(id), "cancelBankingEnrollment"}, {bankingHTTPStart(uuid.New(), "DIFFERENT"), "startBankingEnrollment"}} {
		if got := f.operation(handler, operation.query, owner, operation.field, false); got["code"] != "FORBIDDEN" {
			t.Fatal("old bearer bypassed disabled application identity")
		}
	}
}

func TestBankingHTTPCancellationUnknownAndDisabledGate(t *testing.T) {
	f := newBankingHTTPFixture(t)
	owner, other := f.token(f.owner), f.token(f.other)
	disabledHandler := f.handler(false)
	id := uuid.New()
	if result := f.operation(disabledHandler, bankingHTTPStart(id, "DIFFERENT"), owner, "startBankingEnrollment", false); result["code"] != "FEATURE_DISABLED" {
		t.Fatal("new enrollment default-disabled gate failed")
	}
	if preparations, exchanges := f.provider.counts(); preparations != 0 || exchanges != 0 {
		t.Fatal("disabled feature caused external enrollment")
	}
	var count int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_enrollments WHERE id=$1`, id).Scan(&count); err != nil || count != 0 {
		t.Fatal("disabled enrollment left persisted attempt")
	}
	handler := f.handler(true)
	if result := f.operation(handler, bankingHTTPStart(id, "DIFFERENT"), owner, "startBankingEnrollment", true); result["code"] != "PREPARED" {
		t.Fatal("enabled start failed")
	}
	if result := f.operation(handler, bankingHTTPCancel(id), owner, "cancelBankingEnrollment", false); result["code"] != "CLEANUP_PENDING" || result["state"] != "cleanup_pending" {
		t.Fatal("cancel fabricated provider removal")
	}
	if result := f.operation(handler, bankingHTTPFinish(id, "selected-checking"), owner, "finishBankingEnrollment", false); result["code"] != "CLEANUP_PENDING" || result["connectionId"] != nil {
		t.Fatal("late completion after cancellation activated connection")
	}
	if preparations, exchanges := f.provider.counts(); preparations != 1 || exchanges != 0 {
		t.Fatal("cancelled late token was exchanged")
	}
	if result := f.operation(handler, bankingHTTPStart(uuid.New(), "DIFFERENT"), owner, "startBankingEnrollment", false); result["code"] != "ATTEMPT_IN_PROGRESS" {
		t.Fatal("cancelled unresolved effect allowed blind second enrollment")
	}
	unknownID := uuid.New()
	if result := f.operation(handler, bankingHTTPStart(unknownID, "DIFFERENT"), other, "startBankingEnrollment", true); result["code"] != "PREPARED" {
		t.Fatal("other independent owner start failed")
	}
	f.provider.mu.Lock()
	f.provider.loseExchange = true
	f.provider.mu.Unlock()
	unknown := f.operation(handler, bankingHTTPFinish(unknownID, "selected-checking"), other, "finishBankingEnrollment", false)
	if unknown["code"] != "EXCHANGE_UNKNOWN" || unknown["state"] != "exchange_unknown" || unknown["connectionId"] != nil {
		t.Fatal("lost exchange response fabricated failure, success or active connection")
	}
	if status := f.operation(handler, bankingHTTPStatus(unknownID), other, "bankingEnrollment", false); !reflect.DeepEqual(unknown, status) {
		t.Fatal("uncertain exchange lost durable status")
	}
	if retry := f.operation(handler, bankingHTTPFinish(unknownID, "selected-checking"), other, "finishBankingEnrollment", false); !reflect.DeepEqual(unknown, retry) {
		t.Fatal("uncertain completion replay changed durable outcome")
	}
	if preparations, exchanges := f.provider.counts(); preparations != 2 || exchanges != 1 {
		t.Fatal("unknown exchange replay consumed token again")
	}
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_connections WHERE owner_id=$1`, f.other).Scan(&count); err != nil || count != 0 {
		t.Fatal("unknown exchange created a persisted connection")
	}
}

func TestBankingHTTPUnsupportedSelectionDoesNotActivate(t *testing.T) {
	for _, selected := range []string{"unsupported-loan", "foreign-checking"} {
		t.Run(selected, func(t *testing.T) {
			f := newBankingHTTPFixture(t)
			handler, owner, id := f.handler(true), f.token(f.owner), uuid.New()
			if started := f.operation(handler, bankingHTTPStart(id, "DIFFERENT"), owner, "startBankingEnrollment", true); started["code"] != "PREPARED" {
				t.Fatal("selection fixture start failed")
			}
			result := f.operation(handler, bankingHTTPFinish(id, selected), owner, "finishBankingEnrollment", false)
			if result["code"] != "INVALID_SELECTION" || result["state"] != "cleanup_pending" || result["connectionId"] == nil {
				t.Fatal("unsupported provider account did not enter durable cleanup")
			}
			connection := f.operation(handler, bankingHTTPConnection(result["connectionId"].(string)), owner, "bankingConnection", false)
			if connection["code"] != "READY" {
				t.Fatal("owner lost non-active cleanup status")
			}
			projection := connection["connection"].(map[string]any)
			if projection["state"] != "stopped" || len(projection["accounts"].([]any)) != 0 {
				t.Fatal("unsupported selection activated or retained account metadata")
			}
			var active int
			if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_connections WHERE owner_id=$1 AND state='active'`, f.owner).Scan(&active); err != nil || active != 0 {
				t.Fatal("unsupported selection persisted an active connection")
			}
		})
	}
}
