//go:build integration

package banking

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
)

type enrollmentItem struct {
	user, webhook string
	removed       bool
}
type controlledEnrollmentProvider struct {
	capabilities                                          *EnrollmentCapabilities
	mu                                                    sync.Mutex
	links                                                 map[string]EnrollmentPreparation
	items                                                 map[string]enrollmentItem
	exchanges                                             int
	loseExchange, hideDiscovery, failRemoval, failPrepare bool
	inventory                                             AccountInventory
	beforeExchange                                        func()
	beforeAccounts                                        func()
}

func newControlledProvider() *controlledEnrollmentProvider {
	return &controlledEnrollmentProvider{links: map[string]EnrollmentPreparation{}, items: map[string]enrollmentItem{}, inventory: AccountInventory{InstitutionID: "bank-us", CountryCode: "US", Accounts: []ProviderAccount{
		{ID: "checking", Name: "Checking", Type: "depository", Subtype: "checking", Currency: "USD", StableID: "stable-checking"},
		{ID: "savings", Name: "Savings", Type: "depository", Subtype: "savings", Currency: "USD", StableID: "stable-savings"},
		{ID: "card", Name: "Credit", Type: "credit", Subtype: "credit card", Currency: "USD", StableID: "stable-card"},
		{ID: "unselected", Name: "Unselected", Type: "depository", Subtype: "checking", Currency: "USD", StableID: "stable-unselected"},
		{ID: "unsupported", Type: "loan", Subtype: "mortgage", Currency: "USD"},
		{ID: "foreign", Type: "depository", Subtype: "checking", Currency: "CAD"},
	}}}
}
func (p *controlledEnrollmentProvider) EnrollmentCapabilities() EnrollmentCapabilities {
	if p.capabilities != nil {
		return *p.capabilities
	}
	return EnrollmentCapabilities{true, true}
}
func (*controlledEnrollmentProvider) EnsureUser(_ context.Context, _, client string) (string, error) {
	return "usr-" + client, nil
}
func (p *controlledEnrollmentProvider) Prepare(_ context.Context, input EnrollmentPreparation) (LinkPreparation, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	id := input.WebhookURL[strings.LastIndex(input.WebhookURL, "/")+1:]
	p.links["public-"+id] = input
	if p.failPrepare {
		return LinkPreparation{}, &EnrollmentError{Uncertain: true, Retryable: true}
	}
	return LinkPreparation{UserID: input.UserID, LinkToken: "link-" + id, ExpiresAt: time.Now().Add(time.Hour)}, nil
}
func (p *controlledEnrollmentProvider) Exchange(ctx context.Context, _ string, token PublicToken) (ExchangeResult, error) {
	if p.beforeExchange != nil {
		p.beforeExchange()
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.exchanges++
	input, ok := p.links[string(token.Bytes())]
	if !ok {
		return ExchangeResult{}, &EnrollmentError{}
	}
	item := "item-" + string(token.Bytes())
	p.items[item] = enrollmentItem{user: input.UserID, webhook: input.WebhookURL}
	if p.loseExchange {
		return ExchangeResult{}, &EnrollmentError{Uncertain: true, Retryable: true}
	}
	return ExchangeResult{ItemID: item, AccessToken: Credential{raw: []byte("access-" + item)}}, nil
}
func (p *controlledEnrollmentProvider) Accounts(_ context.Context, _ string, c Credential) (AccountInventory, error) {
	if p.beforeAccounts != nil {
		p.beforeAccounts()
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	inventory := p.inventory
	inventory.Accounts = append([]ProviderAccount(nil), inventory.Accounts...)
	inventory.ItemID = strings.TrimPrefix(string(c.Bytes()), "access-")
	return inventory, nil
}
func (p *controlledEnrollmentProvider) Discover(_ context.Context, _ string, c EnrollmentCorrelation) ([]string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	items := []string{}
	if p.hideDiscovery {
		return items, nil
	}
	for id, item := range p.items {
		if item.user == c.UserID && item.webhook == c.WebhookURL && !item.removed {
			items = append(items, id)
		}
	}
	return items, nil
}
func (p *controlledEnrollmentProvider) RemoveDiscovered(_ context.Context, _ string, c EnrollmentCorrelation, id string) (RemovalResult, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	item, ok := p.items[id]
	if !ok || item.user != c.UserID || item.webhook != c.WebhookURL {
		return RemovalResult{}, &RemovalError{}
	}
	if p.failRemoval {
		return RemovalResult{RetryAfter: 3 * time.Minute}, &RemovalError{Retryable: true, Uncertain: true}
	}
	item.removed = true
	p.items[id] = item
	return RemovalResult{Confirmed: true}, nil
}
func (p *controlledEnrollmentProvider) Remove(_ context.Context, _ string, c Credential) (RemovalResult, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	id := strings.TrimPrefix(string(c.Bytes()), "access-")
	item := p.items[id]
	if p.failRemoval {
		return RemovalResult{}, &RemovalError{Retryable: true, Uncertain: true}
	}
	item.removed = true
	p.items[id] = item
	return RemovalResult{Confirmed: true}, nil
}
func (p *controlledEnrollmentProvider) Observe(_ context.Context, _ string, c Credential) (Observation, error) {
	return Observation{ItemID: strings.TrimPrefix(string(c.Bytes()), "access-"), Healthy: true}, nil
}

func enrollmentFixture(t *testing.T) (*fixture, *EnrollmentService, *controlledEnrollmentProvider, *Worker, *database.WorkerDB) {
	t.Helper()
	f := newFixture(t)
	f.exec(`DELETE FROM app.banking_work`)
	f.exec(`SELECT pgmq.purge_queue('banking_lifecycle')`)
	p := newControlledProvider()
	s, err := NewEnrollment(f.service, p, EnrollmentConfig{Enabled: true, Environment: "sandbox", WebhookOrigin: "https://api.example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	db, err := database.OpenWorker(context.Background(), database.Config{URL: os.Getenv("TEST_WORKER_DATABASE_URL"), MaxConns: 3, Timeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	w, err := NewWorker(db, f.service.protector, p)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		// These tests own only synthetic enrollment rows in this disposable database.
		// Remove their scheduler-visible fixtures before independent lifecycle tests.
		f.exec(`DELETE FROM app.banking_enrollment_jobs WHERE attempt_id IN(SELECT id FROM app.banking_enrollments WHERE owner_id IN($1,$2))`, f.owner, f.other)
		f.exec(`DELETE FROM app.banking_enrollment_receipts WHERE attempt_id IN(SELECT id FROM app.banking_enrollments WHERE owner_id IN($1,$2))`, f.owner, f.other)
		f.exec(`DELETE FROM app.banking_webhook_receipts WHERE correlation_id IN(SELECT id FROM app.banking_enrollments WHERE owner_id IN($1,$2))`, f.owner, f.other)
		f.exec(`DELETE FROM app.banking_webhook_correlations WHERE connection_id IN(SELECT id FROM app.banking_connections WHERE owner_id IN($1,$2))`, f.owner, f.other)
		f.exec(`DELETE FROM app.banking_enrollment_accounts WHERE owner_id IN($1,$2)`, f.owner, f.other)
		f.exec(`DELETE FROM app.banking_reconciliation WHERE binding_id IN(SELECT id FROM app.banking_bindings WHERE owner_id IN($1,$2))`, f.owner, f.other)
		f.exec(`DELETE FROM app.banking_bindings WHERE owner_id IN($1,$2)`, f.owner, f.other)
		f.exec(`DELETE FROM app.banking_accounts WHERE owner_id IN($1,$2)`, f.owner, f.other)
		f.exec(`DELETE FROM app.banking_enrollments WHERE owner_id IN($1,$2)`, f.owner, f.other)
		f.exec(`DELETE FROM app.banking_work WHERE connection_id IN(SELECT id FROM app.banking_connections WHERE owner_id IN($1,$2))`, f.owner, f.other)
		f.exec(`DELETE FROM app.banking_credentials WHERE owner_id IN($1,$2)`, f.owner, f.other)
		f.exec(`DELETE FROM app.banking_connections WHERE owner_id IN($1,$2)`, f.owner, f.other)
	})
	return f, s, p, w, db
}
func startEnrollment(t *testing.T, f *fixture, s *EnrollmentService, owner uuid.UUID, intent string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	ctx, cancel := context.WithTimeout(f.actor(owner), 10*time.Second)
	defer cancel()
	o := s.Start(ctx, StartEnrollmentInput{AttemptID: id, Intent: intent})
	if o.Code != "PREPARED" || o.LinkToken == "" {
		t.Fatalf("start code=%s state=%s", o.Code, o.State)
	}
	return id
}
func finishEnrollment(f *fixture, s *EnrollmentService, owner, id uuid.UUID, accounts ...string) EnrollmentOutcome {
	ctx, cancel := context.WithTimeout(f.actor(owner), 10*time.Second)
	defer cancel()
	return s.Finish(ctx, FinishEnrollmentInput{AttemptID: id, PublicToken: "public-" + id.String(), AccountIDs: accounts})
}
func dueEnrollment(f *fixture, id uuid.UUID) {
	f.exec(`UPDATE app.banking_enrollment_jobs SET due_at=clock_timestamp(),lease_until=NULL WHERE attempt_id=$1`, id)
	f.exec(`UPDATE app.banking_enrollments SET lease_until=NULL WHERE id=$1`, id)
}
func processEnrollment(t *testing.T, w *Worker) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	worked, err := w.ProcessOne(ctx)
	if err != nil || !worked {
		t.Fatalf("worker worked=%v err=%v", worked, err)
	}
}

func TestEnrollmentOwnerReplayConcurrencyAndSelectedStreams(t *testing.T) {
	f, s, p, _, _ := enrollmentFixture(t)
	ctx := f.actor(f.owner)
	id := startEnrollment(t, f, s, f.owner, "different")
	replay := s.Start(ctx, StartEnrollmentInput{AttemptID: id, Intent: "different"})
	if replay.LinkToken != "link-"+id.String() {
		t.Fatal("lost original handoff")
	}
	if code := s.Start(ctx, StartEnrollmentInput{AttemptID: id, Intent: "existing"}).Code; code != "CONFLICT" {
		t.Fatal(code)
	}
	if code := s.Start(f.actor(f.other), StartEnrollmentInput{AttemptID: id, Intent: "different"}).Code; code != "NOT_FOUND" {
		t.Fatal(code)
	}
	if code := s.Status(f.actor(f.other), id).Code; code != "NOT_FOUND" {
		t.Fatal(code)
	}
	if code := s.Status(context.Background(), id).Code; code != "UNAUTHENTICATED" {
		t.Fatal(code)
	}
	var wg sync.WaitGroup
	out := make(chan EnrollmentOutcome, 12)
	for range 12 {
		wg.Add(1)
		go func() { defer wg.Done(); out <- finishEnrollment(f, s, f.owner, id, "card", "checking") }()
	}
	wg.Wait()
	close(out)
	for o := range out {
		if o.Code != "EXCHANGING" && o.Code != "AWAITING_INITIAL_IMPORT" {
			t.Fatal(o.Code)
		}
	}
	final := s.Status(ctx, id)
	if final.Code != "AWAITING_INITIAL_IMPORT" || final.LinkToken != "" {
		t.Fatal(final.Code)
	}
	if p.exchanges != 1 {
		t.Fatalf("exchange count=%d", p.exchanges)
	}
	accounts, status := s.Accounts(ctx, final.ConnectionID)
	if status.Code != "READY" || len(accounts) != 2 {
		t.Fatal(status.Code, len(accounts))
	}
	for _, a := range accounts {
		if a.RequestedHistoryDays != 365 || a.Currency != "USD" || a.BindingID == uuid.Nil {
			t.Fatal("stream initialization")
		}
	}
	if _, r := s.Accounts(f.actor(f.other), final.ConnectionID); r.Code != "NOT_FOUND" {
		t.Fatal(r.Code)
	}
	if code := finishEnrollment(f, s, f.owner, id, "checking", "card").Code; code != "AWAITING_INITIAL_IMPORT" {
		t.Fatal(code)
	}
	if code := finishEnrollment(f, s, f.owner, id, "checking").Code; code != "CONFLICT" {
		t.Fatal(code)
	}
	if n := queryInt(t, f, `SELECT count(*) FROM app.banking_bindings WHERE connection_id=$1`, final.ConnectionID); n != 2 {
		t.Fatal("unselected retained", n)
	}
	if n := queryInt(t, f, `SELECT count(*) FROM app.banking_enrollments WHERE id=$1 AND (link_ciphertext IS NOT NULL OR public_ciphertext IS NOT NULL)`, id); n != 0 {
		t.Fatal("temporary token retained after ready")
	}
	var protected []byte
	if err := f.admin.QueryRow(ctx, `SELECT ciphertext FROM app.banking_credentials WHERE connection_id=$1`, final.ConnectionID).Scan(&protected); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(protected), "access-") {
		t.Fatal("plaintext credential")
	}
	f.exec(`UPDATE app.users SET enabled=false WHERE id=$1`, f.owner)
	if s.Status(ctx, id).Code != "FORBIDDEN" {
		t.Fatal("disabled actor read")
	}
	if s.Cancel(ctx, id).Code != "FORBIDDEN" {
		t.Fatal("disabled actor mutation")
	}
}

func TestEnrollmentLostExchangeEmptyDiscoveryRestartAndLateCallback(t *testing.T) {
	f, s, p, w, db := enrollmentFixture(t)
	healthy := f.connection(f.owner, "healthy-existing")
	user := "usr-kami-" + f.owner.String() + "-sandbox"
	p.items["unrelated"] = enrollmentItem{user: user, webhook: "https://api.example.invalid/banking/webhooks/unrelated"}
	id := startEnrollment(t, f, s, f.owner, "different")
	p.loseExchange = true
	if o := finishEnrollment(f, s, f.owner, id, "checking"); o.Code != "EXCHANGE_UNKNOWN" {
		t.Fatal(o.Code)
	}
	if o := s.Start(f.actor(f.owner), StartEnrollmentInput{AttemptID: uuid.New(), Intent: "different"}); o.Code != "ATTEMPT_IN_PROGRESS" {
		t.Fatal(o.Code)
	}
	p.hideDiscovery = true
	dueEnrollment(f, id)
	processEnrollment(t, w)
	if o := s.Status(f.actor(f.owner), id); o.Code != "EXCHANGE_UNKNOWN" {
		t.Fatal(o.Code)
	}
	if _, r := f.service.ReadConnection(f.actor(f.owner), healthy); r.Code != "READY" {
		t.Fatal("unrelated connection unavailable")
	}
	// New worker instance consumes persisted correlation; no second exchange.
	restarted, err := NewWorker(db, f.service.protector, p)
	if err != nil {
		t.Fatal(err)
	}
	p.hideDiscovery = false
	dueEnrollment(f, id)
	processEnrollment(t, restarted)
	if o := s.Status(f.actor(f.owner), id); o.Code != "RETRY_ALLOWED" {
		t.Fatal(o.Code)
	}
	if p.exchanges != 1 || p.items["unrelated"].removed {
		t.Fatal("broad cleanup or repeated exchange")
	}
	newID := startEnrollment(t, f, s, f.owner, "different")
	oldItem := "late-old-item"
	p.items[oldItem] = enrollmentItem{user: user, webhook: "https://api.example.invalid/banking/webhooks/" + id.String()}
	signed := newWebhookFixture(t)
	ingress, err := NewWebhookHandler(signed.verifier, f.service)
	if err != nil {
		t.Fatal(err)
	}
	body := webhookBody("sandbox", oldItem)
	send := func(signature string) int {
		request := httptest.NewRequest(http.MethodPost, "/banking/webhooks/"+id.String(), bytes.NewReader(body))
		request.Header.Set("Plaid-Verification", signature)
		response := httptest.NewRecorder()
		ingress.ServeHTTP(response, request)
		return response.Code
	}
	if code := send("forged"); code != http.StatusBadRequest {
		t.Fatal("forged ingress", code)
	}
	signature := signed.sign(t, body, signed.now, nil)
	if code := send(signature); code != http.StatusNoContent {
		t.Fatal("late signed ingress", code)
	}
	dueEnrollment(f, id)
	processEnrollment(t, restarted)
	if !p.items[oldItem].removed {
		t.Fatal("late Item survived cleanup")
	}
	if s.Status(f.actor(f.owner), newID).State != "prepared" {
		t.Fatal("late cleanup changed newer attempt")
	}
	if n := queryInt(t, f, `SELECT count(*) FROM app.banking_enrollment_receipts WHERE attempt_id=$1`, id); n != 1 {
		t.Fatal("missing durable late receipt")
	}
	if code := send(signature); code != http.StatusNoContent {
		t.Fatal("duplicate ingress", code)
	}
	if s.Status(f.actor(f.owner), id).State != "retry_allowed" {
		t.Fatal("duplicate late receipt reopened recovery")
	}
}

func TestEnrollmentExplicitEligibilityDuplicatesAndPrivateJointHolder(t *testing.T) {
	for _, account := range []string{"unsupported", "foreign", "newly-exposed", "checking,checking"} {
		t.Run(account, func(t *testing.T) {
			f, s, _, _, _ := enrollmentFixture(t)
			id := startEnrollment(t, f, s, f.owner, "different")
			ids := strings.Split(account, ",")
			o := finishEnrollment(f, s, f.owner, id, ids...)
			if o.State != "cleanup_pending" || o.Code != "INVALID_SELECTION" {
				t.Fatal(o.Code, o.State)
			}
			if n := queryInt(t, f, `SELECT count(*) FROM app.banking_accounts WHERE owner_id=$1`, f.owner); n != 0 {
				t.Fatal("invalid retained accounts")
			}
		})
	}
	f, s, _, _, _ := enrollmentFixture(t)
	first := startEnrollment(t, f, s, f.owner, "different")
	if o := finishEnrollment(f, s, f.owner, first, "checking"); o.Code != "AWAITING_INITIAL_IMPORT" {
		t.Fatal(o.Code)
	}
	second := startEnrollment(t, f, s, f.owner, "different")
	if o := finishEnrollment(f, s, f.owner, second, "checking"); o.Code != "DUPLICATE_ACCOUNT" || o.State != "cleanup_pending" {
		t.Fatal(o.Code, o.State)
	}
	joint := startEnrollment(t, f, s, f.other, "different")
	if o := finishEnrollment(f, s, f.other, joint, "checking"); o.Code != "AWAITING_INITIAL_IMPORT" {
		t.Fatal("private joint holder rejected", o.Code)
	}
}

func TestEnrollmentExistingIntentNeverActivatesReplacement(t *testing.T) {
	f, s, _, _, _ := enrollmentFixture(t)
	id := startEnrollment(t, f, s, f.owner, "existing")
	o := finishEnrollment(f, s, f.owner, id, "checking")
	if o.Code != "REPLACEMENT_REQUIRED" || o.State != "cleanup_pending" {
		t.Fatal(o.Code, o.State)
	}
	if n := queryInt(t, f, `SELECT count(*) FROM app.banking_bindings WHERE owner_id=$1`, f.owner); n != 0 {
		t.Fatal("replacement activated")
	}
}

func TestEnrollmentCancellationExpiryDisabledOwnerAndKnownTeardown(t *testing.T) {
	for _, mode := range []string{"cancel", "expired", "disabled"} {
		t.Run(mode, func(t *testing.T) {
			f, s, p, w, _ := enrollmentFixture(t)
			id := startEnrollment(t, f, s, f.owner, "different")
			p.beforeAccounts = func() {
				switch mode {
				case "cancel":
					s.Cancel(f.actor(f.owner), id)
				case "expired":
					f.exec(`UPDATE app.banking_enrollments SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, id)
				case "disabled":
					f.exec(`UPDATE app.users SET enabled=false WHERE id=$1`, f.owner)
				}
			}
			o := finishEnrollment(f, s, f.owner, id, "checking")
			if o.Code == "AWAITING_INITIAL_IMPORT" {
				t.Fatal("late activation")
			}
			dueEnrollment(f, id)
			processEnrollment(t, w)
			processEnrollment(t, w)
			dueEnrollment(f, id)
			processEnrollment(t, w)
			var state string
			if err := f.admin.QueryRow(context.Background(), `SELECT state FROM app.banking_enrollments WHERE id=$1`, id).Scan(&state); err != nil {
				t.Fatal(err)
			}
			if state != "retry_allowed" {
				t.Fatal(state)
			}
			if !p.items["item-public-"+id.String()].removed {
				t.Fatal("known Item not removed")
			}
		})
	}
}

func TestEnrollmentUnknownExhaustionResumeAndProtectedPrivileges(t *testing.T) {
	f, s, p, w, db := enrollmentFixture(t)
	id := startEnrollment(t, f, s, f.owner, "different")
	p.loseExchange = true
	p.hideDiscovery = true
	finishEnrollment(f, s, f.owner, id, "checking")
	for range 10 {
		dueEnrollment(f, id)
		processEnrollment(t, w)
	}
	if o := s.Status(f.actor(f.owner), id); o.State != "needs_attention" {
		t.Fatal(o.Code)
	}
	statuses, err := db.BankingStatus(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, status := range statuses {
		if status.OperationID == id {
			found = status.State == "needs_attention" && status.Attempts == 10 && status.Kind == "enrollment_recovery"
		}
	}
	if !found {
		t.Fatal("operator status omitted exhausted enrollment")
	}
	if _, err := database.IntegrationPool(f.db).Exec(context.Background(), `SELECT app.banking_enrollment_resume($1)`, id); err == nil {
		t.Fatal("API resumed exhausted recovery")
	}
	f.exec(`SELECT app.banking_enrollment_resume($1)`, id)
	p.hideDiscovery = false
	dueEnrollment(f, id)
	processEnrollment(t, w)
	if o := s.Status(f.actor(f.owner), id); o.Code != "RETRY_ALLOWED" {
		t.Fatal(o.Code)
	}
	// Browser/API/worker cannot read plaintext temporary storage or mutate jobs.
	if _, err := database.IntegrationPool(f.db).Exec(context.Background(), `UPDATE app.banking_enrollments SET state='ready' WHERE id=$1`, id); err == nil {
		t.Fatal("API direct state mutation granted")
	}
}

func TestEnrollmentSwappedTokenCannotActivateOrDeleteForeignItem(t *testing.T) {
	f, s, p, _, _ := enrollmentFixture(t)
	first := startEnrollment(t, f, s, f.owner, "different")
	foreign := startEnrollment(t, f, s, f.other, "different")
	o := s.Finish(f.actor(f.owner), FinishEnrollmentInput{AttemptID: first, PublicToken: "public-" + foreign.String(), AccountIDs: []string{"checking"}})
	if o.Code != "EXCHANGE_UNKNOWN" {
		t.Fatal(o.Code)
	}
	if n := queryInt(t, f, `SELECT count(*) FROM app.banking_connections WHERE owner_id=$1`, f.owner); n != 0 {
		t.Fatal("foreign Item persisted")
	}
	if p.items["item-public-"+foreign.String()].removed {
		t.Fatal("foreign Item removed")
	}
}

func TestEnrollmentCommitFailureRetainsUnknownEffect(t *testing.T) {
	f, s, p, w, _ := enrollmentFixture(t)
	id := startEnrollment(t, f, s, f.owner, "different")
	p.beforeExchange = func() {
		f.exec(`CREATE FUNCTION app.synthetic_enrollment_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic commit failure'; END $$`)
		f.exec(`CREATE TRIGGER synthetic_enrollment_reject BEFORE INSERT ON app.banking_credentials FOR EACH ROW EXECUTE FUNCTION app.synthetic_enrollment_reject()`)
	}
	t.Cleanup(func() {
		f.exec(`DROP TRIGGER IF EXISTS synthetic_enrollment_reject ON app.banking_credentials`)
		f.exec(`DROP FUNCTION IF EXISTS app.synthetic_enrollment_reject()`)
	})
	o := finishEnrollment(f, s, f.owner, id, "checking")
	if o.Code != "UNAVAILABLE" {
		t.Fatal(o.Code)
	}
	if n := queryInt(t, f, `SELECT count(*) FROM app.banking_connections WHERE owner_id=$1`, f.owner); n != 0 {
		t.Fatal("partial connection committed")
	}
	f.exec(`DROP TRIGGER synthetic_enrollment_reject ON app.banking_credentials`)
	f.exec(`DROP FUNCTION app.synthetic_enrollment_reject()`)
	dueEnrollment(f, id)
	processEnrollment(t, w)
	if o := s.Status(f.actor(f.owner), id); o.Code != "RETRY_ALLOWED" {
		t.Fatal(o.Code)
	}
	if p.exchanges != 1 {
		t.Fatal("exchange retried")
	}
}

func TestEnrollmentDisabledGateLeavesNoProviderEffect(t *testing.T) {
	f, s, p, _, _ := enrollmentFixture(t)
	s.config.Enabled = false
	id := uuid.New()
	if o := s.Start(f.actor(f.owner), StartEnrollmentInput{AttemptID: id, Intent: "different"}); o.Code != "FEATURE_DISABLED" {
		t.Fatal(o.Code)
	}
	if len(p.links) != 0 || p.exchanges != 0 {
		t.Fatal("disabled provider effect")
	}
	if n := queryInt(t, f, `SELECT count(*) FROM app.banking_enrollments WHERE id=$1`, id); n != 0 {
		t.Fatal("disabled intent")
	}
	for _, secret := range []string{"public-private", "link-private"} {
		if strings.Contains(fmt.Sprintf("%v %#v", FinishEnrollmentInput{PublicToken: secret}, EnrollmentOutcome{LinkToken: secret}), secret) {
			t.Fatal("secret formatting")
		}
	}
}

func TestEnrollmentLateItemAfterHistoryDeletionUsesNarrowDiscovery(t *testing.T) {
	f, s, p, w, _ := enrollmentFixture(t)
	id := startEnrollment(t, f, s, f.owner, "different")
	ready := finishEnrollment(f, s, f.owner, id, "checking")
	if ready.Code != "AWAITING_INITIAL_IMPORT" {
		t.Fatal(ready.Code)
	}
	requireCode(t, f.service.DeleteHistory(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: ready.ConnectionID, ExpectedGeneration: 1}), "READY")
	for range 5 {
		if _, err := w.ProcessOne(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	item := "late-after-delete"
	p.items[item] = enrollmentItem{user: "usr-kami-" + f.owner.String() + "-sandbox", webhook: "https://api.example.invalid/banking/webhooks/" + id.String()}
	event := VerifiedWebhook{Environment: "sandbox", ItemID: item, BodySHA256: [32]byte{1}, WebhookType: "ITEM", WebhookCode: "ERROR"}
	if err := f.service.AcceptWebhook(context.Background(), id, event); err != nil {
		t.Fatal(err)
	}
	dueEnrollment(f, id)
	processEnrollment(t, w)
	if !p.items[item].removed {
		t.Fatal("late deleted-attempt Item not removed")
	}
	if o := s.Status(f.actor(f.owner), id); o.Code != "RETRY_ALLOWED" {
		t.Fatal(o.Code)
	}
	if _, status := f.service.ReadConnection(f.actor(f.owner), ready.ConnectionID); status.Code != "NOT_FOUND" {
		t.Fatal("deleted connection became visible")
	}
}

func TestEnrollmentGateRevocationSuppressesExistingHandoffAndExchange(t *testing.T) {
	f, s, p, _, _ := enrollmentFixture(t)
	id := startEnrollment(t, f, s, f.owner, "different")
	for _, capabilityOff := range []bool{false, true} {
		s.config.Enabled = !capabilityOff
		if capabilityOff {
			s.config.Enabled = true
			p.capabilities = &EnrollmentCapabilities{}
		} else {
			s.config.Enabled = false
		}
		start := s.Start(f.actor(f.owner), StartEnrollmentInput{AttemptID: id, Intent: "different"})
		if start.LinkToken != "" || (start.Code != "FEATURE_DISABLED" && start.Code != "NEEDS_ATTENTION") {
			t.Fatal("revoked handoff", start.Code)
		}
		finish := finishEnrollment(f, s, f.owner, id, "checking")
		if finish.Code != "FEATURE_DISABLED" && finish.Code != "NEEDS_ATTENTION" {
			t.Fatal("revoked exchange", finish.Code)
		}
		if p.exchanges != 0 {
			t.Fatal("provider exchange after revocation")
		}
		if s.Status(f.actor(f.owner), id).State != "prepared" {
			t.Fatal("safe recovery unavailable")
		}
	}
}

func TestEnrollmentMultipleCorrelatedItemsNeverActivate(t *testing.T) {
	f, s, p, w, _ := enrollmentFixture(t)
	id := startEnrollment(t, f, s, f.owner, "different")
	user := "usr-kami-" + f.owner.String() + "-sandbox"
	p.items["extra"] = enrollmentItem{user: user, webhook: "https://api.example.invalid/banking/webhooks/" + id.String()}
	if o := finishEnrollment(f, s, f.owner, id, "checking"); o.Code != "EXCHANGE_UNKNOWN" {
		t.Fatal(o.Code)
	}
	if n := queryInt(t, f, `SELECT count(*) FROM app.banking_connections WHERE owner_id=$1`, f.owner); n != 0 {
		t.Fatal("ambiguous attempt activated")
	}
	dueEnrollment(f, id)
	processEnrollment(t, w)
	if !p.items["extra"].removed || !p.items["item-public-"+id.String()].removed {
		t.Fatal("correlated effects forgotten")
	}
	if s.Status(f.actor(f.owner), id).Code != "RETRY_ALLOWED" {
		t.Fatal("cleanup not completed")
	}
}

func TestEnrollmentLateExtraItemPreservesReadyConnectionAndFencesHints(t *testing.T) {
	f, s, p, w, _ := enrollmentFixture(t)
	id := startEnrollment(t, f, s, f.owner, "different")
	ready := finishEnrollment(f, s, f.owner, id, "checking")
	if ready.Code != "AWAITING_INITIAL_IMPORT" {
		t.Fatal(ready.Code)
	}
	original := "item-public-" + id.String()
	extra := "late-extra"
	user := "usr-kami-" + f.owner.String() + "-sandbox"
	p.items[extra] = enrollmentItem{user: user, webhook: "https://api.example.invalid/banking/webhooks/" + id.String()}
	p.items["unrelated"] = enrollmentItem{user: user, webhook: "https://api.example.invalid/unrelated"}
	acceptEnrollmentWebhook(t, f.service, id, extra)
	p.hideDiscovery = true
	dueEnrollment(f, id)
	processEnrollment(t, w)
	if s.Status(f.actor(f.owner), id).State != "cleanup_pending" {
		t.Fatal("empty discovery released hint")
	}
	p.hideDiscovery = false
	dueEnrollment(f, id)
	processEnrollment(t, w)
	if !p.items[extra].removed || p.items[original].removed || p.items["unrelated"].removed {
		t.Fatal("late cleanup affected legitimate Items")
	}
	if s.Status(f.actor(f.owner), id).Code != "AWAITING_INITIAL_IMPORT" {
		t.Fatal("original readiness not preserved")
	}
	if c, r := f.service.ReadConnection(f.actor(f.owner), ready.ConnectionID); r.Code != "READY" || c.State != "active" {
		t.Fatal("original connection changed")
	}
	// A new signed hint begins a new cycle; old confirmation cannot prove it safe.
	acceptEnrollmentWebhook(t, f.service, id, "not-yet-discoverable")
	dueEnrollment(f, id)
	processEnrollment(t, w)
	if s.Status(f.actor(f.owner), id).State != "cleanup_pending" {
		t.Fatal("old proof released unseen late effect")
	}
}

func TestEnrollmentRecoveryCapabilitiesRetryMinimumAndLeaseAuthority(t *testing.T) {
	f, s, p, w, db := enrollmentFixture(t)
	id := startEnrollment(t, f, s, f.owner, "different")
	p.loseExchange = true
	finishEnrollment(f, s, f.owner, id, "checking")
	p.failRemoval = true
	var before time.Time
	if err := f.admin.QueryRow(context.Background(), `SELECT clock_timestamp()`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	dueEnrollment(f, id)
	processEnrollment(t, w)
	var due time.Time
	if err := f.admin.QueryRow(context.Background(), `SELECT due_at FROM app.banking_enrollment_jobs WHERE attempt_id=$1`, id).Scan(&due); err != nil || due.Before(before.Add(3*time.Minute)) {
		t.Fatal("provider minimum shortened", err)
	}
	dueEnrollment(f, id)
	job, err := db.ClaimEnrollment(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ClaimEnrollment(context.Background()); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatal("competing lease", err)
	}
	if ok, err := db.RenewEnrollment(context.Background(), job); err != nil || !ok {
		t.Fatal("lease renewal", err)
	}
	dueEnrollment(f, id)
	replacement, err := db.ClaimEnrollment(context.Background())
	if err != nil || replacement.Token == job.Token {
		t.Fatal("restart lease", err)
	}
	if ok, err := db.FinishEnrollment(context.Background(), job, []string{"forged"}, 60); err != nil || ok {
		t.Fatal("stale finish", err)
	}
	if ok, err := db.RecordEnrollmentTargets(context.Background(), job, []string{"forged"}); err != nil || ok {
		t.Fatal("stale targets", err)
	}
	f.exec(`UPDATE app.banking_enrollment_jobs SET lease_until=NULL,state='pending' WHERE attempt_id=$1`, id)
	dueEnrollment(f, id)
	p.capabilities = &EnrollmentCapabilities{}
	processEnrollment(t, w)
	if s.Status(f.actor(f.owner), id).Code != "NEEDS_ATTENTION" || p.items["item-public-"+id.String()].removed {
		t.Fatal("unsupported cleanup did not fail closed")
	}
}

func TestEnrollmentExpiredHandoffIsNotRecoverableAsToken(t *testing.T) {
	f, s, _, _, _ := enrollmentFixture(t)
	id := startEnrollment(t, f, s, f.owner, "different")
	f.exec(`UPDATE app.banking_enrollments SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, id)
	o := s.Start(f.actor(f.owner), StartEnrollmentInput{AttemptID: id, Intent: "different"})
	if o.LinkToken != "" {
		t.Fatal("expired Link token exposed")
	}
}

func acceptEnrollmentWebhook(t *testing.T, service *Service, id uuid.UUID, item string) {
	t.Helper()
	signed := newWebhookFixture(t)
	handler, err := NewWebhookHandler(signed.verifier, service)
	if err != nil {
		t.Fatal(err)
	}
	body := webhookBody("sandbox", item)
	request := httptest.NewRequest(http.MethodPost, "/banking/webhooks/"+id.String(), bytes.NewReader(body))
	request.Header.Set("Plaid-Verification", signed.sign(t, body, signed.now, nil))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatal("verified enrollment ingress", response.Code)
	}
}
