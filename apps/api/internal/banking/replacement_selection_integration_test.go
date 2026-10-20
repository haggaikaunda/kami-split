//go:build integration

package banking

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// Observe generations after the operation: a stale-write rejection would not
// establish that the stream's current collection authority was removed.
func replacementFreshSource(t *testing.T, f *replacementFixture, binding uuid.UUID) Result {
	t.Helper()
	var cg, bg int64
	if err := f.admin.QueryRow(context.Background(), `SELECT c.generation,b.generation FROM app.banking_bindings b JOIN app.banking_connections c ON c.id=b.connection_id WHERE b.id=$1`, binding).Scan(&cg, &bg); err != nil {
		t.Fatal(err)
	}
	return f.service.RecordSource(f.actor(f.owner), SourceInput{AttemptID: uuid.New(), BindingID: binding, ProviderTransactionID: uuid.NewString(), ConnectionGeneration: cg, BindingGeneration: bg, AmountMinor: "100", Currency: "USD", BankDate: "2026-10-02", ProcessingState: "posted", MappingVersion: "controlled-pfc-v2"})
}

func replacementSelected(t *testing.T, f *replacementFixture, binding uuid.UUID) bool {
	t.Helper()
	connection := replacementConnection(t, f, binding)
	accounts, result := f.enrollment.Accounts(f.actor(f.owner), connection)
	if result.Code != "READY" {
		t.Fatal(result.Code)
	}
	for _, a := range accounts {
		if a.BindingID == binding {
			return a.Selected
		}
	}
	t.Fatal("binding missing from owner projection")
	return false
}

func TestReplacementSelectionOmissionStopsOnlyTargetStreams(t *testing.T) {
	for _, subset := range []bool{false, true} {
		t.Run(map[bool]string{false: "empty", true: "subset"}[subset], func(t *testing.T) {
			f := newReplacementFixture(t)
			history := f.row(f.oldBinding, "2026-09-20", "123", "posted", true)
			staged := f.stage()
			connection := replacementConnection(t, f, staged)
			var sibling uuid.UUID
			ids := []string{}
			if subset {
				requireCode(t, f.enrollment.ChangeSelection(f.actor(f.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: lifecycleGeneration(t, f.fixture, connection), AccountIDs: []string{"checking", "unselected"}}), "READY")
				sibling = lifecycleBinding(t, f.fixture, connection, "unselected")
				ids = []string{"unselected"}
			}
			calls := 0
			f.provider.beforeAccounts = func() { calls++ }
			f.provider.failAccounts = true
			requireCode(t, f.enrollment.ChangeSelection(f.actor(f.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: lifecycleGeneration(t, f.fixture, connection), AccountIDs: ids}), "READY")
			if calls != 0 {
				t.Fatal("offline removal called provider", calls)
			}
			if replacementSelected(t, f, staged) {
				t.Error("omitted staged binding remains selected")
			}
			if r := replacementFreshSource(t, f, staged); r.Code != "CONFLICT" {
				t.Error("fresh omitted-stream source authorized", r.Code)
			}
			if !replacementSelected(t, f, f.oldBinding) {
				t.Error("other Item current binding lost selection")
			}
			requireCode(t, replacementFreshSource(t, f, f.oldBinding), "READY")
			if subset {
				if !replacementSelected(t, f, sibling) {
					t.Error("selected sibling stopped")
				}
				requireCode(t, replacementFreshSource(t, f, sibling), "READY")
			}
			if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND note='original private note' AND excluded`, history) != 1 {
				t.Fatal("history/annotation changed")
			}
			if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_plans WHERE account_id=$1`, f.account) != 0 {
				t.Fatal("selection changed reporting plan")
			}
		})
	}
}

func TestReplacementStoppedReselectionRequiresProviderObservation(t *testing.T) {
	for _, mode := range []string{"staged_revocation", "deselected_predecessor"} {
		t.Run(mode, func(t *testing.T) {
			f := newReplacementFixture(t)
			history := f.row(f.oldBinding, "2026-09-20", "123", "posted", false)
			if mode == "deselected_predecessor" {
				requireCode(t, f.enrollment.ChangeSelection(f.actor(f.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: f.oldConnection, ExpectedGeneration: 1, AccountIDs: []string{"savings"}}), "READY")
			}
			staged := f.stage()
			target, other := staged, f.oldBinding
			ids := []string{"checking"}
			if mode == "deselected_predecessor" {
				target, other = f.oldBinding, staged
				ids = []string{"checking", "savings"}
			}
			connection := replacementConnection(t, f, target)
			var enrollment uuid.UUID
			var item string
			if err := f.admin.QueryRow(context.Background(), `SELECT w.id,c.provider_item_id FROM app.banking_connections c JOIN app.banking_webhook_correlations w ON w.connection_id=c.id WHERE c.id=$1`, connection).Scan(&enrollment, &item); err != nil {
				t.Fatal(err)
			}
			revoke := func() {
				if status := lifecycleEvent(t, f.fixture, enrollment, item, "USER_ACCOUNT_REVOKED", "checking", ""); status != http.StatusNoContent {
					t.Fatal(status)
				}
			}
			if mode == "staged_revocation" {
				revoke()
			}
			if replacementSelected(t, f, target) {
				t.Fatal("stopped stream selected before attempt")
			}
			calls := 0
			f.provider.beforeAccounts = func() { calls++ }
			f.provider.failAccounts = true
			change := func() Result {
				return f.enrollment.ChangeSelection(f.actor(f.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: lifecycleGeneration(t, f.fixture, connection), AccountIDs: ids})
			}
			if r := change(); r.Code != "REPAIR_REQUIRED" {
				t.Error("unavailable provider reselected stopped binding", r.Code)
			}
			if calls != 1 {
				t.Error("stopped reselection bypassed provider", calls)
			}
			if replacementSelected(t, f, target) {
				t.Error("failed observation cleared stop")
			}
			if r := replacementFreshSource(t, f, target); r.Code != "CONFLICT" {
				t.Error("failed observation granted source authority", r.Code)
			}
			if t.Failed() {
				return
			}
			f.provider.failAccounts = false
			if mode == "staged_revocation" {
				f.enrollment.provider = &lifecycleSnapshotProvider{controlledEnrollmentProvider: f.provider, afterSnapshot: revoke}
				requireCode(t, change(), "CONFLICT")
				if calls != 2 || replacementSelected(t, f, target) {
					t.Fatal("generation CAS lost signed revocation", calls)
				}
				requireCode(t, replacementFreshSource(t, f, target), "CONFLICT")
				f.enrollment.provider = f.provider
			}
			requireCode(t, change(), "READY")
			wantCalls := 2
			if mode == "staged_revocation" {
				wantCalls = 3
			}
			if calls != wantCalls || !replacementSelected(t, f, target) || !replacementSelected(t, f, other) {
				t.Fatal("positive observation failed or changed other Item", calls)
			}
			requireCode(t, replacementFreshSource(t, f, target), "READY")
			requireCode(t, replacementFreshSource(t, f, other), "READY")
			savings := lifecycleBinding(t, f.fixture, f.oldConnection, "savings")
			if !replacementSelected(t, f, savings) {
				t.Fatal("savings sibling changed")
			}
			if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND note='original private note'`, history) != 1 {
				t.Fatal("history changed")
			}
			if queryInt(t, f.fixture, `SELECT count(*) FROM app.banking_plans WHERE account_id=$1`, f.account) != 0 {
				t.Fatal("reauthorization changed reporting")
			}
		})
	}
}
