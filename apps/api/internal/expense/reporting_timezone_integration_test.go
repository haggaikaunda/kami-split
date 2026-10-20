//go:build integration

package expense_test

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const timezoneFields = `__typename ... on ReportingTimezone { timezone version } ... on ReportingTimezoneProblem { code message }`
const timezoneRead = `query { reportingTimezone { ` + timezoneFields + ` } }`
const timezoneInitialize = `mutation($key:OperationKey!,$zone:String) { initializeReportingTimezone(attemptId:$key,deviceTimezone:$zone) { ` + timezoneFields + ` } }`
const timezoneUpdate = `mutation($key:OperationKey!,$zone:String!,$version:ReportingTimezoneVersion!) { updateReportingTimezone(attemptId:$key,timezone:$zone,expectedVersion:$version) { ` + timezoneFields + ` } }`
const timezoneRecover = `query($key:OperationKey!,$kind:ReportingTimezoneOperation!) { reportingTimezoneAttempt(operation:$kind,attemptId:$key) { ` + timezoneFields + ` } }`

func timezoneRequest(t *testing.T, f *expenseFixture, actor int, query, field string, variables map[string]any) map[string]any {
	t.Helper()
	_, body, err := groupHTTP(f, actor, query, variables)
	if err != nil {
		t.Fatal(err)
	}
	var response struct {
		Data   map[string]map[string]any
		Errors []any
	}
	if json.Unmarshal(body, &response) != nil || len(response.Errors) > 0 || response.Data[field] == nil {
		t.Fatalf("unexpected timezone response: %s", body)
	}
	return response.Data[field]
}

func requireTimezone(t *testing.T, out map[string]any, zone, version string) {
	t.Helper()
	if out["__typename"] != "ReportingTimezone" || out["timezone"] != zone || out["version"] != version {
		t.Fatalf("want %s/%s: %+v", zone, version, out)
	}
}
func requireTimezoneCode(t *testing.T, out map[string]any, code string) {
	t.Helper()
	if out["__typename"] != "ReportingTimezoneProblem" || out["code"] != code || out["timezone"] != nil {
		t.Fatalf("want %s: %+v", code, out)
	}
}

func TestReportingTimezonePersistenceRecoveryAndIsolation(t *testing.T) {
	f := newExpenseFixture(t)
	// The ordinary group fixture has no bank connection. Cleanup is test-owned and
	// precedes the fixture's trigger-disabled identity teardown.
	t.Cleanup(func() {
		timezoneFixtureOwner(t, f, func(ctx context.Context, tx pgx.Tx) error {
			for _, table := range []string{"reporting_timezone_attempts", "reporting_timezones"} {
				if _, err := tx.Exec(ctx, `DELETE FROM app.`+table+` WHERE owner_id IN ($1,$2)`, f.id(101), f.id(102)); err != nil {
					return err
				}
			}
			return nil
		})
	})
	read := func(actor int) map[string]any {
		return timezoneRequest(t, f, actor, timezoneRead, "reportingTimezone", nil)
	}
	initialize := func(actor int, key string, zone any) map[string]any {
		return timezoneRequest(t, f, actor, timezoneInitialize, "initializeReportingTimezone", map[string]any{"key": key, "zone": zone})
	}
	update := func(actor int, key, zone, version string) map[string]any {
		return timezoneRequest(t, f, actor, timezoneUpdate, "updateReportingTimezone", map[string]any{"key": key, "zone": zone, "version": version})
	}
	recover := func(actor int, key, kind string) map[string]any {
		return timezoneRequest(t, f, actor, timezoneRecover, "reportingTimezoneAttempt", map[string]any{"key": key, "kind": kind})
	}
	requireTimezoneCode(t, read(2), "NOT_INITIALIZED")
	requireTimezoneCode(t, update(2, uuid.NewString(), "UTC", "1"), "NOT_INITIALIZED")
	fallbackKey := uuid.NewString()
	requireTimezone(t, initialize(1, fallbackKey, nil), "UTC", "1")
	requireTimezone(t, initialize(1, uuid.NewString(), "Pacific/Auckland"), "UTC", "1")
	initKey := uuid.NewString()
	requireTimezone(t, initialize(2, initKey, "America/Los_Angeles"), "America/Los_Angeles", "1")
	requireTimezone(t, read(2), "America/Los_Angeles", "1")
	requireTimezoneCode(t, recover(1, initKey, "INITIALIZE"), "NOT_FOUND")
	requireTimezoneCode(t, initialize(2, initKey, "Asia/Tokyo"), "ATTEMPT_MISMATCH")
	for _, zone := range []string{"", "Local", "localtime", "posixrules", "+03:00", "UTC+3", "GMT+5", "EST5EDT,M3.2.0,M11.1.0", "posix/America/New_York", "right/UTC", "../UTC", "Mars/Olympus"} {
		key := uuid.NewString()
		requireTimezoneCode(t, update(2, key, zone, "1"), "INVALID_INPUT")
		requireTimezoneCode(t, recover(2, key, "UPDATE"), "INVALID_INPUT")
	}
	requireTimezone(t, read(2), "America/Los_Angeles", "1")
	firstKey := uuid.NewString()
	requireTimezone(t, update(2, firstKey, "Asia/Tokyo", "1"), "Asia/Tokyo", "2")
	requireTimezone(t, update(2, uuid.NewString(), "Europe/London", "2"), "Europe/London", "3")
	// Lost response/restart recovery replays the original immutable value after later edits.
	requireTimezone(t, update(2, firstKey, "Asia/Tokyo", "1"), "Asia/Tokyo", "2")
	requireTimezone(t, recover(2, firstKey, "UPDATE"), "Asia/Tokyo", "2")
	requireTimezone(t, recover(2, initKey, "INITIALIZE"), "America/Los_Angeles", "1")
	requireTimezone(t, read(2), "Europe/London", "3")
	requireTimezoneCode(t, update(2, firstKey, "Asia/Tokyo", "3"), "ATTEMPT_MISMATCH")
	requireTimezoneCode(t, update(2, firstKey, "Europe/Paris", "1"), "ATTEMPT_MISMATCH")
	staleKey := uuid.NewString()
	requireTimezoneCode(t, update(2, staleKey, "Asia/Tokyo", "1"), "CONFLICT")
	requireTimezoneCode(t, recover(2, staleKey, "UPDATE"), "CONFLICT")
	requireTimezoneCode(t, update(2, staleKey, "Asia/Tokyo", "3"), "ATTEMPT_MISMATCH")
	requireTimezone(t, read(1), "UTC", "1")
	// Direct SQL gets the same strict timezone validation, no target ID/table grants.
	err := f.db.WithIdentity(f.ctx, f.id(2), func(tx pgx.Tx) error {
		var code string
		var zone *string
		var version *int64
		if err := tx.QueryRow(f.ctx, `SELECT * FROM app.write_reporting_timezone('UPDATE',$1,'Local',3)`, uuid.New()).Scan(&code, &zone, &version); err != nil {
			return err
		}
		if code != "INVALID_INPUT" {
			return fmt.Errorf("direct SQL accepted Local: %s", code)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{`SELECT * FROM app.reporting_timezones`, `SELECT * FROM app.reporting_timezone_attempts`, `UPDATE app.reporting_timezones SET timezone='UTC'`} {
		if err := f.db.WithIdentity(f.ctx, f.id(1), func(tx pgx.Tx) error { _, err := tx.Exec(f.ctx, sql); return err }); err == nil {
			t.Fatal("runtime table access allowed", sql)
		}
	}
	for _, query := range []string{`query { reportingTimezone(ownerId:"` + f.id(102) + `") { __typename } }`, `query { node(id:"` + f.public("ReportingTimezone", 102) + `") { id } }`} {
		_, body, err := groupHTTP(f, 1, query, nil)
		if err != nil {
			t.Fatal(err)
		}
		var response struct {
			Data   map[string]any
			Errors []any
		}
		if json.Unmarshal(body, &response) != nil {
			t.Fatal(string(body))
		}
		if len(response.Errors) == 0 && response.Data["node"] != nil {
			t.Fatal("direct target exposed", string(body))
		}
	}
	requireTimezoneCode(t, read(5), "FORBIDDEN")
	requireTimezoneCode(t, initialize(5, uuid.NewString(), nil), "FORBIDDEN")
	for _, query := range []string{timezoneRead, `query { reportingTimezoneAttempt(operation:UPDATE,attemptId:"` + firstKey + `") { ` + timezoneFields + ` } }`, `mutation { initializeReportingTimezone(attemptId:"` + uuid.NewString() + `") { ` + timezoneFields + ` } }`, `mutation { updateReportingTimezone(attemptId:"` + uuid.NewString() + `",timezone:"UTC",expectedVersion:"3") { ` + timezoneFields + ` } }`} {
		_, body, err := groupHTTP(f, 0, query, nil)
		if err != nil {
			t.Fatal(err)
		}
		var response struct{ Errors []any }
		if json.Unmarshal(body, &response) != nil || len(response.Errors) == 0 {
			t.Fatal("anonymous accepted", string(body))
		}
	}
	for _, change := range []string{"enabled=false", "enabled=false,live_auth_id=NULL"} {
		f.exec(fmt.Sprintf(`SET ROLE kami_migrator;UPDATE app.users SET %s WHERE id='%s';RESET ROLE`, change, f.id(102)))
		requireTimezoneCode(t, read(2), "FORBIDDEN")
		requireTimezoneCode(t, recover(2, firstKey, "UPDATE"), "FORBIDDEN")
		requireTimezoneCode(t, initialize(2, uuid.NewString(), nil), "FORBIDDEN")
		requireTimezoneCode(t, update(2, uuid.NewString(), "UTC", "3"), "FORBIDDEN")
	}
}

func TestReportingTimezoneConcurrentInitializationUpdatesAndSettings(t *testing.T) {
	f := newExpenseFixture(t)
	t.Cleanup(func() {
		timezoneFixtureOwner(t, f, func(ctx context.Context, tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `DELETE FROM app.reporting_timezone_attempts WHERE owner_id=$1`, f.id(102))
			if err != nil {
				return err
			}
			_, err = tx.Exec(ctx, `DELETE FROM app.reporting_timezones WHERE owner_id=$1`, f.id(102))
			return err
		})
	})
	runConcurrent := func(query, field string, inputs []map[string]any) []map[string]any {
		t.Helper()
		var wg sync.WaitGroup
		out := make(chan map[string]any, len(inputs))
		for _, input := range inputs {
			wg.Add(1)
			go func(input map[string]any) { defer wg.Done(); out <- timezoneRequest(t, f, 2, query, field, input) }(input)
		}
		wg.Wait()
		close(out)
		var results []map[string]any
		for result := range out {
			results = append(results, result)
		}
		return results
	}
	results := runConcurrent(timezoneInitialize, "initializeReportingTimezone", []map[string]any{{"key": uuid.NewString(), "zone": "Pacific/Auckland"}, {"key": uuid.NewString(), "zone": "Asia/Tokyo"}})
	if len(results) != 2 {
		t.Fatal(results)
	}
	winner := results[0]["timezone"].(string)
	for _, out := range results {
		requireTimezone(t, out, winner, "1")
	}
	requireTimezone(t, timezoneRequest(t, f, 2, timezoneRead, "reportingTimezone", nil), winner, "1")
	results = runConcurrent(timezoneUpdate, "updateReportingTimezone", []map[string]any{{"key": uuid.NewString(), "zone": "UTC", "version": "1"}, {"key": uuid.NewString(), "zone": "Europe/Paris", "version": "1"}})
	ready, conflicts := 0, 0
	for _, out := range results {
		if out["version"] == "2" {
			ready++
		}
		if out["code"] == "CONFLICT" {
			conflicts++
		}
	}
	if ready != 1 || conflicts != 1 {
		t.Fatal(results)
	}
	same := map[string]any{"key": uuid.NewString(), "zone": "Europe/London", "version": "2"}
	results = runConcurrent(timezoneUpdate, "updateReportingTimezone", []map[string]any{same, same})
	for _, out := range results {
		requireTimezone(t, out, "Europe/London", "3")
	}
	// Seed exact date-only provider facts through the fixture administrator. Preference
	// writes have no path to these immutable records, including leap/period boundaries.
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator;
 INSERT INTO app.banking_connections(id,owner_id,environment,provider,provider_item_id) VALUES('%s','%s','sandbox','plaid','timezone-fixture');
 INSERT INTO app.banking_accounts(id,owner_id,kind) VALUES('%s','%s','checking');
 INSERT INTO app.banking_bindings(id,owner_id,connection_id,account_id,provider_account_id) VALUES('%s','%s','%s','%s','timezone-account');
 INSERT INTO app.banking_sources(id,owner_id,binding_id,provider_transaction_id,revision) VALUES('%s','%s','%s','timezone-tx',1);
 INSERT INTO app.banking_source_revisions(source_id,owner_id,revision,amount_minor,currency,bank_date,authorization_date,processing_state,mapping_version,stage) VALUES('%s','%s',1,123,'USD','2024-03-01','2024-02-29','posted','fixture','current');RESET ROLE`, f.id(901), f.id(102), f.id(902), f.id(102), f.id(903), f.id(102), f.id(901), f.id(902), f.id(904), f.id(102), f.id(903), f.id(904), f.id(102)))
	t.Cleanup(func() {
		f.exec(fmt.Sprintf(`BEGIN;SET LOCAL session_replication_role=replica;SET LOCAL ROLE kami_migrator;DELETE FROM app.banking_source_revisions WHERE source_id='%s';DELETE FROM app.banking_sources WHERE id='%s';DELETE FROM app.banking_bindings WHERE id='%s';DELETE FROM app.banking_accounts WHERE id='%s';DELETE FROM app.banking_connections WHERE id='%s';COMMIT`, f.id(904), f.id(904), f.id(903), f.id(902), f.id(901)))
	})
	snapshot := func() string {
		t.Helper()
		var out string
		timezoneFixtureOwner(t, f, func(ctx context.Context, tx pgx.Tx) error {
			return tx.QueryRow(ctx, `SELECT to_jsonb(r)::text FROM app.banking_source_revisions r WHERE source_id=$1`, f.id(904)).Scan(&out)
		})
		return out
	}
	before := snapshot()
	var wg sync.WaitGroup
	wg.Add(3)
	go func() {
		defer wg.Done()
		timezoneRequest(t, f, 2, timezoneUpdate, "updateReportingTimezone", map[string]any{"key": uuid.NewString(), "zone": "America/New_York", "version": "3"})
	}()
	go func() {
		defer wg.Done()
		groupRequest(t, f, 2, `mutation { updateMyProfile(displayName:"Independent",expectedDisplayName:"Actor 2") { __typename ... on Profile { displayName } } }`, nil, "updateMyProfile", "Profile")
	}()
	go func() {
		defer wg.Done()
		groupRequest(t, f, 2, `mutation { updateMyAppearance(appearance:DARK,expectedAppearance:SYSTEM) { __typename ... on Profile { appearance } } }`, nil, "updateMyAppearance", "Profile")
	}()
	wg.Wait()
	requireTimezone(t, timezoneRequest(t, f, 2, timezoneRead, "reportingTimezone", nil), "America/New_York", "4")
	profile := groupRequest(t, f, 2, `query { currentProfile { __typename ... on Profile { displayName appearance } } }`, nil, "currentProfile", "Profile")
	if profile["displayName"] != "Independent" || profile["appearance"] != "DARK" {
		t.Fatal(profile)
	}
	if snapshot() != before {
		t.Fatal("timezone update changed stored date facts")
	}
}

// Explicit local ownership keeps probes/cleanup independent of administrative
// login inheritance. The transaction restores the role even on a failed probe.
func timezoneFixtureOwner(t *testing.T, f *expenseFixture, run func(context.Context, pgx.Tx) error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err := pgx.BeginTxFunc(ctx, f.admin, pgx.TxOptions{}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SET LOCAL ROLE kami_migrator"); err != nil {
			return err
		}
		return run(ctx, tx)
	})
	if err != nil {
		t.Fatal(err)
	}
}
