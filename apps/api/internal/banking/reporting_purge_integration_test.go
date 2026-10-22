//go:build integration

package banking

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
)

func TestReportingPurgeRetainsIndependentReviewReferencesUntilAnnotationsDrain(t *testing.T) {
	f := newSyncFixture(t)
	initial := f.begin()
	fact := syncFact("independent-review", "2026-10-01", 100)
	f.stage(initial, 0, initial.Cursor(), "first", false, []SyncTransaction{fact}, nil)
	f.commit(initial, "READY")
	source := f.sourceID(fact.TransactionID)
	next := f.begin()
	fact.AmountMinor = 200
	f.stage(next, 0, next.Cursor(), "second", false, nil, []SyncTransaction{fact})
	f.commit(next, "READY")
	// A restored fact can keep activity/applicability on r1 while review was
	// acknowledged against r2. More than one deletion batch retains that FK.
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,applies_to_source_revision,reviewed_material_revision,activity,note,reviewed,changed_field) SELECT $1,$2,n,1,1,2,'purchase','retained note '||n,true,'note' FROM generate_series(1,205)n`, source, f.owner)
	requireCode(t, f.service.DeleteHistory(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: f.connection, ExpectedGeneration: 1}), "READY")
	var job database.BankingWork
	if err := f.admin.QueryRow(context.Background(), `UPDATE app.banking_work SET state='running',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes' WHERE connection_id=$1 AND kind='purge' RETURNING id,connection_id,generation,lease_token`, f.connection).Scan(&job.ID, &job.ConnectionID, &job.Generation, &job.Token); err != nil {
		t.Fatal(err)
	}
	complete := false
	for pass := 0; pass < 20; pass++ {
		before := queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1`, source)
		progress, err := f.worker.PurgeBankingBatch(context.Background(), job)
		if err != nil || progress < 0 {
			t.Fatal("independent review FK blocked bounded purge", progress, err)
		}
		remaining := queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1`, source)
		if before-remaining < 0 || before-remaining > 100 {
			t.Fatal("annotation purge exceeded bound")
		}
		if remaining > 0 && queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_source_revisions WHERE source_id=$1`, source) != 2 {
			t.Fatal("live review acknowledgement lost its source revision")
		}
		if progress == 0 {
			complete = true
			break
		}
	}
	if !complete || queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_source_revisions WHERE source_id=$1`, source) != 0 {
		t.Fatal("review acknowledgement cleanup did not converge")
	}
}
