//go:build integration

package expense_test

import (
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
	f := newExpenseFixture(t)
	cmd := exec.CommandContext(f.ctx, "node", "../../../../scripts/percentage-real-browser.cjs")
	cmd.Env = append(os.Environ(), "PERCENTAGE_BROWSER_ENDPOINT="+f.endpoint.URL, "PERCENTAGE_BROWSER_TOKEN="+f.token(1), "PERCENTAGE_BROWSER_SUBJECT="+f.id(1), "PERCENTAGE_BROWSER_GROUP="+f.public("Group", 201))
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("real API browser pass: %v: %s", err, output)
	}
	t.Log(string(output))
}
