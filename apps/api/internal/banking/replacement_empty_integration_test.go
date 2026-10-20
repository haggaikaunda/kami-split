//go:build integration

package banking

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/jackc/pgx/v5"
)

func TestReplacementEmptyPublicationRetriesFormerScalarFailure(t *testing.T) {
	f := newReplacementFixture(t)
	binding := f.stage()
	f.usable(binding)
	preview := f.preview(binding, "2026-09-30", "ACTIVATE")
	command := ReplacementConfirmation{AttemptID: uuid.New(), Request: preview.Request, Expected: preview.Revisions}
	actor := f.actor(f.owner)
	before := replacementCounts(t, f)
	// Reproduce the former nil-slice payload inside the real durable engine. The
	// canonical command stays unchanged, so the corrected service must recover the
	// same pending attempt rather than requiring a replacement operation identity.
	failed := f.service.run(actor, command.AttemptID, "replacement_publish", command, func(tx pgx.Tx, _ auth.Actor) (Result, error) {
		snapshot, err := readReplacement(actor, tx, f.account)
		if err != nil {
			return Result{}, err
		}
		_, proposal := prepareReplacement(snapshot, command.Request, time.Now())
		proposal.Captures = nil
		expected, _ := json.Marshal(command.Expected)
		encoded, _ := json.Marshal(proposal)
		var id *uuid.UUID
		err = tx.QueryRow(actor, `SELECT app.banking_replacement_publish($1,$2,$3)`, f.account, expected, encoded).Scan(&id)
		return Result{}, err
	})
	requireCode(t, failed, "UNAVAILABLE")
	if replacementCounts(t, f) != before {
		t.Fatal("scalar failure left partial publication state")
	}
	requireCode(t, f.service.OperationStatus(actor, command.AttemptID), "PENDING")
	fresh := f.preview(binding, "2026-09-30", "ACTIVATE")
	if fresh.Revisions != preview.Revisions || fresh.ReportingRevision != preview.ReportingRevision {
		t.Fatal("failed publication changed preview guards")
	}
	restarted, err := New(f.db, f.service.protector)
	if err != nil {
		t.Fatal(err)
	}
	result := restarted.ConfirmReplacement(actor, command)
	requireCode(t, result, "READY")
	if result.ID == uuid.Nil {
		t.Fatal("empty publication omitted plan identity")
	}
	if restarted.ConfirmReplacement(actor, command) != result || restarted.OperationStatus(actor, command.AttemptID) != result {
		t.Fatal("same-attempt retry/status lost original empty plan")
	}
	if counts := replacementCounts(t, f); counts != [4]int{2, 1, 0, 1} {
		t.Fatal("retry duplicated or omitted empty plan/manifest", counts)
	}
	// Empty recovery also publishes and recovers a new immutable plan, without
	// pretending that the restored retired stream regained collection authority.
	restore := f.preview(uuid.Nil, "", "RESTORE_PREDECESSOR")
	restored := f.confirm(restore)
	if restored.ID == result.ID {
		t.Fatal("empty recovery reused prior plan identity")
	}
	var state string
	if err = f.admin.QueryRow(context.Background(), `SELECT reporting_state FROM app.banking_bindings WHERE id=$1`, f.oldBinding).Scan(&state); err != nil || state != "retired" {
		t.Fatal("empty recovery restored collection", err)
	}
}
