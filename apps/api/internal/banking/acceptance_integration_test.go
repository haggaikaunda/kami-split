//go:build integration

package banking

import (
	"bytes"
	"context"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestIndependentRecoveryKeepsOriginalReceiptAndFacts(t *testing.T) {
	f := newFixture(t)
	ctx := f.actor(f.owner)
	connection := f.connection(f.owner, "independent-recovery")
	_, binding := f.binding(f.owner, connection, "account")
	original := sourceInput(binding)
	original.AmountMinor = "10000"
	created := f.service.RecordSource(ctx, original)
	requireCode(t, created, "READY")
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,note,excluded) VALUES($1,$2,1,1,'retained original note',true)`, created.ID, f.owner)

	next := original
	next.AttemptID = uuid.New()
	next.ExpectedRevision = 1
	next.AmountMinor = "-4000"
	next.BankDate = "2024-03-01"
	updated := f.service.RecordSource(ctx, next)
	requireCode(t, updated, "READY")
	if updated.ID != created.ID {
		t.Fatal("revision changed stable source identity")
	}

	// A new application instance must recover from persisted receipts rather than
	// any process-local request cache. The original attempt cannot undo revision 2.
	p, err := NewProtector("one", map[string][]byte{"one": bytes.Repeat([]byte{1}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := New(f.db, p)
	if err != nil {
		t.Fatal(err)
	}
	if got := restarted.RecordSource(f.actor(f.owner), original); got != created {
		t.Fatal("fresh service lost original receipt")
	}
	if got := restarted.OperationStatus(ctx, original.AttemptID); got != created {
		t.Fatal("status changed original receipt")
	}
	saved, result := restarted.ReadSource(ctx, created.ID)
	requireCode(t, result, "READY")
	if saved.Revision != 2 || saved.AmountMinor != "-4000" || saved.BankDate != next.BankDate {
		t.Fatal("retry reverted current source facts")
	}
	var oldAmount int64
	var acknowledged int64
	var note string
	var excluded bool
	if err := f.admin.QueryRow(context.Background(), `SELECT r.amount_minor,a.material_source_revision,a.note,a.excluded FROM app.banking_source_revisions r JOIN app.banking_annotations a ON a.source_id=r.source_id WHERE r.source_id=$1 AND r.revision=1 AND a.revision=1`, created.ID).Scan(&oldAmount, &acknowledged, &note, &excluded); err != nil {
		t.Fatal(err)
	}
	if oldAmount != 10000 || acknowledged != 1 || note != "retained original note" || !excluded {
		t.Fatal("source correction rewrote historical facts or annotation provenance")
	}

	requireCode(t, restarted.DeleteHistory(ctx, FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}), "READY")
	if got := restarted.RecordSource(ctx, original); got != created {
		t.Fatal("deletion changed opaque original receipt")
	}
	_, result = restarted.ReadSource(ctx, created.ID)
	requireCode(t, result, "NOT_FOUND")
	late := next
	late.AttemptID = uuid.New()
	late.ExpectedRevision = 2
	requireCode(t, restarted.RecordSource(ctx, late), "CONFLICT")
	var count int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_source_revisions WHERE source_id=$1`, created.ID).Scan(&count); err != nil || count != 2 {
		t.Fatal("recovery or delayed write changed deleted history")
	}
	changed := original
	changed.AmountMinor = "9999"
	requireCode(t, restarted.RecordSource(ctx, changed), "CONFLICT")
	requireCode(t, restarted.OperationStatus(f.actor(f.other), original.AttemptID), "NOT_FOUND")
	f.exec(`UPDATE app.users SET enabled=false WHERE id=$1`, f.owner)
	requireCode(t, restarted.RecordSource(ctx, original), "FORBIDDEN")
	requireCode(t, restarted.OperationStatus(ctx, original.AttemptID), "FORBIDDEN")
}

func TestIndependentDistinctAttemptsCompeteForSourceRevision(t *testing.T) {
	f := newFixture(t)
	ctx := f.actor(f.owner)
	connection := f.connection(f.owner, "independent-revision-race")
	_, binding := f.binding(f.owner, connection, "account")
	input := sourceInput(binding)
	created := f.service.RecordSource(ctx, input)
	requireCode(t, created, "READY")
	a, b := input, input
	a.AttemptID, b.AttemptID = uuid.New(), uuid.New()
	a.ExpectedRevision, b.ExpectedRevision = 1, 1
	a.AmountMinor, b.AmountMinor = "111", "222"
	start := make(chan struct{})
	results := make(chan struct {
		input  SourceInput
		result Result
	}, 2)
	var wg sync.WaitGroup
	for _, command := range []SourceInput{a, b} {
		wg.Add(1)
		go func(command SourceInput) {
			defer wg.Done()
			<-start
			results <- struct {
				input  SourceInput
				result Result
			}{command, f.service.RecordSource(ctx, command)}
		}(command)
	}
	close(start)
	wg.Wait()
	close(results)
	codes := map[string]int{}
	var winner SourceInput
	for got := range results {
		codes[got.result.Code]++
		if got.result.Code == "READY" {
			winner = got.input
			if got.result.ID != created.ID {
				t.Fatal("winning correction changed source identity")
			}
		}
		if recovered := f.service.RecordSource(ctx, got.input); recovered != got.result {
			t.Fatal("competing attempt outcome was not durable")
		}
	}
	if codes["READY"] != 1 || codes["CONFLICT"] != 1 {
		t.Fatalf("expected one winning revision: %v", codes)
	}
	saved, result := f.service.ReadSource(ctx, created.ID)
	requireCode(t, result, "READY")
	if saved.Revision != 2 || saved.AmountMinor != winner.AmountMinor {
		t.Fatal("persisted source differs from accepted winner")
	}
	var count int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_source_revisions WHERE source_id=$1`, created.ID).Scan(&count); err != nil || count != 2 {
		t.Fatal("competing writes appended more than one revision")
	}
}

func TestIndependentCrossOwnerWritesLeaveOwnerStateUnchanged(t *testing.T) {
	f := newFixture(t)
	ctx, other := f.actor(f.owner), f.actor(f.other)
	// Share the designated Household as well as the fixture's ordinary group.
	// A focused banking-only database may not yet have an installation; do not
	// replace the existing designation when running the complete repository suite.
	f.exec(`INSERT INTO app.installation(household_group_id,group_creator_user_id) SELECT group_id,$1 FROM app.memberships WHERE user_id=$1 LIMIT 1 ON CONFLICT(singleton) DO NOTHING`, f.owner)
	for _, owner := range []uuid.UUID{f.owner, f.other} {
		f.exec(`INSERT INTO app.memberships(id,group_id,user_id) SELECT $1,household_group_id,$2 FROM app.installation ON CONFLICT(group_id,user_id) DO NOTHING`, uuid.New(), owner)
	}
	var household uuid.UUID
	if err := f.admin.QueryRow(context.Background(), `SELECT household_group_id FROM app.installation`).Scan(&household); err != nil {
		t.Fatal(err)
	}
	var sharedHousehold bool
	if err := f.db.WithIdentity(context.Background(), f.other.String(), func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `SELECT app.can_read_group($1)`, household).Scan(&sharedHousehold)
	}); err != nil || !sharedHousehold {
		t.Fatal("Household access positive control failed")
	}
	connection := f.connection(f.owner, "independent-private-write")
	_, binding := f.binding(f.owner, connection, "account")
	input := sourceInput(binding)
	created := f.service.RecordSource(ctx, input)
	requireCode(t, created, "READY")
	for _, target := range []uuid.UUID{binding, uuid.New()} {
		probe := sourceInput(target)
		requireCode(t, f.service.RecordSource(other, probe), "NOT_FOUND")
	}
	for _, target := range []uuid.UUID{connection, uuid.New()} {
		probe := FenceInput{AttemptID: uuid.New(), ConnectionID: target, ExpectedGeneration: 1}
		requireCode(t, f.service.Stop(other, probe), "NOT_FOUND")
		probe.AttemptID = uuid.New()
		requireCode(t, f.service.DeleteHistory(other, probe), "NOT_FOUND")
	}
	saved, result := f.service.ReadConnection(ctx, connection)
	requireCode(t, result, "READY")
	if saved.State != "active" || saved.Generation != 1 || saved.DeletionGeneration != 0 {
		t.Fatal("other owner changed connection lifecycle")
	}
	source, result := f.service.ReadSource(ctx, created.ID)
	requireCode(t, result, "READY")
	if source.Revision != 1 || source.AmountMinor != input.AmountMinor {
		t.Fatal("other owner changed source")
	}
	// Even migration-owned fixtures must preserve composite owner provenance.
	if _, err := f.admin.Exec(context.Background(), `INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,note) VALUES($1,$2,1,1,'invalid owner')`, created.ID, f.other); err == nil {
		t.Fatal("cross-owner annotation provenance accepted")
	}
}
