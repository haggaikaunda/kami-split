//go:build integration

package banking

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Capture authorization before an ingress callback, instead of allowing the
// provider fake to return a post-revocation inventory to the pending operation.
type lifecycleSnapshotProvider struct {
	*controlledEnrollmentProvider
	afterSnapshot func()
}

func (p *lifecycleSnapshotProvider) Accounts(ctx context.Context, env string, credential Credential) (AccountInventory, error) {
	snapshot, err := p.controlledEnrollmentProvider.Accounts(ctx, env, credential)
	if p.afterSnapshot != nil {
		p.afterSnapshot()
	}
	return snapshot, err
}

func TestLifecycleAccountRevocationFencesInflightAddition(t *testing.T) {
	for _, mode := range []string{"selection", "repair"} {
		for _, prior := range []string{"unbound", "deselected"} {
			t.Run(mode+"/"+prior, func(t *testing.T) {
				f, s, p, _, _ := lifecycleFixture(t)
				ids := []string{"checking"}
				if prior == "deselected" {
					ids = append(ids, "savings")
				}
				enrollment, connection := lifecycleReady(t, f, s, f.owner, ids...)
				source := lifecycleHistory(t, f, connection)
				generation := int64(1)
				if prior == "deselected" {
					requireCode(t, s.ChangeSelection(f.actor(f.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: generation, AccountIDs: []string{"checking"}}), "READY")
					generation++
				}
				repair := uuid.New()
				if mode == "repair" {
					if o := s.StartRepair(f.actor(f.owner), RepairInput{AttemptID: repair, ConnectionID: connection, ExpectedGeneration: generation}); o.Code != "PREPARED" {
						t.Fatal(o.Code)
					}
				}
				s.provider = &lifecycleSnapshotProvider{controlledEnrollmentProvider: p, afterSnapshot: func() {
					if status := lifecycleEvent(t, f, enrollment, "item-public-"+enrollment.String(), "USER_ACCOUNT_REVOKED", "savings", ""); status != http.StatusNoContent {
						t.Fatal(status)
					}
				}}
				code := ""
				if mode == "selection" {
					code = s.ChangeSelection(f.actor(f.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: generation, AccountIDs: []string{"checking", "savings"}}).Code
				} else {
					code = s.FinishRepair(f.actor(f.owner), FinishRepairInput{AttemptID: repair, AccountIDs: []string{"checking", "savings"}}).Code
				}
				if code != "CONFLICT" || lifecycleGeneration(t, f, connection) != generation+1 {
					t.Fatal("captured authorization crossed acknowledged revocation", code)
				}
				if queryInt(t, f, `SELECT count(*) FROM app.banking_bindings b JOIN app.banking_accounts a ON a.id=b.account_id WHERE b.connection_id=$1 AND b.provider_account_id='savings' AND a.selected`, connection) != 0 {
					t.Fatal("revoked stream selected")
				}
				if prior == "unbound" && queryInt(t, f, `SELECT count(*) FROM app.banking_enrollment_accounts m JOIN app.banking_bindings b ON b.id=m.binding_id WHERE b.connection_id=$1 AND b.provider_account_id='savings'`, connection) != 0 {
					t.Fatal("never-selected metadata materialized")
				}
				if queryInt(t, f, `SELECT count(*) FROM app.banking_bindings b JOIN app.banking_accounts a ON a.id=b.account_id WHERE b.connection_id=$1 AND b.provider_account_id='checking' AND a.selected`, connection) != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND note='private annotation'`, source) != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE connection_id=$1 AND kind='teardown'`, connection) != 0 {
					t.Fatal("account revocation changed sibling/history/Item authority")
				}
			})
		}
	}
}

func TestLifecycleInstitutionContinuityDoesNotDependOnProposalOverlap(t *testing.T) {
	for _, mode := range []string{"selection", "repair"} {
		subsets := map[string][]string{"only_new": {"savings"}, "existing_and_new": {"checking", "savings"}}
		if mode == "repair" {
			subsets["only_retained"] = []string{"checking"}
			subsets["empty"] = []string{}
		}
		for name, ids := range subsets {
			t.Run(mode+"/"+name, func(t *testing.T) {
				f, s, p, _, _ := lifecycleFixture(t)
				_, connection := lifecycleReady(t, f, s, f.owner, "checking")
				source := lifecycleHistory(t, f, connection)
				binding := lifecycleBinding(t, f, connection, "checking")
				repair := uuid.New()
				if mode == "repair" {
					if o := s.StartRepair(f.actor(f.owner), RepairInput{AttemptID: repair, ConnectionID: connection, ExpectedGeneration: 1}); o.Code != "PREPARED" {
						t.Fatal(o.Code)
					}
				}
				p.inventory.InstitutionID = "different-institution"
				code := ""
				if mode == "selection" {
					code = s.ChangeSelection(f.actor(f.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1, AccountIDs: ids}).Code
				} else {
					code = s.FinishRepair(f.actor(f.owner), FinishRepairInput{AttemptID: repair, AccountIDs: ids}).Code
				}
				if code != "REPLACEMENT_REQUIRED" || lifecycleGeneration(t, f, connection) != 1 || lifecycleBinding(t, f, connection, "checking") != binding {
					t.Fatal("changed institution accepted or changed lifecycle", code)
				}
				if queryInt(t, f, `SELECT count(DISTINCT m.institution_id) FROM app.banking_bindings b JOIN app.banking_enrollment_accounts m ON m.binding_id=b.id WHERE b.connection_id=$1`, connection) != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_bindings WHERE connection_id=$1`, connection) != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND note='private annotation'`, source) != 1 {
					t.Fatal("identity failure changed provenance/history")
				}
				// Removing authority stays possible when the provider is unavailable.
				p.failAccounts = true
				requireCode(t, s.ChangeSelection(f.actor(f.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1, AccountIDs: []string{}}), "READY")
				if queryInt(t, f, `SELECT count(*) FROM app.banking_bindings b JOIN app.banking_accounts a ON a.id=b.account_id WHERE b.connection_id=$1 AND a.selected`, connection) != 0 {
					t.Fatal("offline removal retained collection")
				}
			})
		}
	}
}

func TestLifecycleFreshSignedRevocationAfterReauthorization(t *testing.T) {
	for _, mode := range []string{"selection", "repair"} {
		t.Run(mode, func(t *testing.T) {
			f, s, _, w, db := lifecycleFixture(t)
			enrollment, connection := lifecycleReady(t, f, s, f.owner, "checking", "savings")
			source := lifecycleHistory(t, f, connection)
			body, _ := json.Marshal(map[string]string{"environment": "sandbox", "item_id": "item-public-" + enrollment.String(), "webhook_type": "ITEM", "webhook_code": "USER_ACCOUNT_REVOKED", "account_id": "savings"})
			signed := newWebhookFixture(t)
			handler, err := NewWebhookHandler(signed.verifier, f.service)
			if err != nil {
				t.Fatal(err)
			}
			if queryInt(t, f, `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relname='banking_webhook_deliveries' AND c.relrowsecurity`) != 1 || queryInt(t, f, `SELECT count(*) FROM unnest(ARRAY['anon','authenticated','service_role','kami_api','kami_worker']) role_name WHERE has_table_privilege(role_name,'app.banking_webhook_deliveries','SELECT,INSERT,UPDATE,DELETE')`) != 0 {
				t.Fatal("delivery receipt storage exposed outside definer wrappers")
			}
			first := signed.sign(t, body, signed.now, nil)
			receive := func(signature string, want int) {
				t.Helper()
				if status := lifecycleSignedRequest(handler, enrollment, body, signature); status != want {
					t.Fatal("ingress status", status, want)
				}
			}
			if status := lifecycleSignedRequest(handler, enrollment, append(append([]byte{}, body...), ' '), first); status != http.StatusBadRequest {
				t.Fatal("tampered body accepted", status)
			}
			if status := lifecycleSignedRequest(handler, uuid.New(), body, first); status != http.StatusBadRequest {
				t.Fatal("wrong correlation accepted", status)
			}
			if queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_deliveries WHERE correlation_id=$1`, enrollment) != 0 || lifecycleGeneration(t, f, connection) != 1 {
				t.Fatal("invalid ingress persisted fingerprint or effect")
			}
			receive(first, http.StatusNoContent)
			receive(first, http.StatusNoContent)
			if lifecycleGeneration(t, f, connection) != 2 {
				t.Fatal("exact signed delivery not idempotent")
			}
			if mode == "selection" {
				requireCode(t, s.ChangeSelection(f.actor(f.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 2, AccountIDs: []string{"checking", "savings"}}), "READY")
			} else {
				repair := uuid.New()
				if o := s.StartRepair(f.actor(f.owner), RepairInput{AttemptID: repair, ConnectionID: connection, ExpectedGeneration: 2}); o.Code != "PREPARED" {
					t.Fatal(o.Code)
				}
				if o := s.FinishRepair(f.actor(f.owner), FinishRepairInput{AttemptID: repair, AccountIDs: []string{"checking", "savings"}}); o.Code != "READY" {
					t.Fatal(o.Code)
				}
			}
			receive(first, http.StatusNoContent) // Known old delivery cannot revoke a restored epoch again.
			if lifecycleGeneration(t, f, connection) != 3 {
				t.Fatal("old exact retry repeated authority reduction")
			}
			signed.now = signed.now.Add(10 * time.Minute)
			receive(first, http.StatusBadRequest)
			second := signed.sign(t, body, signed.now, nil)
			receive(second, http.StatusNoContent)
			receive(second, http.StatusNoContent)
			if lifecycleGeneration(t, f, connection) != 4 || queryInt(t, f, `SELECT count(*) FROM app.banking_bindings b JOIN app.banking_accounts a ON a.id=b.account_id WHERE b.connection_id=$1 AND b.provider_account_id='savings' AND a.selected`, connection) != 0 {
				t.Fatal("newly signed identical revocation did not fence restored authority")
			}
			if queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_deliveries WHERE correlation_id=$1`, enrollment) != 2 || queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_receipts WHERE correlation_id=$1`, enrollment) != 1 {
				t.Fatal("body receipt confused with signed delivery identity")
			}
			if queryInt(t, f, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND note='private annotation'`, source) != 1 {
				t.Fatal("revocation removed history")
			}
			// More than one page proves explicit deletion uses bounded receipt batches.
			f.exec(`INSERT INTO app.banking_webhook_deliveries SELECT $1,sha256(convert_to(i::text,'UTF8')) FROM generate_series(1,203) i`, enrollment)
			requireCode(t, f.service.DeleteHistory(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 4}), "READY")
			discardFencedLifecycleTransport(t, f, db)
			job := requireWork(t, db)
			if job.Kind != "purge" {
				t.Fatal("first deletion job is not purge")
			}
			// Completed import receipts now precede retained history in the
			// bounded purge order. Drain that layer without consuming delivery
			// fingerprints, then retain the exact 100-receipt assertion below.
			for queryInt(t, f, `SELECT count(*) FROM app.banking_sync_batches batch JOIN app.banking_bindings binding ON binding.id=batch.binding_id WHERE binding.connection_id=$1`, connection) > 0 {
				before := queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_deliveries WHERE correlation_id=$1`, enrollment)
				if n, err := db.PurgeBankingBatch(context.Background(), job); err != nil || n <= 0 || n > 210 {
					t.Fatal("bounded import receipt purge", n, err)
				}
				if queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_deliveries WHERE correlation_id=$1`, enrollment) != before {
					t.Fatal("import receipt phase changed fingerprints")
				}
			}
			if n, err := db.PurgeBankingBatch(context.Background(), job); err != nil || n <= 0 {
				t.Fatal("bounded fingerprint purge", n, err)
			}
			if queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_deliveries WHERE correlation_id=$1`, enrollment) != 105 {
				t.Fatal("fingerprint purge exceeded or missed its 100-row page")
			}
			releaseDue(t, f, job.ID)
			for range 20 {
				if _, err := w.ProcessOne(context.Background()); err != nil {
					t.Fatal(err)
				}
			}
			state, status := f.service.ReadLifecycle(f.actor(f.owner), connection)
			requireCode(t, status, "READY")
			if state.Purge != "complete" || state.Cleanup != "confirmed" || queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_deliveries WHERE correlation_id=$1`, enrollment) != 0 {
				t.Fatal("explicit deletion did not purge delivery fingerprints", state.Purge, state.Cleanup)
			}
			before := queryInt(t, f, `SELECT coalesce(sum(attempts),0) FROM app.banking_work WHERE connection_id=$1 AND kind='teardown'`, connection)
			receive(signed.sign(t, body, signed.now, nil), http.StatusNoContent)
			after, _ := f.service.ReadLifecycle(f.actor(f.owner), connection)
			if after != state || queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_deliveries WHERE correlation_id=$1`, enrollment) != 0 || queryInt(t, f, `SELECT coalesce(sum(attempts),0) FROM app.banking_work WHERE connection_id=$1 AND kind='teardown'`, connection) != before {
				t.Fatal("terminal callback restarted cleanup or retained new fingerprint")
			}
		})
	}
}

func TestLifecycleRevocationReceiptFailureCannotAcknowledgePartialAuthority(t *testing.T) {
	f, s, _, _, _ := lifecycleFixture(t)
	enrollment, connection := lifecycleReady(t, f, s, f.owner, "checking", "savings")
	body, _ := json.Marshal(map[string]string{"environment": "sandbox", "item_id": "item-public-" + enrollment.String(), "webhook_type": "ITEM", "webhook_code": "USER_ACCOUNT_REVOKED", "account_id": "savings"})
	signed := newWebhookFixture(t)
	handler, err := NewWebhookHandler(signed.verifier, f.service)
	if err != nil {
		t.Fatal(err)
	}
	signature := signed.sign(t, body, signed.now, nil)
	// Fail the new receipt after legacy body acceptance. Neither acceptance nor
	// authority changes may survive that transaction, and the delivery can retry.
	f.exec(`CREATE FUNCTION app.banking_delivery_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic delivery failure'; END $$`)
	f.exec(`CREATE TRIGGER banking_delivery_test_fail BEFORE INSERT ON app.banking_webhook_deliveries FOR EACH ROW EXECUTE FUNCTION app.banking_delivery_test_fail()`)
	t.Cleanup(func() {
		f.exec(`DROP TRIGGER IF EXISTS banking_delivery_test_fail ON app.banking_webhook_deliveries`)
		f.exec(`DROP FUNCTION IF EXISTS app.banking_delivery_test_fail()`)
	})
	if status := lifecycleSignedRequest(handler, enrollment, body, signature); status != http.StatusServiceUnavailable {
		t.Fatal("receipt failure acknowledged", status)
	}
	if lifecycleGeneration(t, f, connection) != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_receipts WHERE correlation_id=$1`, enrollment) != 0 || queryInt(t, f, `SELECT count(*) FROM app.banking_webhook_deliveries WHERE correlation_id=$1`, enrollment) != 0 || queryInt(t, f, `SELECT count(*) FROM app.banking_bindings b JOIN app.banking_accounts a ON a.id=b.account_id WHERE b.connection_id=$1 AND a.selected`, connection) != 2 {
		t.Fatal("failed acceptance partially changed authority/receipts")
	}
	f.exec(`DROP TRIGGER banking_delivery_test_fail ON app.banking_webhook_deliveries`)
	if status := lifecycleSignedRequest(handler, enrollment, body, signature); status != http.StatusNoContent || lifecycleGeneration(t, f, connection) != 2 {
		t.Fatal("rolled-back delivery could not recover", status)
	}
}
