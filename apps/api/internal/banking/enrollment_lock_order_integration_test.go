//go:build integration

package banking

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// The capability check occurs after Start's absent-row read and before its
// reservation statement. Only the first caller pauses; no production hook is used.
type pausedEnrollmentStart struct {
	*controlledEnrollmentProvider
	calls          atomic.Int32
	absent, resume chan struct{}
	ctx            context.Context
}

func (p *pausedEnrollmentStart) EnrollmentCapabilities() EnrollmentCapabilities {
	if p.calls.Add(1) == 1 {
		close(p.absent)
		select {
		case <-p.resume:
		case <-p.ctx.Done():
		}
	}
	return p.controlledEnrollmentProvider.EnrollmentCapabilities()
}

func TestEnrollmentDelayedAbsentStartAndFinishUseOneLockOrder(t *testing.T) {
	f, _, base, _, _ := enrollmentFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	provider := &pausedEnrollmentStart{controlledEnrollmentProvider: base, absent: make(chan struct{}), resume: make(chan struct{}), ctx: ctx}
	service, err := NewEnrollment(f.service, provider, EnrollmentConfig{Enabled: true, Environment: "sandbox", WebhookOrigin: "https://api.example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	id := uuid.New()
	input := StartEnrollmentInput{AttemptID: id, Intent: "different"}
	actor := f.actor(f.owner)
	requestCtx, requestCancel := context.WithTimeout(actor, 15*time.Second)
	defer requestCancel()
	// Every spawned application call is canceled and joined before fixture cleanup.
	delayed := make(chan EnrollmentOutcome, 1)
	startDone := make(chan struct{})
	go func() { defer close(startDone); delayed <- service.Start(requestCtx, input) }()
	defer func() {
		requestCancel()
		select {
		case <-startDone:
		case <-time.After(2 * time.Second):
			t.Error("Start goroutine did not stop after cancellation")
		}
	}()
	select {
	case <-provider.absent:
	case <-ctx.Done():
		t.Fatal("Start did not reach absent-row boundary")
	}
	if prepared := service.Start(requestCtx, input); prepared.Code != "PREPARED" {
		t.Fatal("competing Start", prepared.Code)
	}
	accounts, resumeAccounts := make(chan struct{}), make(chan struct{})
	base.beforeAccounts = func() {
		close(accounts)
		select {
		case <-resumeAccounts:
		case <-ctx.Done():
		}
	}
	finished := make(chan EnrollmentOutcome, 1)
	finishDone := make(chan struct{})
	go func() {
		defer close(finishDone)
		finished <- service.Finish(requestCtx, FinishEnrollmentInput{AttemptID: id, PublicToken: "public-" + id.String(), AccountIDs: []string{"checking"}})
	}()
	defer func() {
		requestCancel()
		select {
		case <-finishDone:
		case <-time.After(2 * time.Second):
			t.Error("Finish goroutine did not stop after cancellation")
		}
	}()
	select {
	case <-accounts:
	case <-ctx.Done():
		t.Fatal("Finish did not persist provisional connection")
	}
	// A mismatched fence locks the connection but changes no lifecycle authority.
	// These are the same restricted-role calls available to the application.
	barrier, err := database.IntegrationPool(f.db).Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer barrier.Rollback(context.Background())
	if _, err = barrier.Exec(ctx, `SELECT set_config('app.verified_sub',$1,true)`, f.owner.String()); err != nil {
		t.Fatal(err)
	}
	var connection uuid.UUID
	if err = barrier.QueryRow(ctx, `SELECT connection_id FROM app.banking_enrollments WHERE id=$1`, id).Scan(&connection); err != nil {
		t.Fatal(err)
	}
	var barrierPID int
	if err = barrier.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&barrierPID); err != nil {
		t.Fatal(err)
	}
	var code string
	if err = barrier.QueryRow(ctx, `SELECT app.banking_fence($1,0,false)`, connection).Scan(&code); err != nil || code != "CONFLICT" {
		t.Fatal("connection barrier", code, err)
	}
	close(resumeAccounts)
	// A conflicting replay with a short lock timeout proves activation holds the
	// attempt while waiting on our connection barrier, without inspecting query text.
	attemptHeld := false
	for ctx.Err() == nil {
		err = f.db.WithIdentity(ctx, f.owner.String(), func(tx pgx.Tx) error {
			if _, e := tx.Exec(ctx, `SELECT set_config('lock_timeout','50ms',true)`); e != nil {
				return e
			}
			return tx.QueryRow(ctx, `SELECT app.banking_enrollment_exchange_claim($1,$2,$3,$4)`, id, []byte("different"), []byte("unused"), "one").Scan(&code)
		})
		var locked *pgconn.PgError
		if errors.As(err, &locked) && locked.Code == "55P03" {
			attemptHeld = true
			break
		}
		if err != nil {
			t.Fatal("attempt barrier probe", err)
		}
	}
	if !attemptHeld {
		t.Fatal("activation did not acquire attempt before connection")
	}
	close(provider.resume)
	// Observe the actual two-hop wait rooted at our owned connection barrier:
	// delayed Start waits for activation, which waits for the connection. Both
	// old and fixed ordering must reach this overlap before we release anything.
	// pg_locks/blocking PIDs are public metadata; no query text is inspected.
	startWaiting := false
	for ctx.Err() == nil {
		err = f.db.WithIdentity(ctx, f.owner.String(), func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, `SELECT EXISTS(
        SELECT FROM pg_locks waiter WHERE NOT waiter.granted AND EXISTS(
          SELECT FROM unnest(pg_blocking_pids(waiter.pid)) blocker(pid)
          WHERE $1=ANY(pg_blocking_pids(blocker.pid))))`, barrierPID).Scan(&startWaiting)
		})
		if err != nil {
			t.Fatal("restricted wait-chain probe", err)
		}
		if startWaiting {
			break
		}
	}
	if !startWaiting {
		t.Fatal("delayed Start did not overlap activation's connection wait")
	}
	if err = barrier.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	var startResult, finishResult EnrollmentOutcome
	select {
	case startResult = <-delayed:
	case <-ctx.Done():
		t.Fatal("delayed Start did not complete")
	}
	select {
	case finishResult = <-finished:
	case <-ctx.Done():
		t.Fatal("Finish did not complete")
	}
	if startResult.Code != "AWAITING_INITIAL_IMPORT" || finishResult.Code != "AWAITING_INITIAL_IMPORT" {
		t.Fatalf("concurrent operations lost valid enrollment: Start=%s Finish=%s", startResult.Code, finishResult.Code)
	}
	for _, result := range []EnrollmentOutcome{startResult, finishResult} {
		if result.AttemptID != id || result.ConnectionID != connection || result.State != "ready" || result.LinkToken != "" {
			t.Fatal("concurrent operation omitted canonical ready receipt")
		}
	}
	if base.exchanges != 1 {
		t.Fatal("concurrent replay repeated exchange")
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_connections WHERE id=$1 AND state='active' AND generation=1 AND permission_state='granted'`, connection) != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_bindings WHERE connection_id=$1`, connection) != 1 {
		t.Fatal("ready selected state was not committed")
	}
	if replay := service.Start(requestCtx, input); replay.Code != "AWAITING_INITIAL_IMPORT" || replay.State != "ready" || replay.AttemptID != id || replay.ConnectionID != connection || replay.LinkToken != "" {
		t.Fatal("canonical replay", replay.Code)
	}
}

func TestEnrollmentDelayedAbsentStartReturnsPreparedHandoff(t *testing.T) {
	f, _, base, _, _ := enrollmentFixture(t)
	ctx, cancel := context.WithTimeout(f.actor(f.owner), 10*time.Second)
	defer cancel()
	provider := &pausedEnrollmentStart{controlledEnrollmentProvider: base, absent: make(chan struct{}), resume: make(chan struct{}), ctx: ctx}
	service, err := NewEnrollment(f.service, provider, EnrollmentConfig{Enabled: true, Environment: "sandbox", WebhookOrigin: "https://api.example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	input := StartEnrollmentInput{AttemptID: uuid.New(), Intent: "different"}
	delayed := make(chan EnrollmentOutcome, 1)
	done := make(chan struct{})
	go func() { defer close(done); delayed <- service.Start(ctx, input) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Error("Start goroutine did not stop after cancellation")
		}
	}()
	select {
	case <-provider.absent:
	case <-ctx.Done():
		t.Fatal("Start did not reach absent-row boundary")
	}
	prepared := service.Start(ctx, input)
	if prepared.Code != "PREPARED" || prepared.LinkToken == "" {
		t.Fatal("competing Start", prepared.Code)
	}
	close(provider.resume)
	var replay EnrollmentOutcome
	select {
	case replay = <-delayed:
	case <-ctx.Done():
		t.Fatal("delayed Start did not complete")
	}
	if replay.Code != "PREPARED" || replay.State != "prepared" || replay.AttemptID != input.AttemptID || replay.ConnectionID != uuid.Nil || replay.LinkToken != prepared.LinkToken || !replay.ExpiresAt.Equal(prepared.ExpiresAt) {
		t.Fatal("stale absent-row replay omitted canonical handoff")
	}
	if len(base.links) != 1 || base.exchanges != 0 {
		t.Fatal("replay repeated provider effects")
	}
}
