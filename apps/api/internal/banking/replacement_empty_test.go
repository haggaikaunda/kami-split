package banking

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestReplacementEmptyPublicationArrays(t *testing.T) {
	oldBinding, newBinding, baseline, current := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	boundary := "2026-09-30"
	now := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
	for _, scenario := range []string{"empty activation", "filter to empty", "empty boundary change", "empty predecessor restore"} {
		t.Run(scenario, func(t *testing.T) {
			snapshot := replacementSnapshot{Bindings: []replacementBinding{{ID: oldBinding, ReportingState: "current", ImportState: "usable", ConnectionState: "active", PermissionState: "granted"}, {ID: newBinding, ReportingState: "staged", ImportState: "usable", ConnectionState: "active", PermissionState: "granted"}}}
			snapshot.Account.ID = uuid.New()
			snapshot.Account.Selected = true
			snapshot.Timezone = &struct {
				Zone string `json:"timezone"`
			}{Zone: "UTC"}
			request := ReplacementRequest{AccountID: snapshot.Account.ID, BindingID: newBinding, Action: "ACTIVATE", TransitionDate: boundary}
			if scenario == "filter to empty" {
				snapshot.Sources = []replacementSource{{ID: uuid.New(), BindingID: oldBinding, Revision: 1, Latest: true, Discrepancy: "none", Currency: "USD", Amount: "100", Date: "2026-10-01", Processing: "posted"}, {ID: uuid.New(), BindingID: newBinding, Revision: 1, Latest: true, Discrepancy: "none", Currency: "USD", Amount: "100", Date: "2026-09-29", Processing: "posted"}}
			}
			if scenario == "empty boundary change" || scenario == "empty predecessor restore" {
				snapshot.Bindings[0].ReportingState = "retired"
				snapshot.Bindings[1].ReportingState = "current"
				snapshot.Plans = []replacementPlan{{ID: baseline, ActiveBindingID: &oldBinding, Intervals: []ReportingInterval{{BindingID: oldBinding}}}, {ID: current, PredecessorID: &baseline, TransitionDate: &boundary, ActiveBindingID: &newBinding, Intervals: []ReportingInterval{{BindingID: oldBinding, ThroughDate: &boundary}, {BindingID: newBinding, AfterDate: &boundary}}}}
				request.BindingID = uuid.Nil
				if scenario == "empty boundary change" {
					request.Action = "CHANGE_BOUNDARY"
					request.TransitionDate = "2026-10-02"
				} else {
					request.Action = "RESTORE_PREDECESSOR"
					request.TransitionDate = ""
				}
			}
			preview, proposal := prepareReplacement(snapshot, request, now)
			if preview.Code != "READY" || preview.Proposed.Count != 0 {
				t.Fatal("legitimate empty reporting plan was rejected", preview.Code, preview.Proposed.Count)
			}
			encoded, err := json.Marshal(proposal)
			if err != nil {
				t.Fatal(err)
			}
			var wire map[string]json.RawMessage
			if err = json.Unmarshal(encoded, &wire); err != nil {
				t.Fatal(err)
			}
			for _, field := range []string{"intervals", "captures"} {
				var values []json.RawMessage
				if len(wire[field]) == 0 || wire[field][0] != '[' || json.Unmarshal(wire[field], &values) != nil {
					t.Fatalf("publication %s is not a JSON array: %s", field, wire[field])
				}
			}
			if string(wire["captures"]) != "[]" {
				t.Fatal("empty publication invented source captures")
			}
		})
	}
}
