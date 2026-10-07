//go:build integration

package expense_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// registerExpenseCleanup owns only the generated fixture IDs. Financial history
// is immutable to application roles; the disposable database administrator uses
// a transaction-local trigger bypass solely to remove test-owned rows. Rollback
// restores that setting even when cleanup fails. No cluster-global role changes
// or shared runtime connections are involved.
func registerExpenseCleanup(t *testing.T, admin *pgx.Conn, id func(int) string, groupNumbers, actorNumbers []int) func() {
	t.Helper()
	retainForBackup := false
	t.Cleanup(func() {
		if retainForBackup {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		tx, err := admin.Begin(ctx)
		if err != nil {
			t.Errorf("begin fixture cleanup: %v", err)
			return
		}
		defer tx.Rollback(ctx)
		if _, err = tx.Exec(ctx, "SET LOCAL session_replication_role = replica; SET LOCAL ROLE kami_migrator"); err != nil {
			t.Errorf("fixture cleanup trigger scope: %v", err)
			return
		}
		groups := make([]string, len(groupNumbers))
		for i, n := range groupNumbers {
			groups[i] = id(n)
		}
		actors := make([]string, len(actorNumbers))
		for i, n := range actorNumbers {
			actors[i] = id(n)
		}
		financialTables := []string{"expense_operations", "repayment_audit", "repayments", "financial_records", "allocations", "expense_audit", "expense_revision_allocations", "expense_revisions", "expenses"}
		for _, table := range financialTables {
			if _, err = tx.Exec(ctx, "ALTER TABLE app."+table+" NO FORCE ROW LEVEL SECURITY"); err != nil {
				t.Errorf("cleanup RLS scope: %v", err)
				return
			}
		}
		for _, table := range []string{"expense_operations", "repayment_audit", "repayments", "financial_records", "allocations", "expense_audit", "expense_revision_allocations", "expense_revisions", "expenses", "memberships"} {
			if _, err = tx.Exec(ctx, "DELETE FROM app."+table+" WHERE group_id = ANY($1::uuid[])", groups); err != nil {
				t.Errorf("cleanup %s: %v", table, err)
				return
			}
		}
		for _, statement := range []string{"DELETE FROM app.groups WHERE id = ANY($1::uuid[])", "DELETE FROM app.users WHERE auth_subject = ANY($1::uuid[])", "DELETE FROM auth.users WHERE id = ANY($1::uuid[])"} {
			ids := actors
			if statement == "DELETE FROM auth.users WHERE id = ANY($1::uuid[])" {
				if _, err = tx.Exec(ctx, "RESET ROLE"); err != nil {
					t.Errorf("cleanup Auth role: %v", err)
					return
				}
			}
			if statement == "DELETE FROM app.groups WHERE id = ANY($1::uuid[])" {
				ids = groups
			}
			if _, err = tx.Exec(ctx, statement, ids); err != nil {
				t.Errorf("cleanup identities: %v", err)
				return
			}
		}
		if _, err = tx.Exec(ctx, "SET LOCAL ROLE kami_migrator"); err != nil {
			t.Errorf("restore cleanup owner: %v", err)
			return
		}
		for _, table := range financialTables {
			if _, err = tx.Exec(ctx, "ALTER TABLE app."+table+" FORCE ROW LEVEL SECURITY"); err != nil {
				t.Errorf("restore cleanup RLS: %v", err)
				return
			}
		}
		if err = tx.Commit(ctx); err != nil {
			t.Errorf("commit fixture cleanup: %v", err)
		}
	})
	return func() { retainForBackup = true }
}
