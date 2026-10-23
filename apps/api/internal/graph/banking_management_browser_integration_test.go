//go:build integration

package graph_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/banking"
	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
	"github.com/haggaikaunda/kami-split/apps/api/internal/group"
	"github.com/haggaikaunda/kami-split/apps/api/internal/profile"
	"github.com/haggaikaunda/kami-split/apps/api/internal/reportingtimezone"
	"github.com/haggaikaunda/kami-split/apps/api/internal/server"
)

// managementBrowserProvider adds synthetic display metadata at the external
// provider boundary; it grants no production identity or domain authority.
type managementBrowserProvider struct {
	*bankingHTTPProvider
	mode atomic.Int32
}

func (p *managementBrowserProvider) Accounts(ctx context.Context, environment string, token banking.Credential) (banking.AccountInventory, error) {
	if p.mode.Load() == 1 {
		return banking.AccountInventory{}, fmt.Errorf("synthetic account inventory unavailable")
	}
	inventory, err := p.bankingHTTPProvider.Accounts(ctx, environment, token)
	if p.mode.Load() == 2 {
		inventory.Accounts = inventory.Accounts[:1]
	}
	inventory.InstitutionName = "Example Community Credit Union"
	return inventory, err
}

func (p *managementBrowserProvider) PrepareRepair(ctx context.Context, environment, client string, token banking.Credential) (banking.LinkPreparation, error) {
	if p.mode.Load() == 3 {
		return banking.LinkPreparation{}, fmt.Errorf("synthetic repair preparation unavailable")
	}
	return p.bankingHTTPProvider.PrepareRepair(ctx, environment, client, token)
}

// TestBankingManagementRealBrowserJourney connects the production browser to
// authenticated Go operations and restricted PostgreSQL. Only provider outcomes,
// imported facts and transport response loss are controlled fixtures.
func TestBankingManagementRealBrowserJourney(t *testing.T) {
	if os.Getenv("BANKING_MANAGEMENT_BROWSER_ORIGIN") == "" {
		t.Skip("opt-in bridge requires an exclusively owned production preview; this skip is not acceptance evidence")
	}
	if os.Getenv("BANKING_MANAGEMENT_PLAYWRIGHT_MODULE") == "" {
		t.Fatal("explicit Playwright module required for real browser acceptance")
	}
	for _, scenario := range []string{"lifecycle", "replacement", "repair-failure"} {
		t.Run(scenario, func(t *testing.T) { runBankingManagementBrowser(t, scenario) })
	}
}

func runBankingManagementBrowser(t *testing.T, scenario string) {
	f := newBankingHTTPFixture(t)
	t.Cleanup(func() {
		f.exec(`INSERT INTO app.banking_account_barriers(account_id,owner_id,connection_id,generation) SELECT DISTINCT ON(b.account_id) b.account_id,b.owner_id,b.connection_id,1 FROM app.banking_bindings b WHERE b.owner_id=$1 ON CONFLICT DO NOTHING`, f.owner)
		for _, table := range []string{"captures", "archives", "plan_sources", "plan_intervals", "plans", "annotations", "source_revisions", "sources", "repairs"} {
			if table == "source_revisions" {
				f.exec(`UPDATE app.banking_sources SET revision=NULL WHERE owner_id=$1`, f.owner)
			}
			f.exec(`DELETE FROM app.banking_`+table+` WHERE owner_id=$1`, f.owner)
		}
	})
	provider := &managementBrowserProvider{bankingHTTPProvider: f.provider}
	enrollment, err := banking.NewEnrollment(f.storage, provider, banking.EnrollmentConfig{Enabled: true, Environment: "sandbox", WebhookOrigin: "https://bank-http.example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	h := server.NewWithAuthentication(config.Config{}, graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{Banking: enrollment, BankingStorage: f.storage, Profiles: profile.New(f.db), Groups: group.New(f.db), Expenses: expense.New(f.db), ReportingTimezones: reportingtimezone.New(f.db)}}), slog.New(slog.NewJSONHandler(&f.logs, nil)), f.verifier).Handler()
	token := f.token(f.owner)
	initializeReportingHTTPZone(t, f, h, token)
	attempt := uuid.New()
	f.operation(h, bankingHTTPStart(attempt, "DIFFERENT"), token, "startBankingEnrollment", true)
	finish := fmt.Sprintf(`mutation{finishBankingEnrollment(input:{attemptId:%q,publicToken:%q,accountIds:["selected-checking","unselected-savings"]})%s}`, attempt.String(), "public-private-"+attempt.String(), bankingHTTPSelection)
	initial := f.operation(h, finish, token, "finishBankingEnrollment", false)
	if initial["code"] != "AWAITING_INITIAL_IMPORT" {
		t.Fatal("initial fixture enrollment", initial["code"])
	}
	connection := uuid.MustParse(initial["connectionId"].(string))
	var account, binding uuid.UUID
	if err := f.admin.QueryRow(context.Background(), `SELECT account_id,id FROM app.banking_bindings WHERE connection_id=$1 AND provider_account_id='selected-checking'`, connection).Scan(&account, &binding); err != nil {
		t.Fatal(err)
	}
	source := seedBankingManagementHistory(f, account, binding)
	f.exec(`UPDATE app.banking_bindings SET import_state='usable',last_local_commit=clock_timestamp() WHERE connection_id=$1`, connection)
	staged := uuid.Nil
	if scenario != "replacement" {
		f.exec(`UPDATE app.banking_connections SET health='repair_required' WHERE id=$1`, connection)
	} else {
		stage := uuid.New()
		start := fmt.Sprintf(`mutation{startBankingReplacement(input:{attemptId:%q,accountId:%q})%s}`, stage.String(), account.String(), bankingHTTPSelection)
		f.operation(h, start, token, "startBankingReplacement", true)
		result := f.operation(h, bankingHTTPFinish(stage, "selected-checking"), token, "finishBankingEnrollment", false)
		if result["code"] != "AWAITING_INITIAL_IMPORT" {
			t.Fatal("replacement fixture", result["code"])
		}
		if err := f.admin.QueryRow(context.Background(), `SELECT id FROM app.banking_bindings WHERE connection_id=$1 AND reporting_state='staged'`, result["connectionId"]).Scan(&staged); err != nil {
			t.Fatal(err)
		}
		f.exec(`UPDATE app.banking_bindings SET import_state='usable' WHERE id=$1`, staged)
		f.exec(`WITH source AS(INSERT INTO app.banking_sources(id,owner_id,binding_id,provider_transaction_id,revision) VALUES($1,$2,$3,'replacement-browser-source',1) RETURNING id) INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,amount_minor,currency,bank_date,processing_state,provider_code,mapping_version,stage) SELECT id,$2,1,5000,'USD','2026-10-02','posted','purchase','pfc-v2','current' FROM source`, uuid.New(), f.owner, staged)
	}
	if scenario == "repair-failure" {
		existing := uuid.New()
		result := f.operation(h, lifecycleHTTPFence("startBankingRepair", existing, connection, 1), token, "startBankingRepair", true)
		if result["code"] != "PREPARED" {
			t.Fatal("competing repair setup", result["code"])
		}
	}
	// Checkpoint writes are test setup/fault injection, never product endpoints.
	// The unguessable verified JWT gates this loopback-only fixture handler.
	mux := http.NewServeMux()
	mux.Handle("/", h)
	mux.HandleFunc("/fixture/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer "+token {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		var err error
		switch r.URL.Path {
		case "/fixture/expire-repair":
			_, err = f.admin.Exec(r.Context(), `UPDATE app.banking_repairs SET expires_at=clock_timestamp()-interval '1 minute' WHERE owner_id=$1`, f.owner)
		case "/fixture/provider-ready":
			provider.mode.Store(0)
		case "/fixture/provider-failure":
			provider.mode.Store(1)
		case "/fixture/provider-missing-account":
			provider.mode.Store(2)
		case "/fixture/provider-prepare-failure":
			provider.mode.Store(3)
		case "/fixture/unreserved", "/fixture/prepared-repair", "/fixture/completed-repair", "/fixture/terminal-selection":
			var input struct {
				AttemptID uuid.UUID `json:"attemptId"`
			}
			err = json.NewDecoder(r.Body).Decode(&input)
			if err == nil && input.AttemptID == uuid.Nil {
				err = fmt.Errorf("missing fixture attempt")
			}
			if err == nil {
				switch r.URL.Path {
				case "/fixture/unreserved":
					var n int
					err = f.admin.QueryRow(r.Context(), `SELECT count(*) FROM app.banking_repairs WHERE id=$1`, input.AttemptID).Scan(&n)
					if err == nil && n != 0 {
						err = fmt.Errorf("competing attempt unexpectedly reserved")
					}
				case "/fixture/prepared-repair", "/fixture/completed-repair":
					var state, code string
					var frozen bool
					err = f.admin.QueryRow(r.Context(), `SELECT state,result_code,finish_digest IS NOT NULL FROM app.banking_repairs WHERE id=$1 AND owner_id=$2`, input.AttemptID, f.owner).Scan(&state, &code, &frozen)
					if err == nil && r.URL.Path == "/fixture/prepared-repair" && (state != "prepared" || code != "PREPARED" || !frozen) {
						err = fmt.Errorf("provider failure lost prepared frozen attempt")
					}
					if err == nil && r.URL.Path == "/fixture/completed-repair" && (state != "complete" || code != "REPAIR_REQUIRED" || frozen) {
						err = fmt.Errorf("preparation failure not durably complete")
					}
				case "/fixture/terminal-selection":
					var state, code string
					err = f.admin.QueryRow(r.Context(), `SELECT state,result_code FROM app.banking_operations WHERE attempt_id=$1 AND owner_id=$2 AND kind='selection'`, input.AttemptID, f.owner).Scan(&state, &code)
					if err == nil && (state != "complete" || code != "INVALID_SELECTION") {
						err = fmt.Errorf("invalid selection not durably complete")
					}
				}
			}
		case "/fixture/retained":
			var annotations, current, staged, captures int
			err = f.admin.QueryRow(r.Context(), `SELECT (SELECT count(*) FROM app.banking_annotations WHERE source_id=$1),(SELECT count(*) FROM app.banking_source_revisions WHERE source_id=$1 AND stage='current'),(SELECT count(*) FROM app.banking_source_revisions WHERE source_id=$1 AND stage='staged'),(SELECT count(*) FROM app.banking_captures WHERE source_id=$1 AND annotation_revision=2)`, source).Scan(&annotations, &current, &staged, &captures)
			if err == nil && (annotations != 2 || current != 1 || staged != 1 || captures != 1) {
				err = fmt.Errorf("retained provenance invariant")
			}
		case "/fixture/selection":
			var checking, savings bool
			err = f.admin.QueryRow(r.Context(), `SELECT bool_and(a.selected) FILTER(WHERE b.provider_account_id='selected-checking'),bool_or(a.selected) FILTER(WHERE b.provider_account_id='unselected-savings') FROM app.banking_bindings b JOIN app.banking_accounts a ON a.id=b.account_id WHERE b.connection_id=$1`, connection).Scan(&checking, &savings)
			if err == nil && (!checking || savings) {
				err = fmt.Errorf("selection invariant")
			}
		case "/fixture/conflict":
			_, err = f.admin.Exec(r.Context(), `UPDATE app.banking_bindings SET data_revision=data_revision+1 WHERE id=$1`, binding)
		default:
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "fixture invariant failed", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	endpoint := httptest.NewServer(mux)
	defer endpoint.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", "../../../../scripts/banking-management-real-browser.cjs")
	cmd.Env = append(os.Environ(), "BANKING_MANAGEMENT_ENDPOINT="+endpoint.URL, "BANKING_MANAGEMENT_TOKEN="+token, "BANKING_MANAGEMENT_SUBJECT="+f.owner.String(), "BANKING_MANAGEMENT_CONNECTION="+connection.String(), "BANKING_MANAGEMENT_BINDING="+staged.String(), "BANKING_MANAGEMENT_SCENARIO="+scenario, "BANKING_MANAGEMENT_OTHER_TOKEN="+f.token(f.other), "BANKING_MANAGEMENT_OTHER_SUBJECT="+f.other.String())
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("real banking browser: %v: %s", err, output)
	}
	t.Log(string(output))
	if scenario == "replacement" {
		var n int
		if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_plans WHERE account_id=$1`, account).Scan(&n); err != nil || n < 3 {
			t.Fatal("activation and recovery did not persist plans", n, err)
		}

		var retired string
		var retained int
		var current, archived int
		if err := f.admin.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM app.banking_plan_sources WHERE plan_id=(SELECT id FROM app.banking_plans WHERE account_id=$1 ORDER BY revision DESC LIMIT 1) AND source_id=$2),(SELECT count(*) FROM app.banking_captures c JOIN app.banking_sources s ON s.id=c.source_id WHERE s.binding_id=$3)`, account, source, staged).Scan(&current, &archived); err != nil || current != 1 || archived < 1 {
			t.Fatal("recovery lost original reporting or later archive", current, archived, err)
		}
		if err := f.admin.QueryRow(context.Background(), `SELECT reporting_state FROM app.banking_bindings WHERE id=$1`, binding).Scan(&retired); err != nil || retired != "retired" {
			t.Fatal("recovery restored collection authority", err)
		}
		if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1 AND note='latest private annotation'`, source).Scan(&retained); err != nil || retained != 1 {
			t.Fatal("recovery changed original private annotation", err)
		}
		return
	}
	if scenario == "repair-failure" {
		var pending, selected int
		if err := f.admin.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM app.banking_repairs WHERE owner_id=$1 AND state<>'complete'),(SELECT count(*) FROM app.banking_accounts a JOIN app.banking_bindings b ON b.account_id=a.id WHERE b.connection_id=$2 AND a.selected)`, f.owner, connection).Scan(&pending, &selected); err != nil || pending != 0 || selected != 2 {
			t.Fatal("repair/selection recovery left blocked or changed state", pending, selected, err)
		}
		return
	}
	projection := f.operation(h, lifecycleHTTPRead(connection), token, "bankingConnection", false)["connection"].(map[string]any)
	if projection["state"] != "deleted" || projection["cleanup"] != "pending" || len(projection["accounts"].([]any)) != 0 {
		t.Fatal("browser deletion did not fence/hide or claimed remote completion")
	}
	workerDB, err := database.OpenWorker(context.Background(), database.Config{URL: os.Getenv("TEST_WORKER_DATABASE_URL"), MaxConns: 3, Timeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer workerDB.Close()
	protector, _ := banking.NewProtector("http", map[string][]byte{"http": bytes.Repeat([]byte{87}, 32)})
	worker, err := banking.NewWorker(workerDB, protector, f.provider)
	if err != nil {
		t.Fatal(err)
	}
	// Advance only this fixture's deferred queue visibility between bounded batches.
	// This avoids wall-clock retry delays without bypassing real claims or purge SQL.
	for range 32 {
		f.exec(`UPDATE app.banking_work SET due_at=clock_timestamp()-interval '1 second' WHERE connection_id=$1 AND state='pending' AND kind IN('purge','teardown')`, connection)
		f.exec(`SELECT pgmq.set_vt('banking_lifecycle',message_id,0) FROM app.banking_work WHERE connection_id=$1 AND state='pending' AND kind IN('purge','teardown')`, connection)
		if _, err := worker.ProcessOne(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	for _, table := range []string{"sources", "source_revisions", "annotations", "captures", "archives", "plans"} {
		var n int
		if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_`+table+` WHERE owner_id=$1`, f.owner).Scan(&n); err != nil || n != 0 {
			t.Fatal("browser delete payload survived worker", table, n, err)
		}
	}
}

// Seed only imported provider facts, a staged batch and archive provenance.
// Product enrollment, selection, fencing and plan changes remain real operations.
func seedBankingManagementHistory(f *bankingHTTPFixture, account, binding uuid.UUID) uuid.UUID {
	source, plan, archive := uuid.New(), uuid.New(), uuid.New()
	f.exec(`WITH source AS(INSERT INTO app.banking_sources(id,owner_id,binding_id,provider_transaction_id,revision) VALUES($1,$2,$3,'management-browser-source',1) RETURNING id) INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,amount_minor,currency,bank_date,processing_state,provider_code,mapping_version,stage) SELECT id,$2,1,1250,'USD','2026-09-30','posted','purchase','pfc-v2','current' FROM source`, source, f.owner, binding)
	f.exec(`INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,amount_minor,currency,bank_date,processing_state,provider_code,mapping_version,stage,batch_id) VALUES($1,$2,2,1250,'USD','2026-09-30','posted','purchase','pfc-v2','staged',$3)`, source, f.owner, uuid.New())
	f.exec(`INSERT INTO app.banking_annotations(source_id,owner_id,revision,material_source_revision,note) VALUES($1,$2,1,1,'retained private annotation'),($1,$2,2,1,'latest private annotation')`, source, f.owner)
	f.exec(`INSERT INTO app.banking_plans(id,owner_id,account_id,revision,active_binding_id) VALUES($1,$2,$3,1,$4)`, plan, f.owner, account, binding)
	f.exec(`INSERT INTO app.banking_plan_intervals(plan_id,owner_id,binding_id) VALUES($1,$2,$3)`, plan, f.owner, binding)
	f.exec(`INSERT INTO app.banking_plan_sources(plan_id,owner_id,source_id,source_revision) VALUES($1,$2,$3,1)`, plan, f.owner, source)
	f.exec(`INSERT INTO app.banking_archives(id,owner_id,plan_id,boundary_date) VALUES($1,$2,$3,'2026-09-30')`, archive, f.owner, plan)
	f.exec(`INSERT INTO app.banking_captures(archive_id,owner_id,source_id,source_revision,annotation_revision) VALUES($1,$2,$3,1,2)`, archive, f.owner, source)
	return source
}
