//go:build integration

package banking

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
)

func TestSyncPFCClassificationChangesInvalidateReview(t *testing.T) {
	f := newSyncFixture(t)
	fact := syncFact("classified", "2026-10-01", 1234)
	fact.ProviderPrimaryCategory = pfcString("FOOD_AND_DRINK")
	fact.ProviderCategory = pfcString("FOOD_AND_DRINK_GROCERIES")
	fact.ProviderConfidence = pfcString("HIGH")
	batch := f.begin()
	f.stage(batch, 0, batch.Cursor(), "initial", false, []SyncTransaction{fact}, nil)
	f.commit(batch, "READY")
	source := f.sourceID(fact.TransactionID)
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_source_revisions WHERE source_id=$1 AND revision=1 AND material_revision=1 AND provider_primary_category='FOOD_AND_DRINK' AND provider_category='FOOD_AND_DRINK_GROCERIES' AND provider_confidence='HIGH' AND mapping_version='plaid-pfc-v2'`, source) != 1 {
		t.Fatal("stored PFC facts or mapping lost")
	}
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,category,activity,note,excluded,reviewed) VALUES($1,$2,1,1,'FOOD_AND_DRINK','purchase','owner intent',true,true)`, source, f.owner)
	fact.Name = pfcString("changed bank spelling")
	batch = f.begin()
	f.stage(batch, 0, batch.Cursor(), "name", false, nil, []SyncTransaction{fact})
	f.commit(batch, "READY")
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_source_revisions WHERE source_id=$1 AND revision=2 AND material_revision=1`, source) != 1 || queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND revision=2 AND reviewed AND note='owner intent' AND excluded`, source) != 1 {
		t.Fatal("description-only update invalidated review")
	}
	for i, change := range []struct {
		name  string
		apply func()
	}{
		{"primary", func() { fact.ProviderPrimaryCategory = pfcString("TRANSFER_OUT") }},
		{"detail", func() { fact.ProviderCategory = pfcString("TRANSFER_OUT_ACCOUNT_TRANSFER") }},
		{"confidence", func() { fact.ProviderConfidence = pfcString("LOW") }},
		{"code", func() { fact.TransactionCode = pfcString("transfer") }},
		{"missing facts", func() { fact.ProviderPrimaryCategory = nil; fact.ProviderCategory = nil; fact.ProviderConfidence = nil }},
	} {
		t.Run(change.name, func(t *testing.T) {
			// A fresh reviewed annotation acknowledges the exact material version before
			// each independent provider-only correction.
			if i > 0 {
				f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,category,activity,note,excluded,reviewed,applies_to_source_revision) SELECT $1,$2,(SELECT max(a.revision)+1 FROM app.banking_annotations a WHERE a.source_id=$1),r.material_revision,'FOOD_AND_DRINK','purchase','owner intent',true,true,r.revision FROM app.banking_source_revisions r JOIN app.banking_sources s ON s.id=r.source_id AND s.revision=r.revision WHERE s.id=$1`, source, f.owner)
			}
			change.apply()
			batch = f.begin()
			f.stage(batch, 0, batch.Cursor(), fmt.Sprintf("classification-%d", i), false, nil, []SyncTransaction{fact})
			f.commit(batch, "READY")
			if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_source_revisions r JOIN app.banking_sources s ON s.id=r.source_id AND s.revision=r.revision WHERE s.id=$1 AND r.material_revision=r.revision`, source) != 1 {
				t.Fatal("classification-only change retained stale material revision")
			}
			if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_annotations a WHERE a.source_id=$1 AND a.revision=(SELECT max(v.revision) FROM app.banking_annotations v WHERE v.source_id=$1) AND NOT a.reviewed AND a.activity='purchase' AND a.category='FOOD_AND_DRINK' AND a.note='owner intent' AND a.excluded`, source) != 1 {
				t.Fatal("classification correction erased owner intent or kept stale review")
			}
		})
	}
	// A later sign-incompatible correction retains the visible override but marks
	// it unresolved, preserving all prior immutable provider versions.
	fact.AmountMinor = -1234
	batch = f.begin()
	f.stage(batch, 0, batch.Cursor(), "sign-conflict", false, nil, []SyncTransaction{fact})
	f.commit(batch, "READY")
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_annotations a WHERE a.source_id=$1 AND a.revision=(SELECT max(v.revision) FROM app.banking_annotations v WHERE v.source_id=$1) AND material_conflict AND NOT reviewed AND activity='purchase' AND note='owner intent'`, source) != 1 {
		t.Fatal("incompatible override was not preserved unresolved")
	}
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_source_revisions WHERE source_id=$1 AND revision=1 AND provider_primary_category='FOOD_AND_DRINK' AND provider_category='FOOD_AND_DRINK_GROCERIES' AND provider_confidence='HIGH'`, source) != 1 {
		t.Fatal("old immutable provider facts changed")
	}
}

func TestSyncPFCLegacyFactsAndRemoval(t *testing.T) {
	f := newSyncFixture(t)
	input := sourceInput(f.binding)
	input.ProviderTransactionID = "legacy"
	input.AmountMinor = "100"
	input.BankDate = "2026-10-01"
	input.MappingVersion = "legacy-unclassified"
	requireCode(t, f.service.RecordSource(f.actor(f.owner), input), "READY")
	var source uuid.UUID
	if err := f.admin.QueryRow(context.Background(), `SELECT id FROM app.banking_sources WHERE binding_id=$1 AND provider_transaction_id='legacy'`, f.binding).Scan(&source); err != nil {
		t.Fatal(err)
	}
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_source_revisions WHERE source_id=$1 AND revision=1 AND provider_primary_category IS NULL AND provider_category IS NULL AND provider_confidence IS NULL AND material_revision IS NULL`, source) != 1 {
		t.Fatal("legacy nullable facts incompatible")
	}
	batch := f.begin()
	f.stage(batch, 0, batch.Cursor(), "remove-legacy", false, nil, nil, "legacy")
	f.commit(batch, "READY")
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_source_revisions WHERE source_id=$1 AND revision=2 AND processing_state='removed' AND provider_primary_category IS NULL AND provider_category IS NULL AND provider_confidence IS NULL AND mapping_version='legacy-unclassified'`, source) != 1 {
		t.Fatal("removal invented taxonomy or changed legacy provenance")
	}
	fact := syncFact("classified-removal", "2026-10-01", 100)
	fact.ProviderPrimaryCategory = pfcString("FUTURE_PRIMARY")
	fact.ProviderCategory = pfcString("FUTURE_DETAIL")
	fact.ProviderConfidence = pfcString("UNKNOWN")
	batch = f.begin()
	f.stage(batch, 0, batch.Cursor(), "classified", false, []SyncTransaction{fact}, nil)
	f.commit(batch, "READY")
	classified := f.sourceID(fact.TransactionID)
	batch = f.begin()
	f.stage(batch, 0, batch.Cursor(), "removed", false, nil, nil, fact.TransactionID)
	f.commit(batch, "READY")
	if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_source_revisions WHERE source_id=$1 AND revision=2 AND processing_state='removed' AND provider_primary_category='FUTURE_PRIMARY' AND provider_category='FUTURE_DETAIL' AND provider_confidence='UNKNOWN' AND mapping_version='plaid-pfc-v2'`, classified) != 1 {
		t.Fatal("removal discarded provider classification provenance")
	}
}
