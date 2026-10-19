//go:build integration

package banking

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestEnrollmentAcceptancePersistsProtectedStateBeforeAcknowledgment(t *testing.T) {
	f, s, p, _, _ := enrollmentFixture(t)
	id := startEnrollment(t, f, s, f.owner, "different")
	ctx := context.Background()
	claimed, saved := false, false
	var persistedConnection uuid.UUID
	p.beforeExchange = func() {
		var ciphertext []byte
		var lifetimeSeconds int64
		var linkCleared bool
		if err := f.admin.QueryRow(ctx, `SELECT public_ciphertext,extract(epoch FROM public_expires_at-clock_timestamp())::bigint,link_ciphertext IS NULL FROM app.banking_enrollments WHERE id=$1 AND state='exchanging' AND finish_digest IS NOT NULL`, id).Scan(&ciphertext, &lifetimeSeconds, &linkCleared); err != nil {
			t.Fatal("exchange began without a persisted claim", err)
		}
		if len(ciphertext) == 0 || bytes.Contains(ciphertext, []byte("public-"+id.String())) || lifetimeSeconds <= 0 || lifetimeSeconds > 1800 || !linkCleared {
			t.Fatal("exchange claim omitted encrypted expiring public material")
		}
		claimed = true
	}
	p.beforeAccounts = func() {
		var ciphertext []byte
		var state, item, version string
		var temporaryCleared bool
		if err := f.admin.QueryRow(ctx, `SELECT c.id,c.state,c.provider_item_id,k.key_version,k.ciphertext,e.link_ciphertext IS NULL AND e.public_ciphertext IS NULL FROM app.banking_enrollments e JOIN app.banking_connections c ON c.id=e.connection_id JOIN app.banking_credentials k ON k.connection_id=c.id WHERE e.id=$1`, id).Scan(&persistedConnection, &state, &item, &version, &ciphertext, &temporaryCleared); err != nil {
			t.Fatal("inventory began before durable Item and credential storage", err)
		}
		if state != "stopped" || item != "item-public-"+id.String() || !temporaryCleared || bytes.Contains(ciphertext, []byte("access-")) {
			t.Fatal("provisional state activated early or retained plaintext")
		}
		raw, err := f.service.protector.decrypt(ciphertext, version, f.owner.String(), persistedConnection.String(), "sandbox")
		defer clear(raw)
		if err != nil || string(raw) != "access-item-public-"+id.String() {
			t.Fatal("durable credential could not recover the exact exchanged Item")
		}
		if n := queryInt(t, f, `SELECT count(*) FROM app.banking_accounts WHERE owner_id=$1`, f.owner); n != 0 {
			t.Fatal("financial accounts retained before inventory and explicit selection")
		}
		saved = true
	}
	result := finishEnrollment(f, s, f.owner, id, "savings")
	if !claimed || !saved || result.Code != "AWAITING_INITIAL_IMPORT" || result.ConnectionID != persistedConnection || result.LinkToken != "" {
		t.Fatal("acknowledgment did not follow protected durable state")
	}
	accounts, status := s.Accounts(f.actor(f.owner), result.ConnectionID)
	if status.Code != "READY" || len(accounts) != 1 || accounts[0].Kind != "savings" {
		t.Fatal("explicit savings stream was not the sole retained account")
	}
	if n := queryInt(t, f, `SELECT count(*) FROM app.banking_sources WHERE owner_id=$1`, f.owner); n != 0 {
		t.Fatal("awaiting import fabricated transaction sources")
	}
}

type partialEnrollmentRemoval struct {
	*controlledEnrollmentProvider
	calls int
}

func (p *partialEnrollmentRemoval) RemoveDiscovered(ctx context.Context, environment string, correlation EnrollmentCorrelation, item string) (RemovalResult, error) {
	p.calls++
	if p.calls == 2 {
		return RemovalResult{RetryAfter: 3 * time.Minute}, &RemovalError{Retryable: true, Uncertain: true}
	}
	return p.controlledEnrollmentProvider.RemoveDiscovered(ctx, environment, correlation, item)
}

func TestEnrollmentAcceptancePartialCleanupSurvivesWorkerRestart(t *testing.T) {
	f, s, p, _, db := enrollmentFixture(t)
	id := startEnrollment(t, f, s, f.owner, "different")
	p.loseExchange = true
	if got := finishEnrollment(f, s, f.owner, id, "checking"); got.Code != "EXCHANGE_UNKNOWN" {
		t.Fatal("lost exchange did not remain uncertain")
	}
	user := "usr-kami-" + f.owner.String() + "-sandbox"
	webhook := "https://api.example.invalid/banking/webhooks/" + id.String()
	p.items["second-correlated"] = enrollmentItem{user: user, webhook: webhook}
	p.items["third-correlated"] = enrollmentItem{user: user, webhook: webhook}
	p.items["unrelated-same-user"] = enrollmentItem{user: user, webhook: "https://api.example.invalid/banking/webhooks/unrelated"}
	provider := &partialEnrollmentRemoval{controlledEnrollmentProvider: p}
	worker, err := NewWorker(db, f.service.protector, provider)
	if err != nil {
		t.Fatal(err)
	}
	dueEnrollment(f, id)
	processEnrollment(t, worker)
	var targets, removed []string
	var state string
	if err := f.admin.QueryRow(context.Background(), `SELECT correlated_items,removed_items,state FROM app.banking_enrollment_jobs WHERE attempt_id=$1`, id).Scan(&targets, &removed, &state); err != nil {
		t.Fatal(err)
	}
	if len(targets) != 3 || len(removed) != 1 || state != "pending" || s.Status(f.actor(f.owner), id).Code == "RETRY_ALLOWED" {
		t.Fatal("partial cleanup forgot targets or prematurely allowed enrollment")
	}
	if got := s.Start(f.actor(f.owner), StartEnrollmentInput{AttemptID: uuid.New(), Intent: "different"}); got.Code != "ATTEMPT_IN_PROGRESS" {
		t.Fatal("partial remote cleanup permitted a blind second enrollment")
	}
	// Recreate the worker with no retained local work state. Its only completion
	// proof is the durable union of targets and confirmed prior removals.
	restarted, err := NewWorker(db, f.service.protector, provider)
	if err != nil {
		t.Fatal(err)
	}
	dueEnrollment(f, id)
	processEnrollment(t, restarted)
	if err := f.admin.QueryRow(context.Background(), `SELECT correlated_items,removed_items,state FROM app.banking_enrollment_jobs WHERE attempt_id=$1`, id).Scan(&targets, &removed, &state); err != nil {
		t.Fatal(err)
	}
	if len(targets) != 3 || len(removed) != 3 || state != "complete" || s.Status(f.actor(f.owner), id).Code != "RETRY_ALLOWED" {
		t.Fatal("restart failed to complete all previously correlated effects")
	}
	if p.exchanges != 1 || p.items["unrelated-same-user"].removed {
		t.Fatal("restart repeated exchange or removed an unrelated Item")
	}
	if n := queryInt(t, f, `SELECT count(*) FROM app.banking_connections WHERE owner_id=$1`, f.owner); n != 0 {
		t.Fatal("uncertain exchange produced an active or provisional connection")
	}
}
