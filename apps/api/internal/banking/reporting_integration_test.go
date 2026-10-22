//go:build integration

package banking

import (
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/reportingtimezone"
)

func reportRange(account uuid.UUID) ReportRequest {
	return ReportRequest{First: 2, Filter: ReportFilter{Period: "CUSTOM", Start: "2026-01-01", End: "2026-10-17", Accounts: []string{account.String()}}}
}
func TestReportCompletePagingEditsAndOwnerBoundaries(t *testing.T) {
	f := newFixture(t)
	ctx, other := f.actor(f.owner), f.actor(f.other)
	requireCode(t, Result{Code: reportingtimezone.New(f.db).Initialize(other, uuid.NewString(), nil).Code}, "READY")
	connection := f.connection(f.owner, "reporting-private")
	account, binding := f.binding(f.owner, connection, "checking")
	requireCode(t, Result{Code: reportingtimezone.New(f.db).Initialize(ctx, uuid.NewString(), nil).Code}, "READY")
	f.exec(`UPDATE app.banking_bindings SET import_state='usable',coverage_after='2025-12-31',coverage_through='2026-10-17' WHERE id=$1`, binding)
	var first uuid.UUID
	for n := 0; n < 105; n++ {
		input := sourceInput(binding)
		input.ProviderTransactionID = uuid.NewString()
		input.AmountMinor = "100"
		input.BankDate = "2026-10-02"
		created := f.service.RecordSource(ctx, input)
		requireCode(t, created, "READY")
		if n == 0 {
			first = created.ID
		}
		f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,activity) VALUES($1,$2,1,1,'purchase')`, created.ID, f.owner)
	}
	request := reportRange(account)
	report := f.service.ReadReport(ctx, request)
	if report.Code != "READY" || report.TotalCount != 105 || report.Summary.NetMinor != "10500" || len(report.Rows) != 2 || !report.HasNextPage || report.Accounts[0].Coverage != "COMPLETE" {
		t.Fatalf("complete report %+v", report)
	}
	seen := map[string]bool{}
	for _, r := range report.Rows {
		seen[r.ID] = true
	}
	request.After = *report.EndCursor
	page := f.service.ReadReport(ctx, request)
	if page.Code != "READY" || page.Summary.NetMinor != "10500" {
		t.Fatalf("page %+v", page)
	}
	for _, r := range page.Rows {
		if seen[r.ID] {
			t.Fatal("duplicate across pages")
		}
	}
	foreign := f.service.ReadReport(other, request)
	if foreign.Code != "NOT_FOUND" || foreign.Summary != nil {
		t.Fatal("foreign account/pagination disclosed data", foreign.Code)
	}
	if d := f.service.ReadTransaction(other, first.String(), ""); d.Code != "NOT_FOUND" || d.Transaction != nil || d.CurrentID != nil {
		t.Fatal("nested/detail disclosed data")
	}
	edit := AnnotationInput{AttemptID: uuid.New(), SourceID: first, SourceRevision: 1, ExpectedRevision: 1, MaterialRevision: 1, Field: "note", Value: textPointer("private draft")}
	requireCode(t, f.service.EditAnnotation(other, edit), "NOT_FOUND")
	noteAttempt := edit.AttemptID
	saved := f.service.EditAnnotation(ctx, edit)
	requireCode(t, saved, "READY")
	if f.service.EditAnnotation(ctx, edit) != saved || f.service.OperationStatus(ctx, edit.AttemptID) != saved {
		t.Fatal("uncertain outcome replay changed")
	}
	edit.Value = textPointer("changed")
	requireCode(t, f.service.EditAnnotation(ctx, edit), "CONFLICT")
	if r := f.service.ReadReport(ctx, request); r.Code != "RESTART_REQUIRED" || r.Summary != nil {
		t.Fatal("annotation did not invalidate whole snapshot")
	}
	current := f.service.ReadReport(ctx, reportRange(account))
	if current.Summary.NetMinor != "10500" {
		t.Fatal("note changed spending")
	}
	edit.AttemptID = uuid.New()
	edit.ExpectedRevision = 2
	edit.Field = "excluded"
	edit.Value = textPointer("true")
	requireCode(t, f.service.EditAnnotation(ctx, edit), "READY")
	current = f.service.ReadReport(ctx, reportRange(account))
	if current.Summary.NetMinor != "10400" || current.Summary.ExcludedCount != 1 {
		t.Fatal("exclusion not reconciled")
	}
	edit.AttemptID = uuid.New()
	edit.ExpectedRevision = 3
	edit.Value = nil
	requireCode(t, f.service.EditAnnotation(ctx, edit), "READY")
	detail := f.service.ReadTransaction(ctx, first.String(), "")
	if detail.Transaction.Note == nil || *detail.Transaction.Note != "private draft" || detail.Transaction.Excluded {
		t.Fatal("reset changed another field")
	}
	// Concurrent drafts cannot overwrite each other, even on different attempts.
	edit.ExpectedRevision = 4
	edit.Field = "note"
	edit.Value = textPointer("competing draft")
	codes := make(chan string, 2)
	var wg sync.WaitGroup
	for n := 0; n < 2; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			i := edit
			i.AttemptID = uuid.New()
			codes <- f.service.EditAnnotation(ctx, i).Code
		}()
	}
	wg.Wait()
	close(codes)
	counts := map[string]int{}
	for c := range codes {
		counts[c]++
	}
	if counts["READY"] != 1 || counts["CONFLICT"] != 1 {
		t.Fatal("concurrent edit lost update", counts)
	}
	request = reportRange(account)
	current = f.service.ReadReport(ctx, request)
	request.After = *current.EndCursor
	// Source, preference and collection changes invalidate signed continuation.
	input := sourceInput(binding)
	input.ProviderTransactionID = "report-source-new"
	input.AmountMinor = "1"
	input.BankDate = "2026-10-03"
	requireCode(t, f.service.RecordSource(ctx, input), "READY")
	if got := f.service.ReadReport(ctx, request); got.Code != "RESTART_REQUIRED" {
		t.Fatal("sync/source continuation not stale", got.Code)
	}
	request = reportRange(account)
	current = f.service.ReadReport(ctx, request)
	request.After = *current.EndCursor
	requireCode(t, Result{Code: reportingtimezone.New(f.db).Update(ctx, uuid.NewString(), "America/Los_Angeles", 1).Code}, "READY")
	if got := f.service.ReadReport(ctx, request); got.Code != "RESTART_REQUIRED" {
		t.Fatal("timezone did not restart custom pagination")
	}
	requireCode(t, f.service.Stop(ctx, FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}), "READY")
	retained := f.service.ReadReport(ctx, reportRange(account))
	if retained.Code != "READY" || retained.Accounts[0].Coverage != "PARTIAL" {
		t.Fatal("disconnected history unavailable or misleading")
	}
	requireCode(t, f.service.DeleteHistory(ctx, FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 2}), "READY")
	if got := f.service.ReadReport(ctx, reportRange(account)); got.Code != "NOT_FOUND" || got.Summary != nil {
		t.Fatal("deleted history remained visible")
	}
	if got := f.service.ReadTransaction(ctx, first.String(), ""); got.Code != "NOT_FOUND" {
		t.Fatal("deleted detail visible")
	}
	// Durable receipts keep only safe original outcomes after the payload is hidden.
	if got := f.service.OperationStatus(ctx, noteAttempt); got != saved {
		t.Fatal("safe original receipt lost after deletion")
	}
}
func TestReportC5ArchiveDiscoveryEditsAndRestoration(t *testing.T) {
	f := newReplacementFixture(t)
	ctx := f.actor(f.owner)
	retained := f.row(f.oldBinding, "2026-06-12", "2000", "posted", false)
	excluded := f.row(f.oldBinding, "2026-09-20", "10000", "posted", true)
	oldAfter := f.row(f.oldBinding, "2026-10-01", "900", "posted", false)
	b := f.stage()
	f.row(b, "2026-09-20", "10000", "posted", false)
	oct := f.row(b, "2026-10-02", "5000", "posted", false)
	f.usable(b)
	f.confirm(f.preview(b, "2026-09-30", "ACTIVATE"))
	request := reportRange(f.account)
	r := f.service.ReadReport(ctx, request)
	if r.Code != "READY" || r.TotalCount != 3 || r.Summary.NetMinor != "7000" || r.Accounts[0].PredecessorID == nil || len(r.Accounts[0].Archives) == 0 {
		t.Fatalf("canonical C5 %+v", r)
	}
	for _, id := range []uuid.UUID{retained, excluded, oct} {
		if d := f.service.ReadTransaction(ctx, id.String(), ""); d.Code != "READY" {
			t.Fatal("retained ID missing")
		}
	}
	if d := f.service.ReadTransaction(ctx, oldAfter.String(), ""); d.Code != "NOT_FOUND" {
		t.Fatal("archive-only current")
	}
	archive := r.Accounts[0].Archives[0].ID
	request.Filter.ArchiveID = archive
	request.First = 100
	archived := f.service.ReadReport(ctx, request)
	if archived.Code != "READY" || archived.Summary != nil || archived.SpendingContext != "RECOVERY_ARCHIVE" || archived.TotalCount != 5 {
		t.Fatalf("archive discovery %+v", archived)
	}
	d := f.service.ReadTransaction(ctx, retained.String(), archive)
	if d.Code != "READY" || d.CurrentID == nil || len(d.Transaction.Archives) == 0 {
		t.Fatal("current/archive identity forked")
	}
	d = f.service.ReadTransaction(ctx, oldAfter.String(), archive)
	if d.Code != "READY" || d.CurrentID != nil {
		t.Fatal("archive-only provenance unavailable")
	}
	edit := AnnotationInput{AttemptID: uuid.New(), SourceID: oldAfter, SourceRevision: 1, ExpectedRevision: 1, MaterialRevision: 1, Field: "excluded", Value: textPointer("true")}
	requireCode(t, f.service.EditAnnotation(ctx, edit), "READY")
	snapshot := f.service.ReadTransaction(ctx, oldAfter.String(), archive)
	if snapshot.Code != "READY" || snapshot.Transaction.Archives[0].Annotation == nil || snapshot.Transaction.Archives[0].Annotation.Excluded || !snapshot.Transaction.Excluded {
		t.Fatal("archive snapshot overwritten by latest annotation")
	}
	if got := f.service.ReadReport(ctx, reportRange(f.account)); got.Summary.NetMinor != "7000" {
		t.Fatal("archive-only edit changed current totals")
	}
	f.confirm(f.preview(uuid.Nil, "", "RESTORE_PREDECESSOR"))
	restored := f.service.ReadReport(ctx, reportRange(f.account))
	if restored.Code != "READY" || restored.Summary.NetMinor != "2000" || restored.Summary.ExcludedCount != 2 {
		t.Fatalf("restoration lost latest annotations %+v", restored)
	}
}

func TestReportPostedDateCoverageAndActivityOnlyStates(t *testing.T) {
	f := newReplacementFixture(t)
	ctx := f.actor(f.owner)
	request := reportRange(f.account)
	request.Filter.Start = "2025-10-01"
	request.Filter.End = "2025-10-31"
	empty := f.service.ReadReport(ctx, request)
	if empty.Code != "READY" || empty.TotalCount != 0 || empty.Summary.NetMinor != "0" || empty.Accounts[0].Coverage != "PARTIAL" {
		t.Fatal("unknown empty range claimed complete", empty.Code)
	}
	f.exec(`UPDATE app.banking_bindings SET coverage_after='2025-09-30',coverage_through='2025-11-30',history_availability='provider_reported' WHERE id=$1`, f.oldBinding)
	empty = f.service.ReadReport(ctx, request)
	if empty.Accounts[0].Coverage != "COMPLETE" {
		t.Fatal("known searched empty range hidden")
	}
	id := f.row(f.oldBinding, "2025-11-02", "10000", "posted", false)
	f.exec(`INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,amount_minor,currency,bank_date,authorization_date,processing_state,mapping_version,stage,material_revision) SELECT source_id,owner_id,2,amount_minor,currency,bank_date,'2025-10-31',processing_state,mapping_version,stage,1 FROM app.banking_source_revisions WHERE source_id=$1 AND revision=1`, id)
	f.exec(`UPDATE app.banking_sources SET revision=2 WHERE id=$1`, id)
	oct := f.service.ReadReport(ctx, request)
	if oct.Summary.NetMinor != "0" || oct.TotalCount != 0 {
		t.Fatal("authorization date selected posting month")
	}
	request.Filter.Start = "2025-11-01"
	request.Filter.End = "2025-11-30"
	nov := f.service.ReadReport(ctx, request)
	if nov.Summary.NetMinor != "10000" || nov.Rows[0].AuthorizationDate == nil || *nov.Rows[0].AuthorizationDate != "2025-10-31" {
		t.Fatal("posted bank date/detail disagreed")
	}
	f.row(f.oldBinding, "2025-11-03", "2500", "pending", false)
	request.Filter.States = []string{"pending"}
	pending := f.service.ReadReport(ctx, request)
	if pending.Code != "READY" || pending.TotalCount != 1 || pending.Summary != nil || pending.Counts.PendingCount != 1 || pending.SpendingContext != "ACTIVITY_CONTEXT" {
		t.Fatal("pending-only view supplied spending headline")
	}
	f.exec(`UPDATE app.banking_bindings SET import_state='unknown' WHERE id=$1`, f.oldBinding)
	unavailable := f.service.ReadReport(ctx, request)
	if unavailable.Code != "DATA_UNAVAILABLE" || unavailable.Summary != nil || unavailable.Counts != nil {
		t.Fatal("missing initial data became zero")
	}
}

func TestReportMaterialConflictRequiresActivityConfirmation(t *testing.T) {
	f := newFixture(t)
	ctx := f.actor(f.owner)
	requireCode(t, Result{Code: reportingtimezone.New(f.db).Initialize(ctx, uuid.NewString(), nil).Code}, "READY")
	connection := f.connection(f.owner, "material-report")
	account, binding := f.binding(f.owner, connection, "checking")
	f.exec(`UPDATE app.banking_bindings SET import_state='usable' WHERE id=$1`, binding)
	input := sourceInput(binding)
	input.AmountMinor = "10000"
	input.BankDate = "2026-10-01"
	source := f.service.RecordSource(ctx, input)
	requireCode(t, source, "READY")
	requireCode(t, f.service.AnnotationOperationStatus(ctx, input.AttemptID), "NOT_FOUND")
	edit := AnnotationInput{AttemptID: uuid.New(), SourceID: source.ID, SourceRevision: 1, ExpectedRevision: 0, MaterialRevision: 1, Field: "activity", Value: textPointer("purchase")}
	requireCode(t, f.service.EditAnnotation(ctx, edit), "READY")
	request := reportRange(account)
	initial := f.service.ReadReport(ctx, request)
	if initial.Summary.NetMinor != "10000" {
		t.Fatal("valid owner classification missing")
	}
	request.After = *initial.EndCursor
	input.AttemptID = uuid.New()
	input.ExpectedRevision = 1
	input.AmountMinor = "-4000"
	requireCode(t, f.service.RecordSource(ctx, input), "READY")
	if got := f.service.ReadReport(ctx, request); got.Code != "RESTART_REQUIRED" {
		t.Fatal("source correction did not invalidate cursor")
	}
	changed := f.service.ReadReport(ctx, reportRange(account))
	if changed.Summary.NetMinor != "0" || changed.Counts.UnresolvedCount != 1 || changed.Rows[0].ActivityOverride == nil || !changed.Rows[0].MaterialConflict {
		t.Fatal("stale purchase classified corrected credit")
	}
	edit.AttemptID = uuid.New()
	edit.SourceRevision = 2
	edit.MaterialRevision = 2
	edit.ExpectedRevision = 1
	edit.Field = "reviewed"
	edit.Value = textPointer("true")
	requireCode(t, f.service.EditAnnotation(ctx, edit), "READY")
	reviewed := f.service.ReadReport(ctx, reportRange(account))
	if reviewed.Rows[0].Activity != "unresolved" || reviewed.Summary.NetMinor != "0" {
		t.Fatal("review flag resolved stale activity")
	}
	edit.AttemptID = uuid.New()
	edit.ExpectedRevision = 2
	edit.Field = "activity"
	edit.Value = textPointer("purchase")
	requireCode(t, f.service.EditAnnotation(ctx, edit), "INVALID_INPUT")
	edit.AttemptID = uuid.New()
	edit.Value = textPointer("refund")
	requireCode(t, f.service.EditAnnotation(ctx, edit), "READY")
	confirmed := f.service.ReadReport(ctx, reportRange(account))
	if confirmed.Summary.NetMinor != "-4000" || confirmed.Counts.UnresolvedCount != 0 {
		t.Fatal("confirmed refund not reconciled")
	}
}

func TestReportCapturedFactIntentManifestAndExplicitResetAcrossRecovery(t *testing.T) {
	f := newReplacementFixture(t)
	ctx := f.actor(f.owner)
	f.row(f.oldBinding, "2026-09-20", "2000", "posted", false)
	b := f.stage()
	source := f.row(b, "2026-10-10", "10000", "posted", false)
	f.usable(b)
	edit := AnnotationInput{AttemptID: uuid.New(), SourceID: source, SourceRevision: 1, ExpectedRevision: 1, MaterialRevision: 1, Field: "reviewed", Value: textPointer("true")}
	// Staged facts cannot be privately edited through the reporting API.
	requireCode(t, f.service.EditAnnotation(ctx, edit), "NOT_FOUND")
	f.confirm(f.preview(b, "2026-09-30", "ACTIVATE"))
	edit.AttemptID = uuid.New()
	requireCode(t, f.service.EditAnnotation(ctx, edit), "READY")
	before := f.service.ReadReport(ctx, reportRange(f.account))
	oldArchives := map[string]bool{}
	for _, ar := range before.Accounts[0].Archives {
		oldArchives[ar.ID] = true
	}
	var provider string
	var cg, bg int64
	if err := f.admin.QueryRow(ctx, `SELECT s.provider_transaction_id,c.generation,b.generation FROM app.banking_sources s JOIN app.banking_bindings b ON b.id=s.binding_id JOIN app.banking_connections c ON c.id=b.connection_id WHERE s.id=$1`, source).Scan(&provider, &cg, &bg); err != nil {
		t.Fatal(err)
	}
	correction := SourceInput{AttemptID: uuid.New(), BindingID: b, ProviderTransactionID: provider, ConnectionGeneration: cg, BindingGeneration: bg, ExpectedRevision: 1, AmountMinor: "-4000", Currency: "USD", BankDate: "2026-09-29", ProcessingState: "posted", MappingVersion: "controlled-pfc-v2"}
	requireCode(t, f.service.RecordSource(ctx, correction), "READY")
	f.exec(`UPDATE app.banking_sources SET discrepancy='cross_boundary_change' WHERE id=$1`, source)
	// Reproduce the persisted automatic projection made by sync after a material
	// correction; it must not overwrite the actor's original v1 acknowledgement.
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,activity,note,excluded,reviewed,material_conflict,applies_to_source_revision) SELECT source_id,owner_id,3,material_source_revision,activity,note,excluded,false,true,2 FROM app.banking_annotations WHERE source_id=$1 AND revision=2`, source)
	retained := f.service.ReadTransaction(ctx, source.String(), "")
	if retained.Code != "READY" || retained.Transaction.SourceRevision != "1" || retained.Transaction.AnnotationRevision != "3" || retained.Transaction.MaterialConflict || retained.Transaction.Activity != "purchase" || !retained.Transaction.Reviewed {
		t.Fatal("automatic correction invalidated captured fact intent")
	}
	edit.AttemptID = uuid.New()
	edit.ExpectedRevision = 3
	edit.Field = "note"
	edit.Value = textPointer("N1 before recovery")
	requireCode(t, f.service.EditAnnotation(ctx, edit), "READY")
	edit.AttemptID = uuid.New()
	requireCode(t, f.service.EditAnnotation(ctx, edit), "CONFLICT")
	changed := f.preview(uuid.Nil, "2026-10-12", "CHANGE_BOUNDARY")
	if changed.Archived.Count != 1 || changed.Prior.SpendingMinor != "12000" || changed.Proposed.SpendingMinor != "2000" {
		t.Fatalf("preview parity %+v", changed)
	}
	f.confirm(changed)
	after := f.service.ReadReport(ctx, reportRange(f.account))
	archive := ""
	for _, ar := range after.Accounts[0].Archives {
		if !oldArchives[ar.ID] {
			archive = ar.ID
		}
	}
	captured := f.service.ReadTransaction(ctx, source.String(), archive)
	if archive == "" || captured.Code != "READY" || captured.Transaction.SourceRevision != "1" || captured.CurrentID != nil {
		t.Fatal("manifest captured correction rather than canonical fact leaving reporting")
	}
	var original *AnnotationSnapshot
	for _, ref := range captured.Transaction.Archives {
		if ref.ArchiveID == archive {
			original = ref.Annotation
		}
	}
	if original == nil || original.Note == nil || *original.Note != "N1 before recovery" || original.Activity == nil || *original.Activity != "purchase" || !original.Reviewed {
		t.Fatal("immutable manifest failed to capture effective annotation snapshot")
	}
	discrepancies := reportRange(f.account)
	discrepancies.Filter.Discrepancies = true
	inspect := f.service.ReadReport(ctx, discrepancies)
	if inspect.Code != "READY" || inspect.TotalCount != 1 || inspect.Rows[0].SourceRevision != "2" || inspect.Summary != nil || inspect.SpendingContext != "SOURCE_DISCREPANCIES" {
		t.Fatal("later correction not inspectable separately")
	}
	if d := f.service.ReadDiscrepancy(ctx, source.String()); d.Code != "READY" || d.Transaction.SourceRevision != "2" {
		t.Fatal("discrepancy detail missing")
	}
	if d := f.service.ReadDiscrepancy(f.actor(f.other), source.String()); d.Code != "NOT_FOUND" {
		t.Fatal("foreign correction disclosed")
	}
	// Retain an existing historical v2 archive as permitted by the storage model.
	// Such snapshots must remain editable without losing source-wide private intent
	// when the immediately preceding plan restores its captured v1 fact.
	v2archive := uuid.New()
	f.exec(`INSERT INTO app.banking_archives(id,owner_id,plan_id,boundary_date) VALUES($1,$2,$3,'2026-10-12')`, v2archive, f.owner, *after.Accounts[0].PlanID)
	f.exec(`INSERT INTO app.banking_captures(archive_id,owner_id,source_id,source_revision,annotation_revision) VALUES($1,$2,$3,2,4)`, v2archive, f.owner, source)
	edit.SourceRevision = 2
	edit.MaterialRevision = 2
	edit.ExpectedRevision = 4
	for _, change := range []struct {
		field string
		value *string
	}{{"activity", textPointer("refund")}, {"reviewed", textPointer("true")}, {"note", textPointer("N2 latest private note")}, {"category", textPointer("FOOD_AND_DRINK")}, {"excluded", textPointer("true")}, {"activity", nil}} {
		edit.AttemptID = uuid.New()
		edit.Field = change.field
		edit.Value = change.value
		requireCode(t, f.service.EditAnnotation(ctx, edit), "READY")
		edit.ExpectedRevision++
	}
	f.confirm(f.preview(uuid.Nil, "", "RESTORE_PREDECESSOR"))
	restored := f.service.ReadTransaction(ctx, source.String(), "")
	if restored.Code != "READY" || restored.Transaction.SourceRevision != "1" || restored.Transaction.Note == nil || *restored.Transaction.Note != "N2 latest private note" || restored.Transaction.CategoryOverride == nil || *restored.Transaction.CategoryOverride != "FOOD_AND_DRINK" || !restored.Transaction.Excluded || restored.Transaction.ActivityOverride != nil || restored.Transaction.Reviewed {
		t.Fatal("restoration lost latest private fields or resurrected reset/review intent")
	}
	edit.SourceRevision = 1
	edit.MaterialRevision = 1
	edit.AttemptID = uuid.New()
	edit.Field = "excluded"
	edit.Value = nil
	requireCode(t, f.service.EditAnnotation(ctx, edit), "READY")
	reset := f.service.ReadTransaction(ctx, source.String(), "")
	if reset.Transaction.ActivityOverride != nil || reset.Transaction.Activity != "unresolved" {
		t.Fatal("reset activity resurrected old purchase override")
	}
	immutable := f.service.ReadTransaction(ctx, source.String(), archive)
	for _, ref := range immutable.Transaction.Archives {
		if ref.ArchiveID == archive && (ref.Annotation.Note == nil || *ref.Annotation.Note != "N1 before recovery" || ref.Annotation.Activity == nil || *ref.Annotation.Activity != "purchase") {
			t.Fatal("later archive edits rewrote capture provenance")
		}
	}
}

func TestReportLegacyAppliedAnnotationRetainsExplicitReset(t *testing.T) {
	f := newReplacementFixture(t)
	source := f.row(f.oldBinding, "2026-10-01", "10000", "posted", false)
	// Earlier full-row edits could already name an application revision. A null
	// activity is explicit intent, not an automatic projection to discard.
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,applies_to_source_revision,activity,note,excluded,reviewed) VALUES($1,$2,2,1,1,NULL,'legacy explicit reset',false,true)`, source, f.owner)
	detail := f.service.ReadTransaction(f.actor(f.owner), source.String(), "")
	if detail.Code != "READY" || detail.Transaction.ActivityOverride != nil || detail.Transaction.Activity != "unresolved" || detail.Transaction.Note == nil || *detail.Transaction.Note != "legacy explicit reset" || detail.Transaction.AnnotationRevision != "2" {
		t.Fatal("legacy applied reset resurrected earlier owner activity")
	}
	report := f.service.ReadReport(f.actor(f.owner), reportRange(f.account))
	if report.Code != "READY" || report.Summary.NetMinor != "0" || report.Counts.UnresolvedCount != 1 {
		t.Fatal("legacy explicit reset contributed to spending")
	}
}
