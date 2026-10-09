//go:build integration

package expense_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/invitation"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
)

// verifiedEditCall runs through the production verifier; test input cannot inject
// an application actor. Each invocation gets its own request-bound context.
func verifiedEditCall(t *testing.T, f *expenseFixture, actor int, fn func(context.Context)) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/", nil).WithContext(f.ctx)
	if actor > 0 {
		req.Header.Set("Authorization", "Bearer "+f.token(actor))
	}
	called := false
	f.verifier.Protect(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { called = true; fn(r.Context()) })).ServeHTTP(httptest.NewRecorder(), req)
	if !called {
		t.Fatal("verified request was rejected")
	}
}
func performEdit(t *testing.T, f *expenseFixture, actor int, input ledger.EditInput) expense.Outcome {
	t.Helper()
	var result expense.Outcome
	verifiedEditCall(t, f, actor, func(ctx context.Context) {
		var err error
		result, err = expense.New(f.db).Edit(ctx, input)
		if err != nil {
			t.Errorf("edit: %v", err)
		}
	})
	return result
}
func editInput(f *expenseFixture) ledger.EditInput {
	in := ledger.EditInput{Input: f.input, ExpenseID: f.original.Record.ExpenseID, ExpectedVersion: 1}
	in.Key = uuid.NewString()
	in.Description = "Corrected dinner"
	return in
}
func readEdited(t *testing.T, f *expenseFixture) expense.Snapshot {
	t.Helper()
	var result expense.Snapshot
	verifiedEditCall(t, f, 1, func(ctx context.Context) {
		var err error
		result, err = expense.New(f.db).ReadExpense(ctx, f.input.GroupID, f.original.Record.ExpenseID)
		if err != nil {
			t.Fatal(err)
		}
	})
	return result
}

func TestEditCollaborativeVersionsHistoryAndAnchoredViews(t *testing.T) {
	f := newExpenseFixture(t)
	codec, _ := ledger.NewCursorCodec("edit", map[string][]byte{"edit": bytes.Repeat([]byte{7}, 32)})
	viewIn := expense.ExpenseViewRequest{Scope: f.input.GroupID, First: 1}
	var first expense.ExpenseView
	var initial expense.ActivityPage
	verifiedEditCall(t, f, 2, func(ctx context.Context) {
		var err error
		first, err = expense.New(f.db).ReadExpenseView(ctx, viewIn, codec)
		if err != nil {
			t.Fatal(err)
		}
		initial, err = expense.New(f.db).ReadActivity(ctx, expense.ActivityRequest{GroupID: f.input.GroupID, First: 1}, codec)
		if err != nil {
			t.Fatal(err)
		}
	})
	in := editInput(f)
	in.Total = 800
	in.PayerID = f.public("Membership", 302)
	in.ParticipantIDs = []string{f.public("Membership", 301), f.public("Membership", 302)}
	in.Split = "PERCENTAGE"
	in.Percentages = []ledger.Percentage{{ParticipantID: f.public("Membership", 301), Hundredths: 2500}, {ParticipantID: f.public("Membership", 302), Hundredths: 7500}}
	in.Note = "  preserved note\n"
	in.Category = "GROCERIES"
	in.EffectiveDate = "2026-10-02"
	// Actor 2 is neither original creator nor payer.
	out := performEdit(t, f, 2, in)
	if out.Kind != "COMMITTED" || !out.Changed || out.Record.Version != 2 || out.Record.CreatorMembershipID != f.original.Record.CreatorMembershipID || out.Record.CommittedAt != f.original.Record.CommittedAt {
		t.Fatalf("edit outcome: %+v", out)
	}
	read := readEdited(t, f)
	if read.Total != 800 || len(read.Records) != 1 || read.Records[0].Note != in.Note || read.Records[0].Version != 2 {
		t.Fatalf("effective read: %+v", read)
	}
	verifiedEditCall(t, f, 2, func(ctx context.Context) {
		service := expense.New(f.db)
		current, err := service.ReadExpenseView(ctx, viewIn, codec)
		if err != nil {
			t.Fatal(err)
		}
		if current.ViewerShare != 600 || current.ViewerPaid != 800 || len(current.Categories) != 1 || current.Categories[0].Category != "GROCERIES" || current.Categories[0].ViewerShare != 600 || current.Total != 800 || current.Count != 1 || len(current.Months) != 1 || current.Months[0].Month != "2026-10" {
			t.Fatalf("current totals: %+v", current)
		}
		anchored := viewIn
		anchored.After = first.Edges[0].Cursor
		continuation, err := service.ReadExpenseView(ctx, anchored, codec)
		if err != nil {
			t.Fatal(err)
		}
		if continuation.ViewerShare != first.ViewerShare || continuation.ViewerPaid != first.ViewerPaid || len(continuation.Categories) != 1 || continuation.Categories[0] != first.Categories[0] || continuation.Total != 1000 || continuation.Count != 1 || continuation.Months[0].Month != "2026-09" || len(continuation.Edges) != 0 {
			t.Fatalf("mutated anchored dataset: %+v", continuation)
		}
		events, err := service.ReadActivity(ctx, expense.ActivityRequest{GroupID: f.input.GroupID, First: 10}, codec)
		if err != nil {
			t.Fatal(err)
		}
		if len(events.Events) != 2 || events.Events[0].Kind != "EXPENSE_UPDATED" || events.Events[0].Before.TotalMinor != 1000 || events.Events[0].After.TotalMinor != 800 || events.Events[0].Creator.ID != f.public("Membership", 302) || events.Events[1].AmountMinor != 1000 || events.Events[1].Description != "Dinner" {
			t.Fatalf("immutable events: %+v", events)
		}
		detail, err := service.ReadActivityDetail(ctx, expense.ActivityRequest{GroupID: f.input.GroupID}, events.Events[0].ID, codec)
		if err != nil || detail.After.Note != in.Note {
			t.Fatalf("event detail: %+v %v", detail, err)
		}
		oldEvents, err := service.ReadActivity(ctx, expense.ActivityRequest{GroupID: f.input.GroupID, First: 10, After: initial.Cursors[0]}, codec)
		if err != nil || len(oldEvents.Events) != 0 {
			t.Fatalf("activity anchor: %+v %v", oldEvents, err)
		}
	})
	// A canonical no-op remains recoverable but emits no extra financial revision.
	noOp := in
	noOp.Key = uuid.NewString()
	noOp.ExpectedVersion = 2
	unchanged := performEdit(t, f, 2, noOp)
	if unchanged.Kind != "COMMITTED" || unchanged.Changed || unchanged.Record.Revision != out.Record.Revision {
		t.Fatalf("no-op: %+v", unchanged)
	}
	stale := in
	stale.Key = uuid.NewString()
	stale.Description = "Stale"
	if conflict := performEdit(t, f, 2, stale); conflict.Kind != "CONFLICT" || conflict.CurrentVersion != 2 {
		t.Fatalf("stale save: %+v", conflict)
	}
	mismatch := in
	mismatch.Description = "Changed attempt"
	if result := performEdit(t, f, 2, mismatch); result.Kind != "MISMATCH" {
		t.Fatalf("key reuse: %+v", result)
	}
	replay := performEdit(t, f, 2, in)
	if replay.Kind != "COMMITTED" || replay.Record.Version != 2 {
		t.Fatalf("immutable original retry: %+v", replay)
	}
}

func TestEditCompetingWritesAndDuplicateAttempts(t *testing.T) {
	f := newExpenseFixture(t)
	a, b := editInput(f), editInput(f)
	b.Description = "Other edit"
	var results [2]expense.Outcome
	var wg sync.WaitGroup
	for i, in := range []ledger.EditInput{a, b} {
		wg.Go(func() { results[i] = performEdit(t, f, 2, in) })
	}
	wg.Wait()
	committed, conflict := 0, 0
	var winner ledger.EditInput
	for i, out := range results {
		switch out.Kind {
		case "COMMITTED":
			committed++
			winner = []ledger.EditInput{a, b}[i]
		case "CONFLICT":
			conflict++
		}
	}
	if committed != 1 || conflict != 1 {
		t.Fatalf("lost update: %+v", results)
	}
	for range 8 {
		wg.Go(func() {
			out := performEdit(t, f, 2, winner)
			if out.Kind != "COMMITTED" || out.Record.Version != 2 {
				t.Errorf("duplicate: %+v", out)
			}
		})
	}
	wg.Wait()
	var events, versions int
	if err := f.admin.QueryRow(f.ctx, `SELECT count(*) FROM app.expense_revisions WHERE id=$1`, mustRaw(t, f.original.Record.ExpenseID, "Expense")).Scan(&versions); err != nil {
		t.Fatal(err)
	}
	if err := f.admin.QueryRow(f.ctx, `SELECT count(*) FROM app.financial_records WHERE group_id=$1`, f.id(201)).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if versions != 2 || events != 2 {
		t.Fatalf("duplicate effect: versions=%d events=%d", versions, events)
	}
}

func mustRaw(t *testing.T, id, kind string) string {
	t.Helper()
	raw, err := ledger.ParseID(id, kind)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestEditSavedFormerZeroParticipantLockAndRecoveryAfterDeparture(t *testing.T) {
	f := newExpenseFixture(t)
	// Remove the first record's nonzero position before making the target member
	// a saved zero participant; lifecycle policy still enforces exact zero departure.
	in := editInput(f)
	in.PayerID = f.public("Membership", 301)
	in.ParticipantIDs = []string{f.public("Membership", 301), f.public("Membership", 302)}
	in.Split = "EXACT"
	in.ExactAllocations = []ledger.Allocation{{ParticipantID: f.public("Membership", 301), Amount: 1000}, {ParticipantID: f.public("Membership", 302), Amount: 0}}
	saved := performEdit(t, f, 1, in)
	if saved.Kind != "COMMITTED" {
		t.Fatal(saved)
	}
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.memberships SET active=false WHERE id='%s'; RESET ROLE`, f.id(302)))
	read := readEdited(t, f)
	if read.Records[0].CanEdit || read.Records[0].EditLockReason != "FORMER_MEMBER" {
		t.Fatalf("read capability: %+v", read.Records[0])
	}
	blocked := in
	blocked.Key = uuid.NewString()
	blocked.ExpectedVersion = 2
	blocked.Note = "metadata only"
	blocked.ParticipantIDs = []string{f.public("Membership", 301)}
	blocked.ExactAllocations = []ledger.Allocation{{ParticipantID: f.public("Membership", 301), Amount: 1000}}
	if out := performEdit(t, f, 1, blocked); out.Kind != "LOCKED" || out.LockReason != "FORMER_MEMBER" {
		t.Fatalf("removing saved member bypassed lock: %+v", out)
	}
	// Both mutation retry and explicit recovery use the immutable operation before
	// rejecting based on the now-departed saved participant or later version.
	if out := performEdit(t, f, 1, in); out.Kind != "COMMITTED" || out.Record.Version != 2 {
		t.Fatalf("retry after departure: %+v", out)
	}
	verifiedEditCall(t, f, 1, func(ctx context.Context) {
		out, err := expense.New(f.db).RecoverEdit(ctx, in.GroupID, in.Key)
		if err != nil || out.Kind != "COMMITTED" || out.Record.Version != 2 {
			t.Fatalf("recovery: %+v %v", out, err)
		}
	})
	verifiedEditCall(t, f, 2, func(ctx context.Context) {
		_, err := expense.New(f.db).RecoverEdit(ctx, in.GroupID, in.Key)
		if !errors.Is(err, expense.Failure("NOT_FOUND")) {
			t.Fatalf("departed actor recovery: %v", err)
		}
	})
	verifiedEditCall(t, f, 4, func(ctx context.Context) {
		_, err := expense.New(f.db).Edit(ctx, blocked)
		if !errors.Is(err, expense.Failure("NOT_FOUND")) {
			t.Fatalf("cross-group write: %v", err)
		}
	})
}

func TestEditSettledExpensePreservesActualRepayment(t *testing.T) {
	f := newExpenseFixture(t)
	in := editInput(f)
	in.Total = 10000
	in.PayerID = f.public("Membership", 301)
	in.ParticipantIDs = []string{f.public("Membership", 301), f.public("Membership", 302)}
	if out := performEdit(t, f, 1, in); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	call := repaymentEndpoint(t, f, f.db)
	repayment := ledger.RepaymentInput{GroupID: in.GroupID, Key: uuid.NewString(), SenderID: f.public("Membership", 302), RecipientID: f.public("Membership", 301), Amount: 5000, Currency: "USD", EffectiveDate: "2026-10-06", Note: "Actual transfer"}
	transfer := repaymentRecord(t, call, 2, repayment)
	if read := readEdited(t, f); !read.Balance.Settled || !read.Records[0].CanEdit {
		t.Fatalf("active settled expense locked: %+v", read)
	}
	correction := in
	correction.Key = uuid.NewString()
	correction.ExpectedVersion = 2
	correction.Total = 8000
	out := performEdit(t, f, 1, correction)
	if out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	read := readEdited(t, f)
	if read.Total != 8000 || len(read.Balance.Obligations) != 1 || read.Balance.Obligations[0].From != f.public("Membership", 301) || read.Balance.Obligations[0].To != f.public("Membership", 302) || read.Balance.Obligations[0].Amount != 1000 {
		t.Fatalf("settled correction balances: %+v", read.Balance)
	}
	var history expense.Outcome
	if code := call(2, "/recover", repayment, &history); code != 200 || history.Repayment.AmountMinor != 5000 || history.Repayment.RepaymentID != transfer.Repayment.RepaymentID {
		t.Fatalf("repayment changed: %+v", history)
	}
	// Both signs of nonzero balance still forbid departure after correction.
	for _, member := range []int{301, 302} {
		_, err := f.admin.Exec(f.ctx, fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.memberships SET active=false WHERE id='%s'; RESET ROLE`, f.id(member)))
		if err == nil {
			t.Fatal("nonzero member departed after correction")
		}
		if _, err := f.admin.Exec(f.ctx, "RESET ROLE"); err != nil {
			t.Fatal(err)
		}
	}
}

func TestEditSavedDisabledAccountAndProposedCrossGroupValidation(t *testing.T) {
	f := newExpenseFixture(t)
	in := editInput(f)
	in.PayerID = f.public("Membership", 304)
	if out := performEdit(t, f, 1, in); out.Kind != "VALIDATION" {
		t.Fatalf("cross-group payer: %+v", out)
	}
	in = editInput(f)
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.users SET enabled=false WHERE id='%s'; RESET ROLE`, f.id(102)))
	read := readEdited(t, f)
	if read.Records[0].CanEdit || read.Records[0].EditLockReason != "INELIGIBLE_MEMBER" {
		t.Fatalf("private account eligibility: %+v", read.Records[0])
	}
	if out := performEdit(t, f, 1, in); out.Kind != "LOCKED" || out.LockReason != "INELIGIBLE_MEMBER" {
		t.Fatalf("disabled participant lock: %+v", out)
	}
	// Account re-enable is deliberately unsupported by the existing identity
	// contract; a same-key retry must preserve the rejected result while disabled.
	if out := performEdit(t, f, 1, in); out.Kind != "LOCKED" {
		t.Fatalf("retry applied a rejected edit: %+v", out)
	}
}

func TestEditLostCommitAcknowledgementRecoversOriginal(t *testing.T) {
	f := newExpenseFixture(t)
	proxyURL, dropped := commitLossProxy(t, f.runtime)
	db, err := database.Open(f.ctx, database.Config{URL: proxyURL, MaxConns: 2, Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	in := editInput(f)
	verifiedEditCall(t, f, 2, func(ctx context.Context) {
		out, err := expense.New(db).Edit(ctx, in)
		if err != nil || out.Kind != "UNKNOWN" {
			t.Fatalf("lost commit acknowledgement: %+v %v", out, err)
		}
	})
	select {
	case <-dropped:
	case <-time.After(2 * time.Second):
		t.Fatal("commit reply not dropped")
	}
	verifiedEditCall(t, f, 2, func(ctx context.Context) {
		out, err := expense.New(f.db).RecoverEdit(ctx, in.GroupID, in.Key)
		if err != nil || out.Kind != "COMMITTED" || out.Record.Version != 2 {
			t.Fatalf("new service recovery: %+v %v", out, err)
		}
	})
	if out := performEdit(t, f, 2, in); out.Kind != "COMMITTED" || out.Record.Version != 2 {
		t.Fatalf("duplicate lost response retry: %+v", out)
	}
}

func TestEditTargetedReadmissionUnlocksSameSavedMembership(t *testing.T) {
	f := newExpenseFixture(t)
	in := editInput(f)
	in.PayerID = f.public("Membership", 301)
	in.ParticipantIDs = []string{f.public("Membership", 301), f.public("Membership", 302)}
	in.Split = "EXACT"
	in.ExactAllocations = []ledger.Allocation{{ParticipantID: f.public("Membership", 301), Amount: 1000}, {ParticipantID: f.public("Membership", 302), Amount: 0}}
	if out := performEdit(t, f, 1, in); out.Kind != "COMMITTED" {
		t.Fatal(out)
	}
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.memberships SET active=false WHERE id='%s'; RESET ROLE`, f.id(302)))
	protector, err := invitation.NewProtector("edit-readmission", map[string][]byte{"edit-readmission": make([]byte, 32)})
	if err != nil {
		t.Fatal(err)
	}
	email := f.id(2) + "@example.invalid"
	service, err := invitation.New(f.db, protector, membershipEmailProvider{emails: map[string]string{f.id(1): f.id(1) + "@example.invalid", f.id(2): email}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		f.exec(fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; DELETE FROM app.invitation_delivery WHERE action_id IN(SELECT id FROM app.invitation_actions WHERE group_id='%s'); DELETE FROM app.invitation_actions WHERE group_id='%s'; DELETE FROM app.invitations WHERE group_id='%s'; COMMIT`, f.id(201), f.id(201), f.id(201)))
	})
	invite, err := service.Create(membershipAuthenticatedContext(t, f, 1), uuid.MustParse(f.id(201)), email, uuid.New())
	if err != nil || invite.Outcome != "SAVED" {
		t.Fatalf("new invitation: %+v %v", invite, err)
	}
	var cipher []byte
	var key string
	if err = f.admin.QueryRow(f.ctx, `SELECT token_cipher,token_key FROM app.invitations WHERE id=$1`, invite.InvitationID).Scan(&cipher, &key); err != nil {
		t.Fatal(err)
	}
	token, err := protector.Decrypt(cipher, key, "TARGETED:"+invite.InvitationID.String())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Preview(f.ctx, string(token)); err != nil {
		t.Fatal(err)
	}
	if readEdited(t, f).Records[0].CanEdit {
		t.Fatal("invitation preview unlocked expense")
	}
	accepted, err := service.Accept(membershipAuthenticatedContext(t, f, 2), string(token), uuid.New())
	if err != nil || accepted.Outcome != "ADMITTED" || accepted.MembershipID.String() != f.id(302) {
		t.Fatalf("stable readmission: %+v %v", accepted, err)
	}
	if !readEdited(t, f).Records[0].CanEdit {
		t.Fatal("eligible same-identity readmission failed to unlock")
	}
	in.Key = uuid.NewString()
	in.ExpectedVersion = 2
	in.Note = "reviewed after return"
	if out := performEdit(t, f, 1, in); out.Kind != "COMMITTED" {
		t.Fatalf("fresh reviewed edit: %+v", out)
	}
}
