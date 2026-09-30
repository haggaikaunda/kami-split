//go:build integration

package invitation

import (
	"bytes"
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
)

func TestIndependentImmutableDeliveryAndReceipt(t *testing.T) {
	f := newFixture(t)
	owner := f.actor(f.owner)
	key := uuid.New()
	original, err := f.service.Create(owner, f.group, "member@example.invalid", key)
	requireOutcome(t, original, err, "SAVED")
	first, err := f.service.Claim(owner, original.ActionID)
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := f.service.Complete(owner, first, "FAILED_DEFINITE"); err != nil || !ok {
		t.Fatal(ok, err)
	}
	f.allowResend()
	next, err := f.service.Resend(owner, f.group, original.InvitationID, uuid.New())
	requireOutcome(t, next, err, "APPLIED")
	if !next.ExpiresAt.After(original.ExpiresAt) {
		t.Fatal("deliberate resend did not renew")
	}
	recovered, err := f.service.Recover(owner, "CREATE", key)
	requireOutcome(t, recovered, err, "SAVED")
	if !recovered.ExpiresAt.Equal(original.ExpiresAt) {
		t.Fatal("historic receipt expiry changed")
	}
	retry, err := f.service.Claim(owner, original.ActionID)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(retry.Payload(), first.Payload()) || retry.ProviderKey() != first.ProviderKey() {
		t.Fatal("same action recovery changed exact provider request")
	}
	newest, err := f.service.Claim(owner, next.ActionID)
	if err != nil {
		t.Fatal(err)
	}
	if newest.ProviderKey() == retry.ProviderKey() || bytes.Equal(newest.Payload(), retry.Payload()) {
		t.Fatal("new send did not receive its own renewed snapshot/key")
	}
	if ok, err := f.service.Complete(owner, retry, "PROVIDER_ACCEPTED"); err != nil || !ok {
		t.Fatal(ok, err)
	}
	var clean bool
	if err := f.admin.QueryRow(context.Background(), `SELECT payload IS NULL AND payload_key IS NULL FROM app.invitation_delivery WHERE action_id=$1`, original.ActionID).Scan(&clean); err != nil || !clean {
		t.Fatal("known accepted material retained", err)
	}
}

func TestIndependentPredatingDepartureCannotReadmit(t *testing.T) {
	f := newFixture(t)
	// Establish a member through real admission, then save a distinct outstanding
	// invitation while active. It must not turn into return authority after departure.
	_, token := f.create("member@example.invalid")
	joined, err := f.service.Accept(f.actor(f.member), token, uuid.New())
	requireOutcome(t, joined, err, "ADMITTED")
	pending, oldToken := f.create("member@example.invalid")
	f.exec(`UPDATE app.memberships SET active=false WHERE id=$1`, joined.MembershipID)
	f.allowResend()
	resent, err := f.service.Resend(f.actor(f.owner), f.group, pending.InvitationID, uuid.New())
	requireOutcome(t, resent, err, "APPLIED")
	denied, err := f.service.Accept(f.actor(f.member), oldToken, uuid.New())
	requireOutcome(t, denied, err, "NEW_TARGETED_INVITATION_REQUIRED")
	var active bool
	if err := f.admin.QueryRow(context.Background(), `SELECT active FROM app.memberships WHERE id=$1`, joined.MembershipID).Scan(&active); err != nil || active {
		t.Fatal("old invitation revived membership", err)
	}
	revoked, err := f.service.Revoke(f.actor(f.owner), f.group, pending.InvitationID, uuid.New())
	requireOutcome(t, revoked, err, "APPLIED")
	_, fresh := f.create("member@example.invalid")
	readmitted, err := f.service.Accept(f.actor(f.member), fresh, uuid.New())
	requireOutcome(t, readmitted, err, "ADMITTED")
	if readmitted.MembershipID != joined.MembershipID || !readmitted.HasAccess {
		t.Fatal("new authorized invitation lost stable membership")
	}
}

type changingEmailProvider struct {
	calls    atomic.Int32
	observed chan struct{}
	email    string
}

func (p *changingEmailProvider) CurrentEmail(_ context.Context, subject string) (auth.ProviderEmail, error) {
	n := p.calls.Add(1)
	email := p.email
	if n == 1 {
		close(p.observed)
	} else {
		email = "changed@example.invalid"
	}
	return auth.ProviderEmail{Subject: subject, Email: email, Verified: true}, nil
}

func TestIndependentStaleEvidenceAfterLockWait(t *testing.T) {
	f := newFixture(t)
	_, token := f.create("member@example.invalid")
	p := &changingEmailProvider{observed: make(chan struct{}), email: "member@example.invalid"}
	f.service.provider = p
	ctx := context.Background()
	lock, err := f.admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback(ctx)
	if _, err = lock.Exec(ctx, `SELECT id FROM app.groups WHERE id=$1 FOR UPDATE`, f.group); err != nil {
		t.Fatal(err)
	}
	type answer struct {
		r Result
		e error
	}
	done := make(chan answer, 1)
	actor := f.actor(f.member)
	go func() { r, e := f.service.Accept(actor, token, uuid.New()); done <- answer{r, e} }()
	<-p.observed
	select {
	case got := <-done:
		t.Fatalf("admission skipped group lock: %+v", got)
	case <-time.After(5100 * time.Millisecond):
	}
	if err := lock.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	got := <-done
	requireOutcome(t, got.r, got.e, "WRONG_ACCOUNT")
	if p.calls.Load() != 2 {
		t.Fatalf("stale evidence not refetched: %d", p.calls.Load())
	}
	var n int
	if err := f.admin.QueryRow(ctx, `SELECT count(*) FROM app.users WHERE auth_subject=$1`, f.member).Scan(&n); err != nil || n != 0 {
		t.Fatal("stale or wrong-email admission left provisioned identity", n, err)
	}
}

func TestIndependentTransferAndTerminalClaim(t *testing.T) {
	f := newFixture(t)
	_, token := f.create("member@example.invalid")
	joined, err := f.service.Accept(f.actor(f.member), token, uuid.New())
	requireOutcome(t, joined, err, "ADMITTED")
	pending, _ := f.create("another@example.invalid")
	oldOwner := f.actor(f.owner)
	claim, err := f.service.Claim(oldOwner, pending.ActionID)
	if err != nil {
		t.Fatal(err)
	}
	f.exec(`UPDATE app.groups SET owner_membership_id=$1 WHERE id=$2`, joined.MembershipID, f.group)
	if _, err := f.service.Claim(oldOwner, pending.ActionID); err == nil {
		t.Fatal("former owner reclaimed delivery")
	}
	if _, err := f.service.Complete(oldOwner, claim, "PROVIDER_ACCEPTED"); err == nil {
		t.Fatal("former owner completed delivery")
	}
	if _, err := f.service.List(oldOwner, f.group, nil, 50); err == nil {
		t.Fatal("former owner listed invitations")
	}
	revoked, err := f.service.Revoke(f.actor(f.member), f.group, pending.InvitationID, uuid.New())
	requireOutcome(t, revoked, err, "APPLIED")
	var clean bool
	if err := f.admin.QueryRow(context.Background(), `SELECT d.payload IS NULL AND d.payload_key IS NULL AND d.lease_id IS NULL AND i.recipient IS NULL AND i.token_cipher IS NULL FROM app.invitation_delivery d JOIN app.invitation_actions a ON a.id=d.action_id JOIN app.invitations i ON i.id=a.invitation_id WHERE d.action_id=$1`, pending.ActionID).Scan(&clean); err != nil || !clean {
		t.Fatal("terminal delivery/recipient cleanup failed", err)
	}
}

func TestIndependentRuntimePurgeWithoutInvitationTraffic(t *testing.T) {
	f := newFixture(t)
	for _, state := range []string{"PENDING", "UNKNOWN", "FAILED_DEFINITE"} {
		r, _ := f.create(state + "@example.invalid")
		f.exec(`UPDATE app.invitation_delivery SET state=$1,created_at=clock_timestamp()-interval '24 hours',first_submission=CASE WHEN $1='PENDING' THEN NULL ELSE clock_timestamp()-interval '24 hours' END WHERE action_id=$2`, state, r.ActionID)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	var failures atomic.Int32
	go func() { defer close(done); f.db.RunInvitationMaintenance(ctx, func() { failures.Add(1) }) }()
	deadline := time.After(5 * time.Second)
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		var remaining int
		err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.invitation_delivery d JOIN app.invitation_actions a ON a.id=d.action_id WHERE a.group_id=$1 AND (d.payload IS NOT NULL OR d.payload_key IS NOT NULL OR d.state<>'WINDOW_ENDED')`, f.group).Scan(&remaining)
		if err != nil {
			t.Fatal(err)
		}
		if remaining == 0 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("runtime maintenance did not purge without claim/recovery traffic")
		case <-tick.C:
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("maintenance did not join after cancellation")
	}
	if failures.Load() != 0 {
		t.Fatal("maintenance reported failure")
	}
}
