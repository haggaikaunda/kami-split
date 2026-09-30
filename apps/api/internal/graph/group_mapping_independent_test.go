package graph

import (
	"context"
	"testing"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph/model"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
)

func TestIndependentGroupReceiptTimestampRoundTripsPublishedScalar(t *testing.T) {
	for _, stamp := range []string{"2026-09-30T12:00:00.000000Z", "2026-09-30T12:00:00.123400Z", "2026-09-30T12:00:00.123456Z"} {
		at, err := time.Parse(time.RFC3339Nano, stamp)
		if err != nil {
			t.Fatal(err)
		}
		mapped := mapGroupCreation(context.Background(), ledger.OperationKey("84000000-0000-4000-8000-000000000001"), database.GroupCreationResult{State: "COMPLETED", CreatedAt: at}).(*model.GroupCreationCompleted)
		var parsed ledger.DateTime
		if err := parsed.UnmarshalGQL(string(mapped.CreatedAt)); err != nil {
			t.Errorf("receipt emitted timestamp outside published scalar contract %q: %v", mapped.CreatedAt, err)
		}
		if string(mapped.CreatedAt) != stamp {
			t.Errorf("timestamp = %q, want %q", mapped.CreatedAt, stamp)
		}
	}
}
