//go:build integration

package banking

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

// A successful lookup may temporarily omit an earlier positively correlated
// Item. Disappearance alone is never proof of its removal.
type shrinkingEnrollmentDiscovery struct {
	*controlledEnrollmentProvider
	reads             int
	hideExtra         bool
	beforeFirstReturn func()
}

func (p *shrinkingEnrollmentDiscovery) Discover(ctx context.Context, environment string, correlation EnrollmentCorrelation) ([]string, error) {
	items, err := p.controlledEnrollmentProvider.Discover(ctx, environment, correlation)
	p.reads++
	if p.reads > 1 && p.hideExtra {
		visible := make([]string, 0, len(items))
		for _, id := range items {
			if id != "extra-positive-target" {
				visible = append(visible, id)
			}
		}
		items = visible
	}
	if p.reads == 1 && p.beforeFirstReturn != nil {
		p.beforeFirstReturn()
	}
	return items, err
}

func TestEnrollmentFinishRetainsPositiveTargetsAcrossShrinkingDiscoveryAndRestart(t *testing.T) {
	f, _, base, _, db := enrollmentFixture(t)
	provider := &shrinkingEnrollmentDiscovery{controlledEnrollmentProvider: base, hideExtra: true}
	service, err := NewEnrollment(f.service, provider, EnrollmentConfig{Enabled: true, Environment: "sandbox", WebhookOrigin: "https://api.example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	id := startEnrollment(t, f, service, f.owner, "different")
	user := "usr-kami-" + f.owner.String() + "-sandbox"
	provider.items["extra-positive-target"] = enrollmentItem{user: user, webhook: "https://api.example.invalid/banking/webhooks/" + id.String()}
	provider.items["unrelated-same-user"] = enrollmentItem{user: user, webhook: "https://api.example.invalid/unrelated"}
	if outcome := finishEnrollment(f, service, f.owner, id, "checking"); outcome.Code != "EXCHANGE_UNKNOWN" {
		t.Fatal(outcome.Code)
	}
	var targets []string
	if err := f.admin.QueryRow(context.Background(), `SELECT correlated_items FROM app.banking_enrollment_jobs WHERE attempt_id=$1`, id).Scan(&targets); err != nil || len(targets) != 2 {
		t.Fatal("Finish discarded positive discovery before returning uncertainty", err)
	}
	worker, err := NewWorker(db, f.service.protector, provider)
	if err != nil {
		t.Fatal(err)
	}
	dueEnrollment(f, id)
	processEnrollment(t, worker)
	if outcome := service.Status(f.actor(f.owner), id); outcome.Code == "RETRY_ALLOWED" || provider.items["extra-positive-target"].removed {
		t.Fatal("shrinking lookup erased an unresolved positive target")
	}
	if outcome := service.Start(f.actor(f.owner), StartEnrollmentInput{AttemptID: uuid.New(), Intent: "different"}); outcome.Code != "ATTEMPT_IN_PROGRESS" {
		t.Fatal("unremoved Item allowed a blind second enrollment", outcome.Code)
	}
	restarted, err := NewWorker(db, f.service.protector, provider)
	if err != nil {
		t.Fatal(err)
	}
	dueEnrollment(f, id)
	processEnrollment(t, restarted)
	if service.Status(f.actor(f.owner), id).Code == "RETRY_ALLOWED" {
		t.Fatal("restart forgot original positive target")
	}
	provider.hideExtra = false
	dueEnrollment(f, id)
	processEnrollment(t, restarted)
	if outcome := service.Status(f.actor(f.owner), id); outcome.Code != "RETRY_ALLOWED" || !provider.items["extra-positive-target"].removed {
		t.Fatal("later verified cleanup did not release the original attempt", outcome.Code)
	}
	if provider.exchanges != 1 || provider.items["unrelated-same-user"].removed {
		t.Fatal("recovery repeated exchange or touched unrelated Item")
	}
}

func TestEnrollmentFinishHonorsProvisionalConnectionStopAndDelete(t *testing.T) {
	for _, erase := range []bool{false, true} {
		for _, cleanupFirst := range []bool{false, true} {
			t.Run(fmt.Sprintf("delete=%t/cleanupBeforeActivate=%t", erase, cleanupFirst), func(t *testing.T) {
				f, service, provider, worker, _ := enrollmentFixture(t)
				id := startEnrollment(t, f, service, f.owner, "different")
				var connection uuid.UUID
				provider.beforeAccounts = func() {
					if err := f.admin.QueryRow(context.Background(), `SELECT connection_id FROM app.banking_enrollments WHERE id=$1`, id).Scan(&connection); err != nil {
						t.Fatal(err)
					}
					fence := FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}
					var result Result
					if erase {
						result = f.service.DeleteHistory(f.actor(f.owner), fence)
					} else {
						result = f.service.Stop(f.actor(f.owner), fence)
					}
					requireCode(t, result, "READY")
					if cleanupFirst {
						runProvisionalCleanup(t, f, worker, id)
					}
				}
				outcome := finishEnrollment(f, service, f.owner, id, "checking")
				if outcome.Code == "AWAITING_INITIAL_IMPORT" || outcome.State == "ready" {
					t.Fatal("fenced provisional connection acknowledged readiness")
				}
				var state string
				var generation int64
				if err := f.admin.QueryRow(context.Background(), `SELECT state,generation FROM app.banking_connections WHERE id=$1`, connection).Scan(&state, &generation); err != nil {
					t.Fatal(err)
				}
				expected := "stopped"
				if erase {
					expected = "deleted"
				}
				if state != expected || generation != 2 {
					t.Fatalf("fence changed: state=%s generation=%d", state, generation)
				}
				if n := queryInt(t, f, `SELECT count(*) FROM app.banking_accounts WHERE owner_id=$1`, f.owner); n != 0 {
					t.Fatal("fenced enrollment retained selected account facts")
				}
				if n := queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_correlations WHERE id=$1`, id); n != 0 {
					t.Fatal("fenced enrollment published active correlation")
				}
				runProvisionalCleanup(t, f, worker, id)
				if n := queryInt(t, f, `SELECT count(*) FROM app.banking_credentials WHERE connection_id=$1`, connection); n != 0 {
					t.Fatal("fenced Item credential survived cleanup")
				}
				if !provider.items["item-public-"+id.String()].removed {
					t.Fatal("fenced Item was not narrowly removed")
				}
				if n := queryInt(t, f, `SELECT count(*) FROM app.banking_connections WHERE id=$1 AND state='active'`, connection); n != 0 {
					t.Fatal("cleanup resurrected fenced connection")
				}
			})
		}
	}
}

func runProvisionalCleanup(t *testing.T, f *fixture, worker *Worker, id uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for range 8 {
		dueEnrollment(f, id)
		if _, err := worker.ProcessOne(ctx); err != nil {
			t.Fatal(err)
		}
	}
}

type enrollmentUserStatusProvider struct {
	*controlledEnrollmentProvider
	userAdapter *PlaidProvider
}

func (p *enrollmentUserStatusProvider) EnsureUser(ctx context.Context, environment, clientID string) (string, error) {
	return p.userAdapter.EnsureUser(ctx, environment, clientID)
}

func TestEnrollmentStartAcceptsNewUser201AndExistingUser200(t *testing.T) {
	f, _, base, _, _ := enrollmentFixture(t)
	calls := 0
	adapter := enrollmentPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		request := enrollmentRequest(t, r)
		if r.URL.Path != "/user/create" || request["client_user_id"] != "kami-"+f.owner.String()+"-sandbox" {
			t.Fatal("user identity not actor/environment bound")
		}
		status := http.StatusCreated
		if calls > 1 {
			status = http.StatusOK
		}
		return plaidTestResponse(status, `{"user_id":"usr_stable_owner","request_id":"synthetic"}`), nil
	}))
	provider := &enrollmentUserStatusProvider{controlledEnrollmentProvider: base, userAdapter: adapter}
	service, err := NewEnrollment(f.service, provider, EnrollmentConfig{Enabled: true, Environment: "sandbox", WebhookOrigin: "https://api.example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	id := startEnrollment(t, f, service, f.owner, "different")
	if replay := service.Start(f.actor(f.owner), StartEnrollmentInput{AttemptID: id, Intent: "different"}); replay.Code != "PREPARED" || calls != 1 {
		t.Fatal("prepared replay repeated user creation", replay.Code)
	}
	var user string
	if err := f.admin.QueryRow(context.Background(), `SELECT user_id FROM app.banking_enrollments WHERE id=$1`, id).Scan(&user); err != nil || user != "usr_stable_owner" {
		t.Fatal("new user identity not persisted before handoff", err)
	}
	if result := finishEnrollment(f, service, f.owner, id, "checking"); result.Code != "AWAITING_INITIAL_IMPORT" {
		t.Fatal("new-user path did not reach ready", result.Code)
	}
	startEnrollment(t, f, service, f.owner, "different")
	if calls != 2 {
		t.Fatal("existing actor did not recover same provider user")
	}
}

func TestEnrollmentLateFinishDiscoveryReopensCompletedCleanup(t *testing.T) {
	f, _, base, _, db := enrollmentFixture(t)
	provider := &shrinkingEnrollmentDiscovery{controlledEnrollmentProvider: base, hideExtra: true}
	service, err := NewEnrollment(f.service, provider, EnrollmentConfig{Enabled: true, Environment: "sandbox", WebhookOrigin: "https://api.example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	worker, err := NewWorker(db, f.service.protector, provider)
	if err != nil {
		t.Fatal(err)
	}
	id := startEnrollment(t, f, service, f.owner, "different")
	provider.items["extra-positive-target"] = enrollmentItem{user: "usr-kami-" + f.owner.String() + "-sandbox", webhook: "https://api.example.invalid/banking/webhooks/" + id.String()}
	var newerAttempt uuid.UUID
	provider.beforeFirstReturn = func() {
		dueEnrollment(f, id)
		processEnrollment(t, worker)
		if service.Status(f.actor(f.owner), id).Code != "RETRY_ALLOWED" {
			t.Fatal("fixture did not advance cleanup before late discovery")
		}
		// A fresh attempt can win the transient retry window. Late evidence
		// must still persist without violating the one-blocking-row index.
		newerAttempt = startEnrollment(t, f, service, f.owner, "different")
	}
	if result := finishEnrollment(f, service, f.owner, id, "checking"); result.Code != "CLEANUP_PENDING" {
		t.Fatal("late positive discovery did not reopen unresolved intent", result.Code)
	}
	if service.Status(f.actor(f.owner), newerAttempt).Code != "PREPARED" {
		t.Fatal("late cleanup replaced the newer attempt")
	}
	if result := service.Start(f.actor(f.owner), StartEnrollmentInput{AttemptID: uuid.New(), Intent: "different"}); result.Code != "ATTEMPT_IN_PROGRESS" {
		t.Fatal("late evidence did not block additional enrollment", result.Code)
	}
	var targets, removed []string
	if err := f.admin.QueryRow(context.Background(), `SELECT correlated_items,removed_items FROM app.banking_enrollment_jobs WHERE attempt_id=$1`, id).Scan(&targets, &removed); err != nil || len(targets) != 2 || len(removed) != 1 {
		t.Fatal("late union lost positive targets or prior removal proof", err)
	}
	dueEnrollment(f, id)
	processEnrollment(t, worker)
	if service.Status(f.actor(f.owner), id).Code == "RETRY_ALLOWED" {
		t.Fatal("incomplete rediscovery released late target")
	}
	provider.hideExtra = false
	dueEnrollment(f, id)
	processEnrollment(t, worker)
	if service.Status(f.actor(f.owner), id).Code != "RETRY_ALLOWED" || !provider.items["extra-positive-target"].removed || provider.exchanges != 1 {
		t.Fatal("late target not durably cleaned without repeated exchange")
	}
}
