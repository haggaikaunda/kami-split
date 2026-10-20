//go:build integration

package banking

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

func TestIndependentReplacementLateAccountRevocationPreservesCurrentBinding(t *testing.T) {
	for _, mode := range []string{"retired", "cancelled"} {
		t.Run(mode, func(t *testing.T) {
			f := newReplacementFixture(t)
			f.row(f.oldBinding, "2026-09-20", "100", "posted", false)
			staged := f.stage()
			f.usable(staged)
			f.row(staged, "2026-10-02", "200", "posted", false)
			p := f.preview(staged, "2026-09-30", "ACTIVATE")
			current, targetConnection := staged, f.oldConnection
			if mode == "retired" {
				f.confirm(p)
			} else {
				requireCode(t, f.service.CancelReplacement(f.actor(f.owner), ReplacementConfirmation{AttemptID: uuid.New(), Request: p.Request, Expected: p.Revisions}), "READY")
				current = f.oldBinding
				targetConnection = replacementConnection(t, f, staged)
			}
			var correlation uuid.UUID
			var item string
			if err := f.admin.QueryRow(context.Background(), `SELECT e.id,c.provider_item_id FROM app.banking_enrollments e JOIN app.banking_connections c ON c.id=e.connection_id WHERE c.id=$1`, targetConnection).Scan(&correlation, &item); err != nil {
				t.Fatal(err)
			}
			before := replacementCounts(t, f)
			var factsBefore string
			factsDigest := func() string {
				t.Helper()
				var digest string
				if err := f.admin.QueryRow(context.Background(), `SELECT md5(jsonb_build_array(
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM app.banking_sources s JOIN app.banking_bindings b ON b.id=s.binding_id WHERE b.account_id=$1),
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.source_id,r.revision) FROM app.banking_source_revisions r JOIN app.banking_sources s ON s.id=r.source_id JOIN app.banking_bindings b ON b.id=s.binding_id WHERE b.account_id=$1),
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.source_id,a.revision) FROM app.banking_annotations a JOIN app.banking_sources s ON s.id=a.source_id JOIN app.banking_bindings b ON b.id=s.binding_id WHERE b.account_id=$1)
    )::text)`, f.account).Scan(&digest); err != nil {
					t.Fatal(err)
				}
				return digest
			}
			factsBefore = factsDigest()
			body, _ := json.Marshal(map[string]string{"environment": "sandbox", "item_id": item, "webhook_type": "ITEM", "webhook_code": "USER_ACCOUNT_REVOKED", "account_id": "checking"})
			signed := newWebhookFixture(t)
			event, err := signed.verifier.Verify(context.Background(), signed.sign(t, body, signed.now, nil), body)
			if err != nil {
				t.Fatal(err)
			}
			ctx := context.Background()
			if err = f.service.AcceptWebhook(ctx, correlation, event); err != nil {
				t.Fatal(err)
			}
			first, status := f.service.ReadLifecycle(f.actor(f.owner), targetConnection)
			requireCode(t, status, "READY")
			if err = f.service.AcceptWebhook(ctx, correlation, event); err != nil {
				t.Fatal(err)
			}
			second, status := f.service.ReadLifecycle(f.actor(f.owner), targetConnection)
			requireCode(t, status, "READY")
			if second.Generation != first.Generation {
				t.Fatal("duplicate late callback repeated authority reduction")
			}
			if replacementCounts(t, f) != before || factsDigest() != factsBefore {
				t.Fatal("late callback changed plan/archive/facts/annotations")
			}
			var selected, stopped bool
			var reporting, connectionState, permission string
			if err = f.admin.QueryRow(ctx, `SELECT a.selected,b.collection_stopped,b.reporting_state,c.state,c.permission_state FROM app.banking_bindings b JOIN app.banking_accounts a ON a.id=b.account_id JOIN app.banking_connections c ON c.id=b.connection_id WHERE b.id=$1`, current).Scan(&selected, &stopped, &reporting, &connectionState, &permission); err != nil {
				t.Fatal(err)
			}
			if !selected || stopped || reporting != "current" || connectionState != "active" || permission != "granted" {
				t.Fatal("late callback revoked or restarted the wrong current authority")
			}
			var siblings int
			if err = f.admin.QueryRow(ctx, `SELECT count(*) FROM app.banking_bindings b JOIN app.banking_accounts a ON a.id=b.account_id WHERE b.connection_id=$1 AND b.provider_account_id='savings' AND a.selected AND NOT b.collection_stopped`, f.oldConnection).Scan(&siblings); err != nil || siblings != 1 {
				t.Fatal("late callback changed selected sibling", err)
			}
			if mode == "cancelled" && second.State != "stopped" {
				t.Fatal("late callback reactivated cancelled candidate")
			}
		})
	}
}
