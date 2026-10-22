package banking

import "testing"

func TestReportSnapshotIdentityPreservesFinancialContext(t *testing.T) {
	source := reportFact("10000", "purchase")
	source.ID, source.AccountID, source.LatestSourceRevision = "source", "account", "2"
	original := source.SnapshotID()
	if original == source.ID || original != source.SnapshotID() {
		t.Fatal("snapshot identity is not stable and distinct from source navigation")
	}
	for _, change := range []struct {
		name  string
		apply func(*Transaction)
	}{
		{"correction", func(r *Transaction) { r.SourceRevision = "2"; r.AmountMinor = "-4000"; r.Current = false }},
		{"annotation", func(r *Transaction) { r.AnnotationRevision = "2"; r.Note = textPointer("new private note") }},
		{"archive cutoff", func(r *Transaction) {
			r.Archives = []ArchiveReference{{ArchiveID: "archive", Annotation: &AnnotationSnapshot{Revision: "1", Note: textPointer("captured note")}}}
		}},
		{"edit owner", func(r *Transaction) { r.CurrentID = textPointer("current-owner") }},
	} {
		t.Run(change.name, func(t *testing.T) {
			next := source
			change.apply(&next)
			if next.SnapshotID() == original || next.ID != source.ID {
				t.Fatal("context aliases or changes stable source identity")
			}
		})
	}
	account := ReportAccount{ID: "account", Coverage: "COMPLETE", Intervals: []ReportInterval{{BindingID: "binding", Coverage: "COMPLETE"}}}
	oldAccount := account.SnapshotID()
	account.Coverage = "PARTIAL"
	if account.SnapshotID() == oldAccount || account.ID != "account" {
		t.Fatal("period coverage shares cache identity")
	}
	report := Report{Code: "READY", Rows: []Transaction{source}, Summary: &ReportSummary{NetMinor: "10000"}}
	originalReport := report.SnapshotID()
	updated := report
	updated.Rows = []Transaction{source}
	updated.Rows[0].Note = textPointer("new")
	if updated.SnapshotID() == originalReport {
		t.Fatal("partial row refresh retains old report identity")
	}
	updated = report
	updated.Summary = &ReportSummary{NetMinor: "6000"}
	if updated.SnapshotID() == originalReport {
		t.Fatal("unselected summary excluded from identity")
	}
	updated = report
	updated.EndCursor = textPointer("next-page")
	if updated.SnapshotID() == originalReport {
		t.Fatal("page boundary excluded from identity")
	}
}
