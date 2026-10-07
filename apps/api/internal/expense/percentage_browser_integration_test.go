//go:build integration

package expense_test

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"testing"
)

// This manual browser pass supplements required database CI; the production web
// server and externally installed Chromium/Playwright must be supplied explicitly.
func TestPercentageRealBrowserJourney(t *testing.T) {
	origin := os.Getenv("PERCENTAGE_BROWSER_ORIGIN")
	if origin == "" {
		t.Skip("optional browser evidence requires a production web preview")
	}
	f := newGroupTransportFixture(t)
	// Both Household members can use the Trip as an authorized original ledger.
	f.exec(fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; INSERT INTO app.memberships(id,group_id,user_id) VALUES('%s','%s','%s'),('%s','%s','%s'); INSERT INTO app.group_trip(group_id,destination,start_date,end_date) VALUES('%s','Kyoto','2026-10-01','2026-10-08'); COMMIT`, f.id(305), f.id(202), f.id(101), f.id(306), f.id(202), f.id(102), f.id(202)))
	t.Cleanup(func() {
		if _, err := f.admin.Exec(context.Background(), fmt.Sprintf(`SET ROLE kami_migrator; DELETE FROM app.group_trip WHERE group_id='%s'; RESET ROLE`, f.id(202))); err != nil {
			t.Errorf("browser Trip cleanup: %v", err)
		}
	})
	cmd := exec.CommandContext(f.ctx, "node", "../../../../scripts/percentage-real-browser.cjs")
	cmd.Env = append(os.Environ(), "PERCENTAGE_BROWSER_ENDPOINT="+f.endpoint.URL, "PERCENTAGE_BROWSER_TOKEN="+f.token(1), "PERCENTAGE_BROWSER_SUBJECT="+f.id(1), "PERCENTAGE_BROWSER_GROUP="+f.public("Group", 201), "PERCENTAGE_BROWSER_TRIP="+f.public("Group", 202))
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("real API browser pass: %v: %s", err, output)
	}
	t.Log(string(output))
}
