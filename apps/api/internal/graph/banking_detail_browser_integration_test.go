//go:build integration

package graph_test

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/banking"
	"github.com/haggaikaunda/kami-split/apps/api/internal/config"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph"
	"github.com/haggaikaunda/kami-split/apps/api/internal/group"
	"github.com/haggaikaunda/kami-split/apps/api/internal/profile"
	"github.com/haggaikaunda/kami-split/apps/api/internal/reportingtimezone"
	"github.com/haggaikaunda/kami-split/apps/api/internal/server"
)

// TestBankingDetailRealBrowserJourney exercises the production client against
// signed HTTP authentication and restricted PostgreSQL operations. The caller
// supplies an isolated production preview and explicitly disposable database.
func TestBankingDetailRealBrowserJourney(t *testing.T) {
	if os.Getenv("BANKING_DETAIL_BROWSER_ORIGIN") == "" {
		t.Skip("optional real browser journey requires an owned production preview")
	}
	f := newReportingHTTPFixture(t)
	// Keep target rows on page one; older purchases make the complete summary
	// differ from any sum of the first 50 loaded records.
	f.exec(`UPDATE app.banking_source_revisions SET name='Exact private purchase',bank_date='2024-02-29',authorization_date='2024-02-27' WHERE source_id=$1`, f.sources["purchase"])
	for index := 0; index < 60; index++ {
		f.exec(`WITH source AS (INSERT INTO app.banking_sources(id,owner_id,binding_id,provider_transaction_id,revision) VALUES($1,$2,$3,$4,1) RETURNING id)
 INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,material_revision,amount_minor,currency,bank_date,processing_state,provider_primary_category,provider_category,provider_confidence,provider_code,mapping_version,stage,name)
 SELECT id,$2,1,1,100,'USD','2024-02-02','posted','FOOD_AND_DRINK','FOOD_AND_DRINK_GROCERIES','HIGH','purchase','plaid-pfc-v2','current','Older page purchase' FROM source`, uuid.New(), f.owner, f.binding, uuid.NewString())
	}
	archive := prepareDetailBrowserArchive(t, f)
	enrollment, err := banking.NewEnrollment(f.storage, f.provider, banking.EnrollmentConfig{Enabled: false, Environment: "sandbox", WebhookOrigin: "https://bank-http.example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	// Add the ordinary profile/group reads needed by the production shell. No
	// browser-specific production bypass or fabricated GraphQL result is used.
	handler := server.NewWithAuthentication(config.Config{}, graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{
		Banking: enrollment, BankingStorage: f.storage, Profiles: profile.New(f.db), Groups: group.New(f.db), Expenses: expense.New(f.db), ReportingTimezones: reportingtimezone.New(f.db),
	}}), slog.New(slog.NewJSONHandler(io.Discard, nil)), f.verifier).Handler()
	endpoint := httptest.NewServer(handler)
	t.Cleanup(endpoint.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", "../../../../scripts/banking-detail-real-browser.cjs")
	cmd.Env = append(os.Environ(), "BANKING_DETAIL_BROWSER_ENDPOINT="+endpoint.URL,
		"BANKING_DETAIL_BROWSER_TOKEN="+f.token, "BANKING_DETAIL_BROWSER_SUBJECT="+f.owner.String(),
		"BANKING_DETAIL_BROWSER_FOREIGN_TOKEN="+f.bankingHTTPFixture.token(f.other),
		"BANKING_DETAIL_BROWSER_SOURCE="+f.sources["purchase"].String(), "BANKING_DETAIL_BROWSER_ACCOUNT="+f.account.String(),
		"BANKING_DETAIL_BROWSER_ARCHIVE="+archive.String(), "BANKING_DETAIL_BROWSER_ARCHIVE_SOURCE="+f.sources["next-month"].String())
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("real banking detail browser journey: %v: %s", err, output)
	}
	t.Log(string(output))
	// The browser performs exactly eight successful single-field writes: initial
	// note, exclude/include, activity/reset, concurrent note, rebased draft and
	// recovered note.
	// Count is passed back through persisted state rather than trusting a toast.
	var count int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.banking_annotations WHERE source_id=$1`, f.sources["purchase"]).Scan(&count); err != nil || count != 8 {
		t.Fatalf("unexpected persisted annotation count: %d (expected eight)", count)
	}
	row := f.detail(f.sources["purchase"])["transaction"].(map[string]any)
	requireStatusFields(t, row, map[string]any{"note": "Recovered original save", "amountMinor": "10000", "bankDate": "2024-02-29", "annotationRevision": "8"})
}

func prepareDetailBrowserArchive(t *testing.T, f *reportingHTTPFixture) uuid.UUID {
	t.Helper()
	archivedSource := f.sources["next-month"]
	f.exec(`UPDATE app.banking_source_revisions SET name='Archived-only transaction' WHERE source_id=$1`, archivedSource)
	result := f.operation(f.handler, reportingHTTPAnnotation(uuid.New(), archivedSource, "0", "NOTE", `"Original captured private note"`), f.token, "editBankingAnnotation", false)
	if result["code"] != "READY" {
		t.Fatal("archive annotation preparation failed")
	}
	plan, archive := uuid.New(), uuid.New()
	t.Cleanup(func() {
		f.exec(`DELETE FROM app.banking_captures WHERE archive_id=$1`, archive)
		f.exec(`DELETE FROM app.banking_archives WHERE id=$1`, archive)
		f.exec(`DELETE FROM app.banking_plan_intervals WHERE plan_id=$1`, plan)
		f.exec(`DELETE FROM app.banking_plans WHERE id=$1`, plan)
	})
	// A bounded saved reporting plan retains all February facts in current
	// reporting, with the March source only in the immutable recovery archive.
	f.exec(`INSERT INTO app.banking_plans(id,owner_id,account_id,revision,active_binding_id) VALUES($1,$2,$3,1,$4)`, plan, f.owner, f.account, f.binding)
	f.exec(`INSERT INTO app.banking_plan_intervals(plan_id,owner_id,binding_id,through_date) VALUES($1,$2,$3,'2024-02-29')`, plan, f.owner, f.binding)
	f.exec(`INSERT INTO app.banking_archives(id,owner_id,plan_id,boundary_date) VALUES($1,$2,$3,'2024-03-01')`, archive, f.owner, plan)
	f.exec(`INSERT INTO app.banking_captures(archive_id,owner_id,source_id,source_revision,annotation_revision) VALUES($1,$2,$3,1,NULL),($1,$2,$4,1,1)`, archive, f.owner, f.sources["purchase"], archivedSource)
	query := fmt.Sprintf(`query{bankingTransaction(sourceId:%q,archiveId:%q)%s}`, archivedSource.String(), archive.String(), reportingHTTPDetailFields)
	detail := f.operation(f.handler, query, f.token, "bankingTransaction", false)
	if detail["code"] != "READY" || detail["currentId"] != nil {
		t.Fatal("archive-only fixture unexpectedly has a current edit owner")
	}
	return archive
}
