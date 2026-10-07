//go:build integration

package expense_test

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"testing"
	"time"
)

// TestEditRealBrowserJourney supplements database CI with the production web
// shell and authenticated real API. It requires an explicitly supplied preview.
func TestEditRealBrowserJourney(t *testing.T) {
	if os.Getenv("EDIT_BROWSER_ORIGIN") == "" {
		t.Skip("optional browser evidence requires a production web preview")
	}
	f := newGroupTransportFixture(t)
	f.exec(fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator;
 INSERT INTO app.memberships(id,group_id,user_id) VALUES('%s','%s','%s'),('%s','%s','%s');
 INSERT INTO app.group_trip(group_id,destination,start_date,end_date) VALUES('%s','Kyoto','2026-10-01','2026-10-08');
 INSERT INTO app.groups(id,name,owner_membership_id) VALUES('%s','Friends','%s');
 INSERT INTO app.memberships(id,group_id,user_id) VALUES('%s','%s','%s'),('%s','%s','%s');
 COMMIT`, f.id(305), f.id(202), f.id(101), f.id(306), f.id(202), f.id(102), f.id(202), f.id(203), f.id(307), f.id(307), f.id(203), f.id(101), f.id(308), f.id(203), f.id(102)))
	// Every active Household member must share each aggregate source. Keep the
	// production authorization rule intact rather than mocking source discovery.
	f.exec(fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator;
 INSERT INTO app.memberships(id,group_id,user_id) VALUES('%s','%s','%s'),('%s','%s','%s'); COMMIT`, f.id(309), f.id(202), f.id(103), f.id(310), f.id(203), f.id(103)))
	t.Cleanup(func() {
		if _, err := f.admin.Exec(context.Background(), fmt.Sprintf(`SET ROLE kami_migrator; DELETE FROM app.group_trip WHERE group_id='%s'; RESET ROLE`, f.id(202))); err != nil {
			t.Errorf("browser Trip cleanup: %v", err)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", "../../../../scripts/edit-real-browser.cjs")
	cmd.Env = append(os.Environ(), "EDIT_BROWSER_ENDPOINT="+f.endpoint.URL, "EDIT_BROWSER_TOKEN="+f.token(1), "EDIT_BROWSER_SUBJECT="+f.id(1), "EDIT_BROWSER_GROUP="+f.public("Group", 203), "EDIT_BROWSER_TRIP="+f.public("Group", 202), "EDIT_BROWSER_HOUSEHOLD="+f.public("Group", 201), "EDIT_BROWSER_EXPENSE="+f.original.Record.ExpenseID)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("real edit browser journey: %v: %s", err, output)
	}
	t.Log(string(output))
}
