//go:build integration

package banking

import (
	"context"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/reportingtimezone"
)

type replacementFixture struct {
	*fixture
	enrollment                         *EnrollmentService
	provider                           *controlledEnrollmentProvider
	account, oldBinding, oldConnection uuid.UUID
}

func newReplacementFixture(t *testing.T) *replacementFixture {
	t.Helper()
	f := newFixture(t)
	provider := newControlledProvider()
	enrollment, err := NewEnrollment(f.service, provider, EnrollmentConfig{Enabled: true, Environment: "sandbox", WebhookOrigin: "https://api.example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	rf := &replacementFixture{fixture: f, enrollment: enrollment, provider: provider}
	t.Cleanup(func() {
		// These owners were created by this test in the disposable database. Remove
		// their scheduler-visible state before another worker/keyring fixture runs.
		f.exec(`INSERT INTO app.banking_account_barriers(account_id,owner_id,connection_id,generation) SELECT DISTINCT ON(b.account_id) b.account_id,b.owner_id,b.connection_id,1 FROM app.banking_bindings b WHERE b.owner_id IN($1,$2) ON CONFLICT DO NOTHING`, f.owner, f.other)
		for _, table := range []string{"captures", "archives", "plan_sources", "plan_intervals", "plans", "annotations", "source_revisions", "sources", "repairs"} {
			if table == "source_revisions" {
				f.exec(`UPDATE app.banking_sources SET revision=NULL WHERE owner_id IN($1,$2)`, f.owner, f.other)
			}
			f.exec(`DELETE FROM app.banking_`+table+` WHERE owner_id IN($1,$2)`, f.owner, f.other)
		}
		for _, query := range []string{
			`DELETE FROM app.banking_enrollment_jobs WHERE attempt_id IN(SELECT id FROM app.banking_enrollments WHERE owner_id IN($1,$2))`,
			`DELETE FROM app.banking_enrollment_receipts WHERE attempt_id IN(SELECT id FROM app.banking_enrollments WHERE owner_id IN($1,$2))`,
			`DELETE FROM app.banking_enrollment_removals WHERE attempt_id IN(SELECT id FROM app.banking_enrollments WHERE owner_id IN($1,$2))`,
			`DELETE FROM app.banking_webhook_deliveries WHERE correlation_id IN(SELECT id FROM app.banking_webhook_correlations WHERE connection_id IN(SELECT id FROM app.banking_connections WHERE owner_id IN($1,$2)))`,
			`DELETE FROM app.banking_webhook_receipts WHERE correlation_id IN(SELECT id FROM app.banking_webhook_correlations WHERE connection_id IN(SELECT id FROM app.banking_connections WHERE owner_id IN($1,$2)))`,
			`DELETE FROM app.banking_webhook_correlations WHERE connection_id IN(SELECT id FROM app.banking_connections WHERE owner_id IN($1,$2))`,
			`DELETE FROM app.banking_enrollment_accounts WHERE owner_id IN($1,$2)`,
			`DELETE FROM app.banking_reconciliation WHERE binding_id IN(SELECT id FROM app.banking_bindings WHERE owner_id IN($1,$2))`,
			`DELETE FROM app.banking_bindings WHERE owner_id IN($1,$2)`,
			`DELETE FROM app.banking_accounts WHERE owner_id IN($1,$2)`,
			`DELETE FROM app.banking_enrollments WHERE owner_id IN($1,$2)`,
			`DELETE FROM app.banking_work WHERE connection_id IN(SELECT id FROM app.banking_connections WHERE owner_id IN($1,$2))`,
			`DELETE FROM app.banking_credentials WHERE owner_id IN($1,$2)`,
			`DELETE FROM app.banking_connections WHERE owner_id IN($1,$2)`,
		} {
			f.exec(query, f.owner, f.other)
		}
	})
	if result := reportingtimezone.New(f.db).Initialize(f.actor(f.owner), uuid.NewString(), nil); result.Code != "READY" {
		t.Fatal(result.Code)
	}
	attempt := uuid.New()
	if result := enrollment.Start(f.actor(f.owner), StartEnrollmentInput{AttemptID: attempt, Intent: "different"}); result.Code != "PREPARED" {
		t.Fatal(result.Code)
	}
	result := enrollment.Finish(f.actor(f.owner), FinishEnrollmentInput{AttemptID: attempt, PublicToken: "public-" + attempt.String(), AccountIDs: []string{"checking", "savings"}})
	if result.Code != "AWAITING_INITIAL_IMPORT" {
		t.Fatal(result.Code)
	}
	rf.oldConnection = result.ConnectionID
	if err := f.admin.QueryRow(context.Background(), `SELECT account_id,id FROM app.banking_bindings WHERE connection_id=$1 AND provider_account_id='checking'`, result.ConnectionID).Scan(&rf.account, &rf.oldBinding); err != nil {
		t.Fatal(err)
	}
	rf.usable(rf.oldBinding)
	return rf
}
func (f *replacementFixture) usable(binding uuid.UUID) {
	f.t.Helper()
	f.exec(`UPDATE app.banking_bindings SET import_state='usable',import_revision=import_revision+1 WHERE id=$1`, binding)
}
func (f *replacementFixture) stage() uuid.UUID {
	f.t.Helper()
	attempt := uuid.New()
	result := f.enrollment.Start(f.actor(f.owner), StartEnrollmentInput{AttemptID: attempt, Intent: "existing", ReplacementAccountID: f.account})
	if result.Code != "PREPARED" {
		f.t.Fatalf("replacement start: %s", result.Code)
	}
	result = f.enrollment.Finish(f.actor(f.owner), FinishEnrollmentInput{AttemptID: attempt, PublicToken: "public-" + attempt.String(), AccountIDs: []string{"checking"}})
	if result.Code != "AWAITING_INITIAL_IMPORT" {
		f.t.Fatalf("replacement finish: %s", result.Code)
	}
	var binding uuid.UUID
	if err := f.admin.QueryRow(context.Background(), `SELECT id FROM app.banking_bindings WHERE connection_id=$1 AND account_id=$2 AND reporting_state='staged'`, result.ConnectionID, f.account).Scan(&binding); err != nil {
		f.t.Fatal(err)
	}
	return binding
}
func (f *replacementFixture) row(binding uuid.UUID, date, amount, processing string, excluded bool) uuid.UUID {
	f.t.Helper()
	var cg, bg int64
	if err := f.admin.QueryRow(context.Background(), `SELECT c.generation,b.generation FROM app.banking_bindings b JOIN app.banking_connections c ON c.id=b.connection_id WHERE b.id=$1`, binding).Scan(&cg, &bg); err != nil {
		f.t.Fatal(err)
	}
	result := f.service.RecordSource(f.actor(f.owner), SourceInput{AttemptID: uuid.New(), BindingID: binding, ProviderTransactionID: uuid.NewString(), ConnectionGeneration: cg, BindingGeneration: bg, AmountMinor: amount, Currency: "USD", BankDate: date, ProcessingState: processing, MappingVersion: "controlled-pfc-v2"})
	if result.Code != "READY" {
		f.t.Fatalf("source: %s", result.Code)
	}
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,activity,note,excluded) VALUES($1,$2,1,1,'purchase','original private note',$3)`, result.ID, f.owner, excluded)
	return result.ID
}
func (f *replacementFixture) preview(binding uuid.UUID, date, action string) ReplacementPreview {
	f.t.Helper()
	p := f.service.PreviewReplacement(f.actor(f.owner), ReplacementRequest{AccountID: f.account, BindingID: binding, TransitionDate: date, Action: action})
	if p.Code != "READY" {
		f.t.Fatalf("preview %s: %s", action, p.Code)
	}
	return p
}
func (f *replacementFixture) confirm(p ReplacementPreview) Result {
	f.t.Helper()
	result := f.service.ConfirmReplacement(f.actor(f.owner), ReplacementConfirmation{AttemptID: uuid.New(), Request: p.Request, Expected: p.Revisions})
	if result.Code != "READY" {
		f.t.Fatalf("confirm: %s", result.Code)
	}
	return result
}

func TestReplacementPersistedWorkedBoundariesAndRecovery(t *testing.T) {
	f := newReplacementFixture(t)
	june := f.row(f.oldBinding, "2026-06-12", "2000", "posted", false)
	excluded := f.row(f.oldBinding, "2026-09-20", "10000", "posted", true)
	f.row(f.oldBinding, "2026-09-30", "300", "posted", false)
	oldAfter := f.row(f.oldBinding, "2026-10-01", "900", "posted", false)
	f.row(f.oldBinding, "2026-09-30", "2500", "pending", false)
	b := f.stage()
	f.row(b, "2026-09-20", "10000", "posted", false)
	f.row(b, "2026-09-30", "400", "posted", false)
	oct := f.row(b, "2026-10-02", "5000", "posted", false)
	f.row(b, "2026-10-11", "700", "posted", false)
	p := f.service.PreviewReplacement(f.actor(f.owner), ReplacementRequest{AccountID: f.account, BindingID: b, TransitionDate: "2026-09-30", Action: "ACTIVATE"})
	if p.Code != "IMPORT_UNAVAILABLE" {
		t.Fatal("unknown import activated", p.Code)
	}
	f.usable(b)
	p = f.preview(b, "2026-09-30", "ACTIVATE")
	if p.Prior.SpendingMinor != "3200" || p.Proposed.SpendingMinor != "8000" || p.Proposed.PendingCount != 0 || p.Overlap.Count != 2 || p.Retained.Count != 3 || p.Archived.Count != 2 || p.Coverage != "unknown" {
		t.Fatalf("unexpected boundary impacts: %#v", p)
	}
	command := ReplacementConfirmation{AttemptID: uuid.New(), Request: p.Request, Expected: p.Revisions}
	result := f.service.ConfirmReplacement(f.actor(f.owner), command)
	if result.Code != "READY" {
		t.Fatal(result.Code)
	}
	if replay := f.service.ConfirmReplacement(f.actor(f.owner), command); replay != result {
		t.Fatal("lost response retry changed receipt")
	}
	if status := f.service.OperationStatus(f.actor(f.owner), command.AttemptID); status != result {
		t.Fatal("status failed durable recovery")
	}
	command.Request.TransitionDate = "2026-09-29"
	if reuse := f.service.ConfirmReplacement(f.actor(f.owner), command); reuse.Code != "CONFLICT" {
		t.Fatal("changed input reused attempt")
	}
	if _, status := f.service.ReadSource(f.actor(f.owner), june); status.Code != "READY" {
		t.Fatal("June history disappeared")
	}
	// The retained exclusion/note remains the same source identity. Archive-only
	// later edits remain latest and become effective only after explicit recovery.
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,activity,note,excluded) VALUES($1,$3,2,1,'purchase','latest retained exclusion',true),($2,$3,2,1,'purchase','archive-only latest edit',true)`, excluded, oldAfter, f.owner)
	c := f.stage()
	f.usable(c)
	f.row(c, "2026-10-09", "1200", "posted", false)
	c11 := f.row(c, "2026-10-11", "800", "posted", false)
	f.row(c, "2026-10-13", "900", "posted", false)
	p = f.preview(c, "2026-10-10", "ACTIVATE")
	if len(p.Intervals) != 3 || p.Intervals[0].BindingID != f.oldBinding || *p.Intervals[0].ThroughDate != "2026-09-30" || p.Intervals[1].BindingID != b || p.Proposed.SpendingMinor != "9000" {
		t.Fatalf("repeated transition lost interval: %#v", p)
	}
	f.confirm(p)
	p = f.preview(uuid.Nil, "2026-10-12", "CHANGE_BOUNDARY")
	if p.Proposed.SpendingMinor != "8900" || p.Archived.Count != 1 || p.New.Count != 1 {
		t.Fatalf("changed boundary: %#v", p)
	}
	f.confirm(p)
	// First restore undoes the boundary adjustment; second follows the immutable
	// immediate predecessor and cannot jump over saved plans.
	p = f.preview(uuid.Nil, "", "RESTORE_PREDECESSOR")
	if p.Proposed.SpendingMinor != "9000" {
		t.Fatal("restore failed", p.Proposed.SpendingMinor)
	}
	f.confirm(p)
	// Captured original facts cannot be rewritten by a delayed retired generation.
	stale := sourceInput(f.oldBinding)
	stale.AmountMinor = "10"
	stale.BankDate = "2026-10-01"
	if got := f.service.RecordSource(f.actor(f.owner), stale); got.Code != "CONFLICT" {
		t.Fatal("retired source accepted write", got.Code)
	}
	var retired string
	if err := f.admin.QueryRow(context.Background(), `SELECT reporting_state FROM app.banking_bindings WHERE id=$1`, b).Scan(&retired); err != nil || retired != "retired" {
		t.Fatal("recovery reauthorized collection")
	}
	// Existing annotations remain attached to their original IDs; no guessed copy
	// is applied to same-looking replacement rows.
	var copies int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND note='latest retained exclusion'`, oct).Scan(&copies); err != nil || copies != 0 {
		t.Fatal("annotation copied across binding")
	}
	_ = c11
}

func TestReplacementPreviewGuardsAuthorizationCoverageAndCancellation(t *testing.T) {
	f := newReplacementFixture(t)
	old := f.row(f.oldBinding, "2026-09-20", "10000", "posted", true)
	b := f.stage()
	f.row(b, "2026-10-02", "5000", "posted", false)
	f.usable(b)
	p := f.preview(b, "2026-09-30", "ACTIVATE")
	if p.Proposed.SpendingMinor != "5000" {
		t.Fatal("excluded overlap counted")
	}
	for name, mutate := range map[string]func(){
		"import": func() { f.exec(`UPDATE app.banking_bindings SET import_revision=import_revision+1 WHERE id=$1`, b) },
		"annotation": func() {
			f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,activity,excluded) SELECT $1,$2,coalesce(max(revision),0)+1,1,'purchase',true FROM app.banking_annotations WHERE source_id=$1`, old, f.owner)
		},
		"data": func() { f.row(b, "2026-10-03", "1", "posted", false) },
		"lifecycle": func() {
			f.exec(`UPDATE app.banking_connections SET health='repair_required' WHERE id=$1`, f.oldConnection)
		},
		"plan": func() {
			f.exec(`INSERT INTO app.banking_plans(id,owner_id,account_id,revision,active_binding_id) VALUES($1,$2,$3,1,$4)`, uuid.New(), f.owner, f.account, f.oldBinding)
			var plan uuid.UUID
			if err := f.admin.QueryRow(context.Background(), `SELECT id FROM app.banking_plans WHERE account_id=$1`, f.account).Scan(&plan); err != nil {
				t.Fatal(err)
			}
			f.exec(`INSERT INTO app.banking_plan_intervals(plan_id,owner_id,binding_id) VALUES($1,$2,$3)`, plan, f.owner, f.oldBinding)
		},
	} {
		t.Run(name, func(t *testing.T) {
			p := f.preview(b, "2026-09-30", "ACTIVATE")
			mutate()
			result := f.service.ConfirmReplacement(f.actor(f.owner), ReplacementConfirmation{AttemptID: uuid.New(), Request: p.Request, Expected: p.Revisions})
			if result.Code != "CONFLICT" {
				t.Fatal("stale preview published", result.Code)
			}
		})
	}
	for _, date := range []string{"0000-12-31", "2026-02-29", "2026-13-01", "10000-01-01", "2027-01-01", "2026-9-30"} {
		if result := f.service.PreviewReplacement(f.actor(f.owner), ReplacementRequest{AccountID: f.account, BindingID: b, TransitionDate: date, Action: "ACTIVATE"}); result.Code != "INVALID_INPUT" {
			t.Fatalf("invalid date %s: %s", date, result.Code)
		}
	}
	other := f.service.PreviewReplacement(f.actor(f.other), p.Request)
	if other.Code != "NOT_FOUND" {
		t.Fatal("other owner read preview", other.Code)
	}
	f.exec(`UPDATE app.banking_bindings SET coverage_after='2026-10-02',coverage_through='2026-10-15' WHERE id=$1`, b)
	p = f.preview(b, "2026-09-30", "ACTIVATE")
	if p.Coverage != "known_gap" {
		t.Fatal("coverage gap hidden")
	}
	result := f.service.CancelReplacement(f.actor(f.owner), ReplacementConfirmation{AttemptID: uuid.New(), Request: p.Request, Expected: p.Revisions})
	if result.Code != "READY" {
		t.Fatal(result.Code)
	}
	if result := f.service.ConfirmReplacement(f.actor(f.owner), ReplacementConfirmation{AttemptID: uuid.New(), Request: p.Request, Expected: p.Revisions}); result.Code != "CONFLICT" {
		t.Fatal("cancelled stage published")
	}
}

func TestReplacementCompetingPublicationAndDeletion(t *testing.T) {
	f := newReplacementFixture(t)
	f.row(f.oldBinding, "2026-09-20", "100", "posted", false)
	b := f.stage()
	f.usable(b)
	f.row(b, "2026-10-02", "200", "posted", false)
	p := f.preview(b, "2026-09-30", "ACTIVATE")
	results := make(chan Result, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- f.service.ConfirmReplacement(f.actor(f.owner), ReplacementConfirmation{AttemptID: uuid.New(), Request: p.Request, Expected: p.Revisions})
		}()
	}
	wg.Wait()
	close(results)
	ready, conflicts := 0, 0
	for result := range results {
		switch result.Code {
		case "READY":
			ready++
		case "CONFLICT":
			conflicts++
		default:
			t.Fatal(result.Code)
		}
	}
	if ready != 1 || conflicts != 1 {
		t.Fatal("competing plans mixed")
	}
	recovery := f.preview(uuid.Nil, "", "RESTORE_PREDECESSOR")
	var replacementConnection uuid.UUID
	if err := f.admin.QueryRow(context.Background(), `SELECT connection_id FROM app.banking_bindings WHERE id=$1`, b).Scan(&replacementConnection); err != nil {
		t.Fatal(err)
	}
	lifecycle, status := f.service.ReadLifecycle(f.actor(f.owner), replacementConnection)
	if status.Code != "READY" {
		t.Fatal(status.Code)
	}
	if result := f.service.DeleteHistory(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: replacementConnection, ExpectedGeneration: lifecycle.Generation}); result.Code != "READY" {
		t.Fatal(result.Code)
	}
	if result := f.service.ConfirmReplacement(f.actor(f.owner), ReplacementConfirmation{AttemptID: uuid.New(), Request: recovery.Request, Expected: recovery.Revisions}); result.Code != "NOT_FOUND" {
		t.Fatal("deleted predecessor restored", result.Code)
	}
	var visible bool
	if err := f.admin.QueryRow(context.Background(), `SELECT EXISTS(SELECT FROM app.banking_bindings b JOIN app.banking_accounts a ON a.id=b.account_id WHERE b.connection_id=$1 AND b.account_id<>$2 AND a.selected)`, f.oldConnection, f.account).Scan(&visible); err != nil || !visible {
		t.Fatal("deletion affected sibling")
	}
}

func TestReplacementLateFinishCannotCrossTargetDeletion(t *testing.T) {
	f := newReplacementFixture(t)
	attempt := uuid.New()
	start := f.enrollment.Start(f.actor(f.owner), StartEnrollmentInput{AttemptID: attempt, Intent: "existing", ReplacementAccountID: f.account})
	if start.Code != "PREPARED" {
		t.Fatal(start.Code)
	}
	f.provider.beforeAccounts = func() {
		result := f.service.DeleteHistory(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: f.oldConnection, ExpectedGeneration: 1})
		if result.Code != "READY" {
			t.Fatal(result.Code)
		}
	}
	result := f.enrollment.Finish(f.actor(f.owner), FinishEnrollmentInput{AttemptID: attempt, PublicToken: "public-" + attempt.String(), AccountIDs: []string{"checking"}})
	if result.Code != "REPLACEMENT_REQUIRED" {
		t.Fatal("late Finish staged deleted logical account", result.Code)
	}
	var count int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_bindings WHERE account_id=$1 AND reporting_state='staged'`, f.account).Scan(&count); err != nil || count != 0 {
		t.Fatal("stale stage survived")
	}
}

func TestReplacementRestoreLatestEditsWithoutAuthorityAndMissingRequiredFacts(t *testing.T) {
	f := newReplacementFixture(t)
	original := f.row(f.oldBinding, "2026-10-02", "10000", "posted", false)
	f.row(f.oldBinding, "2026-09-30", "2500", "pending", false)
	b := f.stage()
	f.usable(b)
	f.row(b, "2026-10-02", "5000", "posted", false)
	f.confirm(f.preview(b, "2026-09-30", "ACTIVATE"))
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,activity,note,excluded) VALUES($1,$2,2,1,'purchase','latest archive-only edit',true)`, original, f.owner)
	p := f.preview(uuid.Nil, "", "RESTORE_PREDECESSOR")
	if p.Proposed.SpendingMinor != "0" || p.Proposed.PendingCount != 0 || p.Archived.SpendingMinor != "5000" {
		t.Fatalf("restore did not use latest valid annotations/retired pending: %#v", p)
	}
	f.confirm(p)
	var state string
	if err := f.admin.QueryRow(context.Background(), `SELECT reporting_state FROM app.banking_bindings WHERE id=$1`, f.oldBinding).Scan(&state); err != nil || state != "retired" {
		t.Fatal("restore restarted original collection")
	}
	// Required captured facts are checked independently of a plan's row count.
	// A deletion barrier hides the entire account immediately; the sole purge
	// worker remains responsible for physical records across all bindings.
	lifecycle, status := f.service.ReadLifecycle(f.actor(f.owner), f.oldConnection)
	if status.Code != "READY" {
		t.Fatal(status.Code)
	}
	if result := f.service.DeleteHistory(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: f.oldConnection, ExpectedGeneration: lifecycle.Generation}); result.Code != "READY" {
		t.Fatal(result.Code)
	}
	if p := f.service.PreviewReplacement(f.actor(f.owner), ReplacementRequest{AccountID: f.account, Action: "RESTORE_PREDECESSOR"}); p.Code != "NOT_FOUND" {
		t.Fatal("purged/hidden predecessor available", p.Code)
	}
}

func TestReplacementStoredCrossBoundaryDiscrepancyPreservesCapturedFact(t *testing.T) {
	f := newReplacementFixture(t)
	f.row(f.oldBinding, "2026-09-20", "10000", "posted", true)
	b := f.stage()
	f.usable(b)
	source := f.row(b, "2026-10-02", "5000", "posted", false)
	f.confirm(f.preview(b, "2026-09-30", "ACTIVATE"))
	// #251 owns ingestion. This controlled persisted correction records the exact
	// discrepancy state and source revision that its future writer must preserve.
	f.exec(`INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,amount_minor,currency,bank_date,processing_state,mapping_version,stage) VALUES($1,$2,2,5000,'USD','2026-09-29','posted','controlled-pfc-v2','current')`, source, f.owner)
	f.exec(`UPDATE app.banking_sources SET revision=2,discrepancy='cross_boundary_change' WHERE id=$1`, source)
	p := f.preview(uuid.Nil, "2026-10-01", "CHANGE_BOUNDARY")
	if p.DiscrepancyCount != 1 || p.Prior.SpendingMinor != "5000" || p.Proposed.SpendingMinor != "5000" {
		t.Fatal("cross-boundary correction silently changed captured fact", p.Prior.SpendingMinor, p.Proposed.SpendingMinor, p.DiscrepancyCount)
	}
}

func TestReplacementFailedUsabilityAndPriorBoundaryValidation(t *testing.T) {
	f := newReplacementFixture(t)
	f.row(f.oldBinding, "2026-09-20", "100", "posted", false)
	b := f.stage()
	f.usable(b)
	f.confirm(f.preview(b, "2026-09-30", "ACTIVATE"))
	c := f.stage()
	f.usable(c)
	for _, date := range []string{"2026-09-29", "2026-09-30"} {
		p := f.service.PreviewReplacement(f.actor(f.owner), ReplacementRequest{AccountID: f.account, BindingID: c, TransitionDate: date, Action: "ACTIVATE"})
		if p.Code != "INVALID_INPUT" {
			t.Fatal("reversed boundary accepted", p.Code)
		}
	}
	for _, state := range []string{"failed", "unavailable", "unknown", "loading"} {
		f.exec(`UPDATE app.banking_bindings SET import_state=$2 WHERE id=$1`, c, state)
		p := f.service.PreviewReplacement(f.actor(f.owner), ReplacementRequest{AccountID: f.account, BindingID: c, TransitionDate: "2026-10-10", Action: "ACTIVATE"})
		if p.Code != "IMPORT_UNAVAILABLE" {
			t.Fatal("unusable import accepted", state, p.Code)
		}
	}
	// Even when impact/publication is blocked, the enabled owner can use the
	// coherent guards to cancel the failed stage without changing the current plan.
	failed := f.service.PreviewReplacement(f.actor(f.owner), ReplacementRequest{AccountID: f.account, BindingID: c, TransitionDate: "2026-10-10", Action: "ACTIVATE"})
	if result := f.service.CancelReplacement(f.actor(f.owner), ReplacementConfirmation{AttemptID: uuid.New(), Request: failed.Request, Expected: failed.Revisions}); result.Code != "READY" {
		t.Fatal("unusable import could not cancel", result.Code)
	}
	var plans int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_plans WHERE account_id=$1`, f.account).Scan(&plans); err != nil || plans != 2 {
		t.Fatal("cancellation changed the prior reporting plan")
	}

}

func TestReplacementWrongLogicalAccountCannotBypassExactIdentity(t *testing.T) {
	f := newReplacementFixture(t)
	var sibling uuid.UUID
	if err := f.admin.QueryRow(context.Background(), `SELECT account_id FROM app.banking_bindings WHERE connection_id=$1 AND provider_account_id='savings'`, f.oldConnection).Scan(&sibling); err != nil {
		t.Fatal(err)
	}
	// Select a distinct checking logical account as the explicit target. The
	// provider checking identity already belongs to the original target instead.
	f.exec(`UPDATE app.banking_accounts SET kind='checking' WHERE id=$1`, sibling)
	attempt := uuid.New()
	start := f.enrollment.Start(f.actor(f.owner), StartEnrollmentInput{AttemptID: attempt, Intent: "existing", ReplacementAccountID: sibling})
	if start.Code != "PREPARED" {
		t.Fatal(start.Code)
	}
	finish := f.enrollment.Finish(f.actor(f.owner), FinishEnrollmentInput{AttemptID: attempt, PublicToken: "public-" + attempt.String(), AccountIDs: []string{"checking"}})
	if finish.Code != "DUPLICATE_ACCOUNT" {
		t.Fatal("wrong target bypassed exact identity", finish.Code)
	}
	var count int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_account_identities WHERE owner_id=$1 AND stable_id='stable-checking' AND account_id=$2`, f.owner, f.account).Scan(&count); err != nil || count != 1 {
		t.Fatal("original exact identity was not preserved")
	}
}

func TestReplacementRetiredSelectionAndActualCompletePurge(t *testing.T) {
	f := newReplacementFixture(t)
	f.row(f.oldBinding, "2026-09-20", "100", "posted", false)
	b := f.stage()
	f.usable(b)
	f.row(b, "2026-10-02", "200", "posted", false)
	f.confirm(f.preview(b, "2026-09-30", "ACTIVATE"))
	old, status := f.service.ReadLifecycle(f.actor(f.owner), f.oldConnection)
	if status.Code != "READY" {
		t.Fatal(status.Code)
	}
	result := f.enrollment.ChangeSelection(f.actor(f.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: f.oldConnection, ExpectedGeneration: old.Generation, AccountIDs: []string{"checking", "savings"}})
	if result.Code != "REPLACEMENT_REQUIRED" {
		t.Fatal("ordinary selection reenabled retired binding", result.Code)
	}
	repairID := uuid.New()
	repair := f.enrollment.StartRepair(f.actor(f.owner), RepairInput{AttemptID: repairID, ConnectionID: f.oldConnection, ExpectedGeneration: old.Generation})
	if repair.Code != "PREPARED" {
		t.Fatal("repair preparation failed", repair.Code)
	}
	repaired := f.enrollment.FinishRepair(f.actor(f.owner), FinishRepairInput{AttemptID: repairID, AccountIDs: []string{"checking", "savings"}})
	if repaired.Code != "REPLACEMENT_REQUIRED" {
		t.Fatal("repair reenabled retired source", repaired.Code)
	}
	// Restoration leaves the old binding retired, including with selected siblings.
	restore := f.preview(uuid.Nil, "", "RESTORE_PREDECESSOR")
	f.confirm(restore)
	fresh := sourceInput(f.oldBinding)
	fresh.AmountMinor = "10"
	if err := f.admin.QueryRow(context.Background(), `SELECT c.generation,b.generation FROM app.banking_bindings b JOIN app.banking_connections c ON c.id=b.connection_id WHERE b.id=$1`, f.oldBinding).Scan(&fresh.ConnectionGeneration, &fresh.BindingGeneration); err != nil {
		t.Fatal(err)
	}
	if result := f.service.RecordSource(f.actor(f.owner), fresh); result.Code != "CONFLICT" {
		t.Fatal("fresh retired generation collected", result.Code)
	}
	// Delete only the replacement Item: the target account and every historical
	// binding/archive are affected, while the original Item's savings survives.
	var connection uuid.UUID
	if err := f.admin.QueryRow(context.Background(), `SELECT connection_id FROM app.banking_bindings WHERE id=$1`, b).Scan(&connection); err != nil {
		t.Fatal(err)
	}
	f.exec(`DELETE FROM app.banking_work`)
	f.exec(`SELECT pgmq.purge_queue('banking_lifecycle')`)
	lifecycle, _ := f.service.ReadLifecycle(f.actor(f.owner), connection)
	if result := f.service.DeleteHistory(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: lifecycle.Generation}); result.Code != "READY" {
		t.Fatal(result.Code)
	}
	db, err := database.OpenWorker(context.Background(), database.Config{URL: os.Getenv("TEST_WORKER_DATABASE_URL"), MaxConns: 3, Timeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	worker, err := NewWorker(db, f.service.protector, f.provider)
	if err != nil {
		t.Fatal(err)
	}
	for range 30 {
		worked, err := worker.ProcessOne(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if !worked {
			break
		}
	}
	for _, table := range []string{"accounts", "bindings", "plans", "account_identities"} {
		var n int
		query := `SELECT count(*) FROM app.banking_` + table + ` WHERE account_id=$1`
		if table == "accounts" {
			query = `SELECT count(*) FROM app.banking_accounts WHERE id=$1`
		}
		if err := f.admin.QueryRow(context.Background(), query, f.account).Scan(&n); err != nil || n != 0 {
			t.Fatal("replacement private data not purged", table, n, err)
		}
	}
	var siblings int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_bindings WHERE connection_id=$1 AND provider_account_id='savings'`, f.oldConnection).Scan(&siblings); err != nil || siblings != 1 {
		t.Fatal("purge removed unrelated sibling")
	}
}

func TestReplacementLateFinishCannotCrossTargetStop(t *testing.T) {
	f := newReplacementFixture(t)
	attempt := uuid.New()
	start := f.enrollment.Start(f.actor(f.owner), StartEnrollmentInput{AttemptID: attempt, Intent: "existing", ReplacementAccountID: f.account})
	if start.Code != "PREPARED" {
		t.Fatal(start.Code)
	}
	f.provider.beforeAccounts = func() {
		result := f.service.Stop(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: f.oldConnection, ExpectedGeneration: 1})
		if result.Code != "READY" {
			t.Fatal(result.Code)
		}
	}
	result := f.enrollment.Finish(f.actor(f.owner), FinishEnrollmentInput{AttemptID: attempt, PublicToken: "public-" + attempt.String(), AccountIDs: []string{"checking"}})
	if result.Code != "REPLACEMENT_REQUIRED" {
		t.Fatal("late Finish crossed target stop", result.Code)
	}
}
