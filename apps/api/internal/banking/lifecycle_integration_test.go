//go:build integration

package banking

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
)

func (p *controlledEnrollmentProvider) PrepareRepair(_ context.Context, _, _ string, _ Credential) (LinkPreparation, error) {
	return LinkPreparation{LinkToken: "repair-private", ExpiresAt: time.Now().Add(time.Hour)}, nil
}

func lifecycleFixture(t *testing.T) (*fixture, *EnrollmentService, *controlledEnrollmentProvider, *Worker, *database.WorkerDB) {
	t.Helper()
	f, s, p, w, db := enrollmentFixture(t)
	t.Cleanup(func() {
		// These fixtures exclusively own the two synthetic banking owners.
		f.exec(`INSERT INTO app.banking_account_barriers(account_id,owner_id,connection_id,generation) SELECT DISTINCT ON(b.account_id) b.account_id,b.owner_id,b.connection_id,1 FROM app.banking_bindings b WHERE b.owner_id IN($1,$2) ON CONFLICT DO NOTHING`, f.owner, f.other)
		for _, table := range []string{"captures", "archives", "plan_sources", "plan_intervals", "plans", "annotations", "source_revisions", "sources", "repairs"} {
			if table == "source_revisions" {
				f.exec(`UPDATE app.banking_sources SET revision=NULL WHERE owner_id IN($1,$2)`, f.owner, f.other)
			}
			f.exec(`DELETE FROM app.banking_`+table+` WHERE owner_id IN($1,$2)`, f.owner, f.other)
		}
	})
	return f, s, p, w, db
}
func lifecycleReady(t *testing.T, f *fixture, s *EnrollmentService, owner uuid.UUID, ids ...string) (uuid.UUID, uuid.UUID) {
	t.Helper()
	attempt := startEnrollment(t, f, s, owner, "different")
	o := finishEnrollment(f, s, owner, attempt, ids...)
	if o.Code != "AWAITING_INITIAL_IMPORT" {
		t.Fatal(o.Code)
	}
	// These lifecycle scenarios start after first import. Complete a deterministic
	// empty batch through the real consumer, so their next-claim and bounded purge
	// assertions continue to target lifecycle work rather than new enrollment jobs.
	db, err := database.OpenWorker(context.Background(), database.Config{URL: os.Getenv("TEST_WORKER_DATABASE_URL"), MaxConns: 3, Timeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	provider, ok := s.provider.(*controlledEnrollmentProvider)
	if !ok {
		t.Fatal("lifecycle fixture requires controlled provider")
	}
	worker, err := NewWorker(db, f.service.protector, &lifecycleInitialProvider{provider})
	if err != nil {
		t.Fatal(err)
	}
	// Reauthorization now legitimately leaves incremental work on earlier
	// connections. Give this setup's exact new connection exclusive transport
	// visibility, then restore every previous deadline before returning. No
	// durable work or financial fact is removed, and the exact assertions below
	// still require one actual consumer completion per selected binding.
	f.exec(`CREATE TEMP TABLE lifecycle_initial_visibility AS SELECT q.msg_id,q.vt FROM pgmq.q_banking_lifecycle q LEFT JOIN app.banking_work w ON w.message_id=q.msg_id WHERE w.connection_id IS DISTINCT FROM $1`, o.ConnectionID)
	f.exec(`UPDATE pgmq.q_banking_lifecycle q SET vt=clock_timestamp()+interval '10 minutes' FROM lifecycle_initial_visibility saved WHERE saved.msg_id=q.msg_id`)
	defer func() {
		f.exec(`UPDATE pgmq.q_banking_lifecycle q SET vt=saved.vt FROM lifecycle_initial_visibility saved WHERE saved.msg_id=q.msg_id`)
		f.exec(`DROP TABLE lifecycle_initial_visibility`)
	}()
	for range len(ids) {
		if worked, err := worker.ProcessOne(context.Background()); err != nil || !worked {
			t.Fatal("fixture initial import", err)
		}
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_bindings WHERE connection_id=$1 AND sync_cursor IS NOT NULL`, o.ConnectionID) != len(ids) {
		t.Fatal("fixture first import incomplete")
	}
	return attempt, o.ConnectionID
}

type lifecycleInitialProvider struct{ *controlledEnrollmentProvider }

func (*lifecycleInitialProvider) SyncTransactions(_ context.Context, binding SyncBinding, _ Credential, _ SyncCursor) (SyncPage, error) {
	cursor, err := NewSyncCursor(binding, "lifecycle-fixture-checkpoint")
	return SyncPage{Binding: binding, NextCursor: cursor}, err
}

func lifecycleGeneration(t *testing.T, f *fixture, connection uuid.UUID) int64 {
	t.Helper()
	var gen int64
	if err := f.admin.QueryRow(context.Background(), `SELECT generation FROM app.banking_connections WHERE id=$1`, connection).Scan(&gen); err != nil {
		t.Fatal(err)
	}
	return gen
}
func lifecycleBinding(t *testing.T, f *fixture, connection uuid.UUID, provider string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := f.admin.QueryRow(context.Background(), `SELECT id FROM app.banking_bindings WHERE connection_id=$1 AND provider_account_id=$2`, connection, provider).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}
func lifecycleHistory(t *testing.T, f *fixture, connection uuid.UUID) uuid.UUID {
	t.Helper()
	binding := lifecycleBinding(t, f, connection, "checking")
	created := f.service.RecordSource(f.actor(f.owner), sourceInput(binding))
	requireCode(t, created, "READY")
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,note,excluded,reviewed) VALUES($1,$2,1,1,'private annotation',true,true)`, created.ID, f.owner)
	return created.ID
}
func lifecycleEvent(t *testing.T, f *fixture, correlation uuid.UUID, item, code, account, reason string) int {
	t.Helper()
	signed := newWebhookFixture(t)
	handler, err := NewWebhookHandler(signed.verifier, f.service)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"environment": "sandbox", "item_id": item, "webhook_type": "ITEM", "webhook_code": code, "account_id": account, "error": map[string]string{"error_code_reason": reason}})
	return lifecycleSignedRequest(handler, correlation, body, signed.sign(t, body, signed.now, nil))
}
func lifecycleSignedRequest(handler http.Handler, correlation uuid.UUID, body []byte, signature string) int {
	request := httptest.NewRequest(http.MethodPost, "/banking/webhooks/"+correlation.String(), bytes.NewReader(body))
	request.Header.Set("Plaid-Verification", signature)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response.Code
}
func TestLifecycleSelectionRetainsSourceIdentityAndSibling(t *testing.T) {
	f, s, _, _, _ := lifecycleFixture(t)
	_, connection := lifecycleReady(t, f, s, f.owner, "checking", "savings")
	source := lifecycleHistory(t, f, connection)
	original := lifecycleBinding(t, f, connection, "checking")
	input := SelectionInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1, AccountIDs: []string{"savings"}}
	requireCode(t, s.ChangeSelection(f.actor(f.other), input), "NOT_FOUND")
	requireCode(t, s.ChangeSelection(f.actor(f.owner), input), "READY")
	requireCode(t, s.ChangeSelection(f.actor(f.owner), input), "READY")
	changed := input
	changed.AccountIDs = []string{"checking"}
	requireCode(t, s.ChangeSelection(f.actor(f.owner), changed), "CONFLICT")
	stale := input
	stale.AttemptID = uuid.New()
	requireCode(t, s.ChangeSelection(f.actor(f.owner), stale), "CONFLICT")
	_, status := f.service.ReadSource(f.actor(f.owner), source)
	requireCode(t, status, "READY")
	if queryInt(t, f, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND note='private annotation'`, source) != 1 {
		t.Fatal("annotation changed")
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_accounts a JOIN app.banking_bindings b ON b.account_id=a.id WHERE b.connection_id=$1 AND a.selected AND b.provider_account_id='savings'`, connection) != 1 {
		t.Fatal("selected sibling stopped")
	}
	blocked := sourceInput(original)
	blocked.AttemptID = uuid.New()
	blocked.ConnectionGeneration = 2
	blocked.BindingGeneration = 2
	blocked.ExpectedRevision = 1
	requireCode(t, f.service.RecordSource(f.actor(f.owner), blocked), "CONFLICT")
	input = SelectionInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 2, AccountIDs: []string{"checking", "savings", "card"}}
	requireCode(t, s.ChangeSelection(f.actor(f.owner), input), "READY")
	if lifecycleBinding(t, f, connection, "checking") != original {
		t.Fatal("reselection replaced source binding")
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE connection_id=$1 AND kind='teardown'`, connection) != 0 {
		t.Fatal("subset selection removed shared Item")
	}
	for _, ids := range [][]string{{"unsupported"}, {"foreign"}} {
		requireCode(t, s.ChangeSelection(f.actor(f.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 3, AccountIDs: ids}), "INVALID_SELECTION")
	}
	requireCode(t, s.ChangeSelection(f.actor(f.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 3, AccountIDs: []string{"checking", "checking"}}), "INVALID_INPUT")
	requireCode(t, s.ChangeSelection(f.actor(f.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 3, AccountIDs: []string{}}), "READY")
	if queryInt(t, f, `SELECT count(*) FROM app.banking_accounts a JOIN app.banking_bindings b ON b.account_id=a.id WHERE b.connection_id=$1 AND a.selected`, connection) != 0 {
		t.Fatal("empty subset still collects")
	}
}
func TestLifecycleRepairPreservesBindingAndRejectsChangedIdentity(t *testing.T) {
	f, s, p, _, _ := lifecycleFixture(t)
	_, connection := lifecycleReady(t, f, s, f.owner, "checking", "savings")
	source := lifecycleHistory(t, f, connection)
	original := lifecycleBinding(t, f, connection, "checking")
	input := RepairInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}
	if o := s.StartRepair(f.actor(f.other), input); o.Code != "NOT_FOUND" {
		t.Fatal(o.Code)
	}
	o := s.StartRepair(f.actor(f.owner), input)
	if o.Code != "PREPARED" || o.LinkToken != "repair-private" {
		t.Fatal(o.Code)
	}
	if replay := s.StartRepair(f.actor(f.owner), input); replay.LinkToken != o.LinkToken {
		t.Fatal("repair handoff unrecoverable")
	}
	if s.RepairStatus(f.actor(f.owner), input.AttemptID).LinkToken != "" {
		t.Fatal("status leaked handoff")
	}
	changed := input
	changed.ExpectedGeneration = 2
	if o := s.StartRepair(f.actor(f.owner), changed); o.Code != "CONFLICT" {
		t.Fatal(o.Code)
	}
	finish := FinishRepairInput{AttemptID: input.AttemptID, AccountIDs: []string{"checking"}}
	if o := s.FinishRepair(f.actor(f.owner), finish); o.Code != "READY" {
		t.Fatal(o.Code)
	}
	if o := s.FinishRepair(f.actor(f.owner), finish); o.Code != "READY" {
		t.Fatal("repair replay", o.Code)
	}
	finish.AccountIDs = []string{"savings"}
	if o := s.FinishRepair(f.actor(f.owner), finish); o.Code != "CONFLICT" {
		t.Fatal(o.Code)
	}
	if lifecycleBinding(t, f, connection, "checking") != original || queryInt(t, f, `SELECT count(*) FROM app.banking_sources WHERE id=$1`, source) != 1 {
		t.Fatal("repair rewrote history")
	}
	input = RepairInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 2}
	s.StartRepair(f.actor(f.owner), input)
	p.inventory.Accounts[0].StableID = "changed-canonical-account"
	if o := s.FinishRepair(f.actor(f.owner), FinishRepairInput{AttemptID: input.AttemptID, AccountIDs: []string{"checking"}}); o.Code != "REPLACEMENT_REQUIRED" {
		t.Fatal(o.Code)
	}
	if lifecycleGeneration(t, f, connection) != 2 {
		t.Fatal("identity mismatch mutated lifecycle")
	}
}
func TestLifecycleSignedRevocationIsDurableScopedAndTerminal(t *testing.T) {
	f, s, _, w, _ := lifecycleFixture(t)
	attempt, connection := lifecycleReady(t, f, s, f.owner, "checking", "savings")
	source := lifecycleHistory(t, f, connection)
	item := "item-public-" + attempt.String()
	signed := newWebhookFixture(t)
	handler, err := NewWebhookHandler(signed.verifier, f.service)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"environment": "sandbox", "item_id": item, "webhook_type": "ITEM", "webhook_code": "USER_ACCOUNT_REVOKED", "account_id": "checking"})
	signature := signed.sign(t, body, signed.now, nil)
	if status := lifecycleSignedRequest(handler, attempt, body, signature); status != 204 {
		t.Fatal(status)
	}
	if lifecycleGeneration(t, f, connection) != 2 {
		t.Fatal("account revocation not fenced")
	}
	if status := lifecycleSignedRequest(handler, attempt, body, signature); status != 204 || lifecycleGeneration(t, f, connection) != 2 {
		t.Fatal("duplicate advanced lifecycle")
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_accounts a JOIN app.banking_bindings b ON b.account_id=a.id WHERE b.connection_id=$1 AND a.selected AND b.provider_account_id='savings'`, connection) != 1 {
		t.Fatal("sibling revoked")
	}
	if status := lifecycleEvent(t, f, attempt, item, "NEW_ACCOUNTS_AVAILABLE", "", ""); status != 204 {
		t.Fatal(status)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_accounts a JOIN app.banking_bindings b ON b.account_id=a.id WHERE b.connection_id=$1 AND a.selected`, connection) != 1 {
		t.Fatal("new accounts broadened selection")
	}
	if status := lifecycleEvent(t, f, attempt, item, "ERROR", "", "OAUTH_USER_REVOKED"); status != 204 {
		t.Fatal(status)
	}
	c, status := f.service.ReadLifecycle(f.actor(f.owner), connection)
	requireCode(t, status, "READY")
	if c.State != "stopped" || c.Cleanup != "pending" {
		t.Fatal(c.State, c.Cleanup)
	}
	_, status = f.service.ReadSource(f.actor(f.owner), source)
	requireCode(t, status, "READY")
	for range 4 {
		if _, err := w.ProcessOne(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if status := lifecycleEvent(t, f, attempt, item, "LOGIN_REPAIRED", "", ""); status != 204 {
		t.Fatal(status)
	}
	c, _ = f.service.ReadLifecycle(f.actor(f.owner), connection)
	if c.State != "stopped" || c.Cleanup != "confirmed" {
		t.Fatal("healthy callback resurrected", c.State, c.Cleanup)
	}
}
func TestLifecycleLateRepairAfterStopDeleteAndIdentityLoss(t *testing.T) {
	for _, mode := range []string{"stop", "delete", "disabled", "identity_deleted"} {
		t.Run(mode, func(t *testing.T) {
			f, s, p, w, _ := lifecycleFixture(t)
			_, connection := lifecycleReady(t, f, s, f.owner, "checking")
			source := lifecycleHistory(t, f, connection)
			input := RepairInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}
			if o := s.StartRepair(f.actor(f.owner), input); o.Code != "PREPARED" {
				t.Fatal(o.Code)
			}
			p.beforeAccounts = func() {
				switch mode {
				case "stop":
					requireCode(t, f.service.Stop(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}), "READY")
				case "delete":
					requireCode(t, f.service.DeleteHistory(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}), "READY")
				case "disabled":
					f.exec(`UPDATE app.users SET enabled=false WHERE id=$1`, f.owner)
				case "identity_deleted":
					f.exec(`UPDATE app.users SET enabled=false WHERE id=$1`, f.owner)
					f.exec(`RESET ROLE`)
					f.exec(`DELETE FROM auth.users WHERE id=$1`, f.owner)
					f.exec(`SET ROLE kami_migrator`)
				}
			}
			result := s.FinishRepair(f.actor(f.owner), FinishRepairInput{AttemptID: input.AttemptID, AccountIDs: []string{"checking"}})
			if result.Code != "CONFLICT" && result.Code != "FORBIDDEN" {
				t.Fatal("late repair", result.Code)
			}
			p.beforeAccounts = nil
			for range 5 {
				if _, err := w.ProcessOne(context.Background()); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "delete" {
				if _, status := f.service.ReadSource(f.actor(f.owner), source); status.Code != "NOT_FOUND" {
					t.Fatal("delete did not hide source")
				}
			}
			// Confirmed removal invalidates the existing access token. Update mode keeps
			// that token/Item and cannot recreate a removed Item; late callbacks remain
			// terminal and cannot repeat exchange or grant local consent.
			if mode == "stop" || mode == "delete" {
				if o := s.FinishRepair(f.actor(f.owner), FinishRepairInput{AttemptID: input.AttemptID, AccountIDs: []string{"checking"}}); o.Code != "CONFLICT" {
					t.Fatal("late callback after teardown", o.Code)
				}
			}
			if queryInt(t, f, `SELECT count(*) FROM app.banking_connections WHERE id=$1 AND provider_removed`, connection) != 1 || queryInt(t, f, `SELECT count(*) FROM app.banking_credentials WHERE connection_id=$1`, connection) != 0 {
				t.Fatal("final teardown incomplete")
			}
			if queryInt(t, f, `SELECT count(*) FROM app.banking_repairs WHERE id=$1 AND link_ciphertext IS NOT NULL`, input.AttemptID) != 0 {
				t.Fatal("terminal handoff retained")
			}
		})
	}
}

func TestLifecycleOfflineDeselectionAndExpiringRepair(t *testing.T) {
	f, s, p, _, db := lifecycleFixture(t)
	_, connection := lifecycleReady(t, f, s, f.owner, "checking", "savings")
	source := lifecycleHistory(t, f, connection)
	p.failAccounts = true
	requireCode(t, s.ChangeSelection(f.actor(f.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1, AccountIDs: []string{"savings"}}), "READY")
	requireCode(t, s.ChangeSelection(f.actor(f.owner), SelectionInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 2, AccountIDs: []string{"checking", "savings"}}), "REPAIR_REQUIRED")
	c, status := f.service.ReadLifecycle(f.actor(f.owner), connection)
	requireCode(t, status, "READY")
	if c.Health != "repair_required" {
		t.Fatal("provider failure not actionable")
	}
	_, status = f.service.ReadSource(f.actor(f.owner), source)
	requireCode(t, status, "READY")
	p.failAccounts = false
	s.config.Enabled = false
	input := RepairInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 2}
	if o := s.StartRepair(f.actor(f.owner), input); o.Code != "PREPARED" {
		t.Fatal("new enrollment gate blocked repair", o.Code)
	}
	competing := input
	competing.AttemptID = uuid.New()
	if o := s.StartRepair(f.actor(f.owner), competing); o.Code != "ATTEMPT_IN_PROGRESS" {
		t.Fatal("parallel repair handoff", o.Code)
	}
	f.exec(`UPDATE app.banking_repairs SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, input.AttemptID)
	if o := s.StartRepair(f.actor(f.owner), input); o.LinkToken != "" || o.Code != "REPAIR_REQUIRED" {
		t.Fatal("expired handoff", o.Code)
	}
	if err := db.ReconcileBanking(context.Background()); err != nil {
		t.Fatal(err)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_repairs WHERE id=$1 AND link_ciphertext IS NOT NULL`, input.AttemptID) != 0 {
		t.Fatal("expired ciphertext retained")
	}
	if o := s.StartRepair(f.actor(f.owner), competing); o.Code != "PREPARED" {
		t.Fatal("expired attempt blocked repair", o.Code)
	}
	if o := s.FinishRepair(f.actor(f.owner), FinishRepairInput{AttemptID: competing.AttemptID, AccountIDs: []string{"savings"}}); o.Code != "READY" {
		t.Fatal(o.Code)
	}
	if queryInt(t, f, `SELECT count(*) FROM app.banking_accounts a JOIN app.banking_bindings b ON b.account_id=a.id WHERE b.connection_id=$1 AND a.selected`, connection) != 1 {
		t.Fatal("repair silently broadened selection")
	}
}

func TestLifecycleActualItemObservationRecoversMissedRevocation(t *testing.T) {
	for _, mode := range []string{"revoked", "login_required", "mismatched_item", "racing_disconnect"} {
		t.Run(mode, func(t *testing.T) {
			f, s, _, _, db := lifecycleFixture(t)
			attempt, connection := lifecycleReady(t, f, s, f.owner, "checking")
			source := lifecycleHistory(t, f, connection)
			item := "item-public-" + attempt.String()
			observations, removals := 0, 0
			provider := testPlaid(t, bankingRoundTrip(func(r *http.Request) (*http.Response, error) {
				var request struct {
					Access string `json:"access_token"`
				}
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.Access != "access-"+item {
					t.Fatal("observation credential did not match owned Item")
				}
				switch r.URL.Path {
				case "/item/get":
					observations++
					if mode == "racing_disconnect" {
						requireCode(t, f.service.Stop(f.actor(f.owner), FenceInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}), "READY")
					}
					reason := "OAUTH_USER_REVOKED"
					if mode == "login_required" {
						reason = "OAUTH_INVALID_TOKEN"
					}
					observedItem := item
					if mode == "mismatched_item" {
						observedItem = "unrelated-item"
					}
					return plaidTestResponse(200, fmt.Sprintf(`{"item":{"item_id":%q,"error":{"error_code":"ITEM_LOGIN_REQUIRED","error_code_reason":%q}}}`, observedItem, reason)), nil
				case "/item/remove":
					removals++
					return plaidTestResponse(200, `{"request_id":"confirmed-observation-removal"}`), nil
				default:
					t.Fatal("unexpected provider observation path")
					return nil, fmt.Errorf("unexpected controlled path")
				}
			}))
			worker, err := NewWorker(db, f.service.protector, provider)
			if err != nil {
				t.Fatal(err)
			}
			f.exec(`SELECT app.banking_enqueue($1,1,'reconcile')`, connection)
			for range 4 {
				if observations > 0 {
					break
				}
				if _, err := worker.ProcessOne(context.Background()); err != nil {
					t.Fatal(err)
				}
			}
			c, status := f.service.ReadLifecycle(f.actor(f.owner), connection)
			requireCode(t, status, "READY")
			if observations != 1 || (mode != "racing_disconnect" && c.Health != "repair_required") {
				t.Fatal("observation failure not actionable", observations, c.Health)
			}
			if mode == "revoked" || mode == "racing_disconnect" {
				if c.State != "stopped" || c.Generation != 2 || c.Cleanup != "pending" {
					t.Fatal("positive/stale revocation not fenced truthfully", c.State, c.Generation, c.Cleanup)
				}
				if queryInt(t, f, `SELECT count(*) FROM app.banking_work WHERE connection_id=$1 AND generation=2 AND kind='teardown'`, connection) != 1 {
					t.Fatal("teardown not durable or duplicated")
				}
				for range 4 {
					if _, err := worker.ProcessOne(context.Background()); err != nil {
						t.Fatal(err)
					}
				}
				c, _ = f.service.ReadLifecycle(f.actor(f.owner), connection)
				if c.Cleanup != "confirmed" || removals != 1 {
					t.Fatal("revocation did not use actual teardown", c.Cleanup, removals)
				}
			} else if c.State != "active" || c.Generation != 1 || c.Cleanup != "not_requested" || removals != 0 {
				t.Fatal("nonrevocation observation guessed terminal authority", c.State, c.Generation, c.Cleanup, removals)
			}
			_, status = f.service.ReadSource(f.actor(f.owner), source)
			requireCode(t, status, "READY")
			if queryInt(t, f, `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1`, source) != 1 {
				t.Fatal("observation erased annotations")
			}
			if _, err := database.IntegrationPool(f.db).Exec(context.Background(), `SELECT app.banking_observation_result($1,$2,false,true)`, uuid.New(), uuid.New()); err == nil {
				t.Fatal("API role acquired worker revocation authority")
			}
		})
	}
}

// discardFencedLifecycleTransport exercises the real restricted claim only when
// the earliest visible message is proven unauthorized. It asserts that fenced
// work cannot obtain a lease, before the caller's unchanged exact purge claim.
func discardFencedLifecycleTransport(t *testing.T, f *fixture, db *database.WorkerDB) {
	t.Helper()
	for poll := 0; poll < 100; poll++ {
		fenced := queryInt(t, f, `SELECT count(*) FROM (SELECT msg_id FROM pgmq.q_banking_lifecycle WHERE vt<=clock_timestamp() ORDER BY msg_id LIMIT 1) first_message JOIN app.banking_work w ON w.message_id=first_message.msg_id WHERE NOT app.banking_work_authorized(w.id)`)
		if fenced == 0 {
			return
		}
		if _, err := db.ClaimBankingWork(context.Background()); !database.IsEmptyBankingQueue(err) {
			t.Fatal("fenced transport unexpectedly acquired a lease", err)
		}
	}
	t.Fatal("fenced transport exceeded fixture disposal budget")
}

func TestLifecycleRepairReservationSurvivesMissingDependency(t *testing.T) {
	for _, mode := range []string{"missing_connection", "missing_credential", "deleted_after_claim"} {
		t.Run(mode, func(t *testing.T) {
			f, s, _, _, _ := lifecycleFixture(t)
			_, connection := lifecycleReady(t, f, s, f.owner, "checking")
			input := RepairInput{AttemptID: uuid.New(), ConnectionID: connection, ExpectedGeneration: 1}
			if mode == "missing_connection" {
				input.ConnectionID = uuid.New()
				outcome := s.StartRepair(f.actor(f.owner), input)
				if outcome.Code != "NOT_FOUND" || outcome.AttemptID != uuid.Nil || outcome.State != "" || queryInt(t, f, `SELECT count(*) FROM app.banking_repairs WHERE id=$1`, input.AttemptID) != 0 {
					t.Fatal("missing connection fabricated a reservation", outcome.Code, outcome.State)
				}
				return
			}
			// Interleave a real lifecycle fence or credential loss exactly after the
			// reservation commits its INSERT, before StartRepair reads dependencies.
			action := `DELETE FROM app.banking_credentials WHERE connection_id=NEW.connection_id;`
			if mode == "deleted_after_claim" {
				action = `PERFORM app.banking_fence(NEW.connection_id,NEW.generation,true);`
			}
			f.exec(`CREATE FUNCTION app.repair_dependency_test() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN ` + action + ` RETURN NEW; END $$`)
			f.exec(fmt.Sprintf(`CREATE TRIGGER repair_dependency_test AFTER INSERT ON app.banking_repairs FOR EACH ROW WHEN (NEW.connection_id='%s'::uuid) EXECUTE FUNCTION app.repair_dependency_test()`, connection))
			t.Cleanup(func() {
				f.exec(`DROP TRIGGER repair_dependency_test ON app.banking_repairs`)
				f.exec(`DROP FUNCTION app.repair_dependency_test()`)
			})
			outcome := s.StartRepair(f.actor(f.owner), input)
			wantCode, wantState, storedCode := "NOT_FOUND", "preparing", "PREPARING"
			if mode == "deleted_after_claim" {
				wantCode, wantState, storedCode = "CONFLICT", "complete", "CONFLICT"
			}
			if outcome.Code != wantCode || outcome.AttemptID != input.AttemptID || outcome.State != wantState || outcome.LinkToken != "" {
				t.Fatal("post-claim failure lost reservation", outcome.Code, outcome.State)
			}
			if queryInt(t, f, `SELECT count(*) FROM app.banking_repairs WHERE id=$1 AND state=$2 AND result_code=$3`, input.AttemptID, wantState, storedCode) != 1 {
				t.Fatal("post-claim failure changed durable repair")
			}
			status := s.RepairStatus(f.actor(f.owner), input.AttemptID)
			want := "PREPARING"
			if mode == "deleted_after_claim" {
				want = "CONFLICT"
			}
			if status.Code != want || status.State != wantState || status.AttemptID != input.AttemptID || status.LinkToken != "" {
				t.Fatal("reserved status lost identity or fence", status.Code, status.State)
			}
			if mode == "deleted_after_claim" {
				f.exec(`UPDATE app.banking_repairs SET state='preparing',result_code='PREPARING' WHERE id=$1`, input.AttemptID)
				status = s.RepairStatus(f.actor(f.owner), input.AttemptID)
				if status.Code != "CONFLICT" || status.State != "preparing" || status.AttemptID != input.AttemptID || status.LinkToken != "" {
					t.Fatal("incomplete receipt missed deletion fence", status.Code, status.State)
				}
			}
			other := s.RepairStatus(f.actor(f.other), input.AttemptID)
			if other.Code != "NOT_FOUND" || other.AttemptID != uuid.Nil || other.State != "" {
				t.Fatal("other actor saw reservation")
			}
			f.exec(`UPDATE app.banking_repairs SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, input.AttemptID)
			status = s.RepairStatus(f.actor(f.owner), input.AttemptID)
			if mode == "missing_credential" && (status.Code != "REPAIR_REQUIRED" || status.AttemptID != input.AttemptID || status.State != "preparing") {
				t.Fatal("missing credential blocked expiry recovery", status.Code, status.State)
			}
		})
	}
}
