//go:build integration

package banking

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func lifecycleEnrollmentRecoverySnapshot(t *testing.T, f *fixture, id uuid.UUID) string {
	t.Helper()
	var snapshot string
	err := f.admin.QueryRow(context.Background(), `SELECT jsonb_build_object('enrollment',to_jsonb(e),'job',to_jsonb(j))::text FROM app.banking_enrollments e JOIN app.banking_enrollment_jobs j ON j.attempt_id=e.id WHERE e.id=$1`, id).Scan(&snapshot)
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func TestLifecycleRemovedOriginalCallbacksDoNotReopenEnrollment(t *testing.T) {
	for _, mode := range []string{"disconnect", "delete"} {
		t.Run(mode, func(t *testing.T) {
			f, s, _, worker, _ := lifecycleFixture(t)
			enrollment, connection := lifecycleReady(t, f, s, f.owner, "checking")
			source := lifecycleHistory(t, f, connection)
			item := "item-public-" + enrollment.String()
			input := FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}
			if mode == "delete" {
				requireCode(t, f.service.DeleteHistory(f.actor(f.owner), input), "READY")
			} else {
				requireCode(t, f.service.Stop(f.actor(f.owner), input), "READY")
			}
			before := lifecycleEnrollmentRecoverySnapshot(t, f, enrollment)
			// Before confirmed removal the raw expected Item still identifies a terminal
			// callback; after removal the same routing decision must use opaque proof.
			if status := lifecycleEvent(t, f, enrollment, item, "USER_PERMISSION_REVOKED", "", ""); status != http.StatusNoContent {
				t.Fatal(status)
			}
			if lifecycleEnrollmentRecoverySnapshot(t, f, enrollment) != before {
				t.Fatal("pre-removal callback reopened enrollment")
			}
			for range 10 {
				if _, err := worker.ProcessOne(context.Background()); err != nil {
					t.Fatal(err)
				}
			}
			state, status := f.service.ReadLifecycle(f.actor(f.owner), connection)
			requireCode(t, status, "READY")
			if state.Cleanup != "confirmed" || (mode == "delete" && state.Purge != "complete") {
				t.Fatal("cleanup prerequisite", state.Cleanup, state.Purge)
			}
			if queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_correlations w JOIN app.banking_connections c ON c.id=w.connection_id WHERE w.id=$1 AND octet_length(w.removed_item_digest)=32 AND c.provider_item_id=c.id::text AND c.provider_removed`, enrollment) != 1 {
				t.Fatal("confirmed removal did not preserve private terminal proof")
			}
			before = lifecycleEnrollmentRecoverySnapshot(t, f, enrollment)
			teardownAttempts := queryInt(t, f, `SELECT coalesce(sum(attempts),0) FROM app.banking_work WHERE connection_id=$1 AND kind='teardown'`, connection)
			for _, code := range []string{"USER_PERMISSION_REVOKED", "LOGIN_REPAIRED", "USER_ACCOUNT_REVOKED", "USER_PERMISSION_REVOKED"} {
				if status := lifecycleEvent(t, f, enrollment, item, code, "checking", ""); status != http.StatusNoContent {
					t.Fatal(status)
				}
			}
			for range 4 {
				if _, err := worker.ProcessOne(context.Background()); err != nil {
					t.Fatal(err)
				}
			}
			if lifecycleEnrollmentRecoverySnapshot(t, f, enrollment) != before || queryInt(t, f, `SELECT count(*) FROM app.banking_enrollment_receipts WHERE attempt_id=$1`, enrollment) != 0 || queryInt(t, f, `SELECT coalesce(sum(attempts),0) FROM app.banking_work WHERE connection_id=$1 AND kind='teardown'`, connection) != teardownAttempts {
				t.Fatal("removed Item callback recreated hint or reset completed cleanup")
			}
			if mode == "disconnect" {
				_, status := f.service.ReadSource(f.actor(f.owner), source)
				requireCode(t, status, "READY")
			} else if queryInt(t, f, `SELECT count(*) FROM app.banking_sources WHERE id=$1`, source) != 0 {
				t.Fatal("deleted history reappeared")
			}
			next := s.Start(f.actor(f.owner), StartEnrollmentInput{AttemptID: uuid.New(), Intent: "different"})
			if next.Code != "PREPARED" {
				t.Fatal("known removed callback blocked a new enrollment", next.Code)
			}
			if status := lifecycleEvent(t, f, enrollment, item, "ERROR", "", "OAUTH_USER_REVOKED"); status != http.StatusNoContent {
				t.Fatal(status)
			}
			if s.Status(f.actor(f.owner), next.AttemptID).Code != "PREPARED" || lifecycleEnrollmentRecoverySnapshot(t, f, enrollment) != before {
				t.Fatal("late callback changed the new enrollment or old cleanup")
			}
		})
	}
}

func TestLifecycleDistinctLateItemStillRequiresNarrowDiscovery(t *testing.T) {
	f, s, p, worker, _ := lifecycleFixture(t)
	enrollment, connection := lifecycleReady(t, f, s, f.owner, "checking")
	original := "item-public-" + enrollment.String()
	requireCode(t, f.service.DeleteHistory(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}), "READY")
	for range 10 {
		if _, err := worker.ProcessOne(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	late := "distinct-late-item"
	user := "usr-kami-" + f.owner.String() + "-sandbox"
	p.items[late] = enrollmentItem{user: user, webhook: "https://api.example.invalid/banking/webhooks/" + enrollment.String()}
	p.items["unrelated-late-item"] = enrollmentItem{user: user, webhook: "https://api.example.invalid/unrelated"}
	if status := lifecycleEvent(t, f, enrollment, late, "USER_PERMISSION_REVOKED", "", ""); status != http.StatusNoContent {
		t.Fatal(status)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_enrollment_receipts WHERE attempt_id=$1 AND hint_item_id=$2`, enrollment, late) != 1 || s.Status(f.actor(f.owner), enrollment).State != "cleanup_pending" {
		t.Fatal("distinct late Item was discarded as a terminal callback")
	}
	p.hideDiscovery = true
	dueEnrollment(f, enrollment)
	processEnrollment(t, worker)
	if p.items[late].removed || s.Status(f.actor(f.owner), enrollment).State != "cleanup_pending" {
		t.Fatal("unseen Item treated as removed")
	}
	pending := lifecycleEnrollmentRecoverySnapshot(t, f, enrollment)
	if status := lifecycleEvent(t, f, enrollment, original, "LOGIN_REPAIRED", "", ""); status != http.StatusNoContent {
		t.Fatal(status)
	}
	if lifecycleEnrollmentRecoverySnapshot(t, f, enrollment) != pending || queryInt(t, f, `SELECT count(*) FROM app.banking_enrollment_receipts WHERE attempt_id=$1 AND hint_item_id=$2`, enrollment, original) != 0 {
		t.Fatal("original callback polluted the distinct cleanup obligation")
	}
	p.hideDiscovery = false
	dueEnrollment(f, enrollment)
	processEnrollment(t, worker)
	if !p.items[late].removed || p.items["unrelated-late-item"].removed || s.Status(f.actor(f.owner), enrollment).Code != "RETRY_ALLOWED" {
		t.Fatal("distinct cleanup lost its narrow scope or completion")
	}
	completed := lifecycleEnrollmentRecoverySnapshot(t, f, enrollment)
	if status := lifecycleEvent(t, f, enrollment, original, "ERROR", "", "OAUTH_USER_REVOKED"); status != http.StatusNoContent {
		t.Fatal(status)
	}
	if lifecycleEnrollmentRecoverySnapshot(t, f, enrollment) != completed {
		t.Fatal("removed original callback reset later completed recovery budget")
	}
	// Distinct late Items also have positive removal proof after this recovery.
	// A later event body for that same removed Item must not erase the proof and
	// reopen discovery that can no longer find an already removed Item.
	if status := lifecycleEvent(t, f, enrollment, late, "LOGIN_REPAIRED", "", ""); status != http.StatusNoContent {
		t.Fatal(status)
	}
	if lifecycleEnrollmentRecoverySnapshot(t, f, enrollment) != completed {
		t.Fatal("confirmed distinct late Item callback reopened completed cleanup")
	}
	next := s.Start(f.actor(f.owner), StartEnrollmentInput{AttemptID: uuid.New(), Intent: "different"})
	if next.Code != "PREPARED" {
		t.Fatal("confirmed late cleanup blocked fresh enrollment", next.Code)
	}
}

func TestIndependentRemovedItemProofFailureRollsBackTeardown(t *testing.T) {
	f, s, _, worker, db := lifecycleFixture(t)
	enrollment, connection := lifecycleReady(t, f, s, f.owner, "checking")
	item := "item-public-" + enrollment.String()
	requireCode(t, f.service.Stop(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}), "READY")
	f.exec(`CREATE FUNCTION app.banking_terminal_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic terminal proof failure'; END $$`)
	f.exec(`CREATE TRIGGER banking_terminal_test_fail BEFORE UPDATE OF removed_item_digest ON app.banking_webhook_correlations FOR EACH ROW EXECUTE FUNCTION app.banking_terminal_test_fail()`)
	t.Cleanup(func() {
		f.exec(`DROP TRIGGER IF EXISTS banking_terminal_test_fail ON app.banking_webhook_correlations`)
		f.exec(`DROP FUNCTION IF EXISTS app.banking_terminal_test_fail()`)
	})
	if _, err := worker.ProcessOne(context.Background()); err == nil {
		t.Fatal("failed terminal proof was acknowledged")
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_connections c JOIN app.banking_webhook_correlations w ON w.connection_id=c.id JOIN app.banking_credentials credential ON credential.connection_id=c.id WHERE c.id=$1 AND NOT c.provider_removed AND c.provider_item_id=$2 AND w.removed_item_digest IS NULL`, connection, item) != 1 {
		t.Fatal("proof failure partially erased identity or credential")
	}
	f.exec(`DROP TRIGGER banking_terminal_test_fail ON app.banking_webhook_correlations`)
	var work uuid.UUID
	if err := f.admin.QueryRow(context.Background(), `SELECT id FROM app.banking_work WHERE connection_id=$1 AND kind='teardown'`, connection).Scan(&work); err != nil {
		t.Fatal(err)
	}
	releaseDue(t, f, work)
	restarted, err := NewWorker(db, f.service.protector, worker.provider)
	if err != nil {
		t.Fatal(err)
	}
	if worked, err := restarted.ProcessOne(context.Background()); err != nil || !worked {
		t.Fatal("fresh worker lost removal/proof obligation", err)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_connections c JOIN app.banking_webhook_correlations w ON w.connection_id=c.id WHERE c.id=$1 AND c.provider_removed AND c.provider_item_id=c.id::text AND octet_length(w.removed_item_digest)=32`, connection) != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_credentials WHERE connection_id=$1`, connection) != 0 {
		t.Fatal("confirmed retry did not atomically redact and remember")
	}
	before := lifecycleEnrollmentRecoverySnapshot(t, f, enrollment)
	if status := lifecycleEvent(t, f, enrollment, item, "USER_PERMISSION_REVOKED", "", ""); status != http.StatusNoContent || lifecycleEnrollmentRecoverySnapshot(t, f, enrollment) != before {
		t.Fatal("recovered proof did not suppress old callback", status)
	}
}
