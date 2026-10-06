//go:build integration

package expense_test

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"testing"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/invitation"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
)

// Use the checked-in Relay wire operation, including compiler-added interface
// selections and fragments, rather than a handwritten approximation of the UI.
func relayWorkspaceWire(t *testing.T) string {
	t.Helper()
	source, err := os.ReadFile("../../../web/src/lib/relay/__generated__/journeyWorkspaceQuery.graphql.ts")
	if err != nil {
		t.Fatal(err)
	}
	match := regexp.MustCompile(`"text":\s*("(?:[^"\\]|\\.)*")`).FindSubmatch(source)
	if len(match) != 2 {
		t.Fatal("compiled workspace artifact has no wire operation")
	}
	var query string
	if err = json.Unmarshal(match[1], &query); err != nil {
		t.Fatal(err)
	}
	return query
}
func workspaceWireVariables(f *expenseFixture, tab string) map[string]any {
	return map[string]any{"id": f.public("Group", 201), "overview": tab == "overview", "balances": tab == "balances", "summary": tab == "overview" || tab == "balances" || tab == "expenses", "ledger": tab == "expenses", "activity": tab == "activity", "filter": nil}
}
func workspaceWireResponse(t *testing.T, f *expenseFixture, actor int, query string, variables map[string]any) map[string]map[string]any {
	t.Helper()
	status, body, err := groupHTTP(f, actor, query, variables)
	var result struct {
		Data   map[string]map[string]any
		Errors []struct {
			Message string
			Path    []any
		}
	}
	if err != nil || status != 200 || json.Unmarshal(body, &result) != nil {
		t.Fatalf("workspace transport failed: status=%d err=%v", status, err)
	}
	if len(result.Errors) != 0 {
		t.Fatalf("compiled workspace GraphQL errors: %+v", result.Errors)
	}
	return result.Data
}

func workspaceWireTabs(t *testing.T, f *expenseFixture, actor int, membership string) {
	t.Helper()
	query := relayWorkspaceWire(t)
	for _, tab := range []string{"overview", "expenses", "balances", "activity", "members"} {
		t.Run(fmt.Sprintf("actor%d/%s", actor, tab), func(t *testing.T) {
			data := workspaceWireResponse(t, f, actor, query, workspaceWireVariables(f, tab))
			viewer, group := data["viewer"], data["group"]
			if viewer["__typename"] != "Viewer" || group["__typename"] != "Group" {
				t.Fatalf("workspace branches: viewer=%v group=%v code=%v", viewer["__typename"], group["__typename"], group["code"])
			}
			if viewer["today"] == nil || group["id"] != f.public("Group", 201) || group["isHousehold"] != true {
				t.Fatal("compiled operation lost viewer date or original Household identity")
			}
			member, ok := group["viewerMembership"].(map[string]any)
			if !ok || member["id"] != membership {
				t.Fatal("compiled operation lost current member identity")
			}
			if tab == "overview" {
				page, ok := group["expenses"].(map[string]any)
				if !ok || len(page["edges"].([]any)) != 1 {
					t.Fatal("compiled overview lost the actual expense page")
				}
				edge := page["edges"].([]any)[0].(map[string]any)
				if edge["cursor"] == nil || edge["node"].(map[string]any)["payer"] == nil {
					t.Fatal("compiled overview lost cursor or payer projection")
				}
			}
			if tab == "overview" || tab == "expenses" || tab == "balances" {
				balance, ok := group["balances"].(map[string]any)
				if !ok || balance["__typename"] != "GroupBalances" {
					t.Fatal("compiled destination failed complete balance projection")
				}
			}
			if tab == "expenses" && data["groupExpenses"]["__typename"] != "ExpenseView" {
				t.Fatal("compiled destination failed structured expense read")
			}
			if tab == "activity" {
				activity := data["groupActivity"]
				if activity["__typename"] != "ActivityConnection" {
					t.Fatal("compiled destination failed activity read")
				}
				for _, edge := range activity["edges"].([]any) {
					event := edge.(map[string]any)["node"].(map[string]any)
					if event["groupKind"] != "ORDINARY" || event["isHousehold"] != true {
						t.Fatal("Household event lost authorized source kind or designation")
					}
				}
			}
		})
	}
}

func TestWorkspaceRelayWireCurrentMembershipAndDenial(t *testing.T) {
	f := newGroupTransportFixture(t)
	query := relayWorkspaceWire(t)
	for _, actor := range []int{1, 2} {
		workspaceWireTabs(t, f, actor, f.public("Membership", 300+actor))
	}
	status, body, err := groupHTTP(f, 4, query, workspaceWireVariables(f, "overview"))
	var denied struct {
		Data   map[string]map[string]any
		Errors []any
	}
	if err != nil || status != 200 || json.Unmarshal(body, &denied) != nil || len(denied.Errors) != 0 {
		t.Fatalf("denied compiled request failed transport: status=%d err=%v", status, err)
	}
	if denied.Data["group"]["__typename"] != "Problem" || denied.Data["group"]["code"] != "NOT_FOUND" {
		t.Fatal("compiled operation granted an unrelated account original Household access")
	}
}

func TestWorkspaceRelayWireAfterTargetedInvitationAcceptance(t *testing.T) {
	f := independentDashboardFixture(t)
	independentDashboardExec(t, f, fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; DELETE FROM app.memberships WHERE id='%s'; COMMIT`, f.id(302)))
	t.Cleanup(func() {
		independentDashboardExec(t, f, fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; DELETE FROM app.invitation_delivery WHERE action_id IN (SELECT id FROM app.invitation_actions WHERE group_id='%s'); DELETE FROM app.invitation_actions WHERE group_id='%s'; DELETE FROM app.invitations WHERE group_id='%s'; COMMIT`, f.id(201), f.id(201), f.id(201)))
	})
	protector, err := invitation.NewProtector("workspace-wire-test", map[string][]byte{"workspace-wire-test": make([]byte, 32)})
	if err != nil {
		t.Fatal(err)
	}
	email := f.id(2) + "@example.invalid"
	provider := membershipEmailProvider{emails: map[string]string{f.id(1): f.id(1) + "@example.invalid", f.id(2): email}}
	service, err := invitation.New(f.db, protector, provider)
	if err != nil {
		t.Fatal(err)
	}
	created, err := service.Create(membershipAuthenticatedContext(t, f, 1), uuid.MustParse(f.id(201)), email, uuid.New())
	if err != nil || created.Outcome != "SAVED" {
		t.Fatalf("invitation creation outcome=%s error=%v", created.Outcome, err)
	}
	independentDashboardExec(t, f, "SET ROLE kami_migrator")
	var cipher []byte
	var key string
	err = f.admin.QueryRow(f.ctx, `SELECT token_cipher,token_key FROM app.invitations WHERE id=$1`, created.InvitationID).Scan(&cipher, &key)
	independentDashboardExec(t, f, "RESET ROLE")
	if err != nil {
		t.Fatal(err)
	}
	token, err := protector.Decrypt(cipher, key, "TARGETED:"+created.InvitationID.String())
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := service.Accept(membershipAuthenticatedContext(t, f, 2), string(token), uuid.New())
	if err != nil || accepted.Outcome != "ADMITTED" || !accepted.HasAccess {
		t.Fatalf("invitation acceptance outcome=%s error=%v", accepted.Outcome, err)
	}
	input := f.input
	input.Key = uuid.NewString()
	input.PayerID = ledger.PublicID("Membership", accepted.MembershipID.String())
	input.ParticipantIDs = []string{f.public("Membership", 301)}
	if out := f.create(2, input); out.Kind != "COMMITTED" {
		t.Fatalf("post-admission expense outcome=%s", out.Kind)
	}
	workspaceWireTabs(t, f, 1, f.public("Membership", 301))
	workspaceWireTabs(t, f, 2, ledger.PublicID("Membership", accepted.MembershipID.String()))
}

func TestWorkspaceRelayWireTripOwnerMemberAndOriginalFinancialRecords(t *testing.T) {
	f := newGroupTransportFixture(t)
	query := relayWorkspaceWire(t)
	tripID := f.public("Group", 202)
	// Original Trip identity is independent of the Household; its existing owner
	// and a second authenticated member share only this group's records.
	f.exec(fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; INSERT INTO app.group_trip(group_id,destination,start_date,end_date) VALUES('%s','Kyoto','2026-09-01','2026-09-03'); INSERT INTO app.memberships(id,group_id,user_id) VALUES('%s','%s','%s'); COMMIT`, f.id(202), f.id(305), f.id(202), f.id(102)))
	t.Cleanup(func() {
		f.exec(fmt.Sprintf(`SET ROLE kami_migrator; DELETE FROM app.group_trip WHERE group_id='%s'; RESET ROLE`, f.id(202)))
	})
	input := f.input
	input.GroupID = tripID
	input.Key = uuid.NewString()
	input.PayerID = f.public("Membership", 304)
	input.ParticipantIDs = []string{f.public("Membership", 305)}
	saved := f.create(4, input)
	if saved.Kind != "COMMITTED" {
		t.Fatalf("Trip expense creation outcome=%s", saved.Kind)
	}
	repayment := map[string]any{"groupId": tripID, "key": uuid.NewString(), "senderId": f.public("Membership", 305), "recipientId": f.public("Membership", 304), "amountMinor": "400", "currency": "USD", "effectiveDate": "2026-09-04", "note": "Recorded after the trip"}
	status, body, err := groupHTTP(f, 2, repaymentMutation, map[string]any{"input": repayment})
	var receipt struct {
		Data map[string]struct {
			Typename string `json:"__typename"`
			Record   struct {
				RepaymentID string `json:"repaymentId"`
				GroupID     string `json:"groupId"`
			}
		}
		Errors []any
	}
	if err != nil || status != 200 || json.Unmarshal(body, &receipt) != nil || len(receipt.Errors) != 0 || receipt.Data["recordRepayment"].Typename != "RepaymentCommitted" {
		t.Fatalf("Trip repayment transport/creation failed: status=%d err=%v", status, err)
	}
	transfer := receipt.Data["recordRepayment"].Record
	if transfer.GroupID != tripID || transfer.RepaymentID == "" {
		t.Fatal("Trip repayment lost original group identity")
	}
	for _, actor := range []int{4, 2} {
		membership, role := f.public("Membership", 304), "OWNER"
		if actor == 2 {
			membership, role = f.public("Membership", 305), "MEMBER"
		}
		for _, tab := range []string{"overview", "expenses", "balances", "activity", "members"} {
			t.Run(fmt.Sprintf("actor%d/%s", actor, tab), func(t *testing.T) {
				variables := workspaceWireVariables(f, tab)
				variables["id"] = tripID
				data := workspaceWireResponse(t, f, actor, query, variables)
				group := data["group"]
				if data["viewer"]["__typename"] != "Viewer" || group["__typename"] != "Group" || group["id"] != tripID || group["kind"] != "TRIP" || group["isHousehold"] != false {
					t.Fatal("compiled Trip destination lost authorized original identity")
				}
				metadata, ok := group["trip"].(map[string]any)
				if !ok || metadata["destination"] != "Kyoto" || metadata["startDate"] != "2026-09-01" || metadata["endDate"] != "2026-09-03" {
					t.Fatal("compiled Trip destination lost original travel metadata")
				}
				member, ok := group["viewerMembership"].(map[string]any)
				if !ok || member["id"] != membership || member["role"] != role {
					t.Fatal("compiled Trip destination lost actor membership or role")
				}
				if tab == "overview" {
					edges := group["expenses"].(map[string]any)["edges"].([]any)
					if len(edges) != 1 || edges[0].(map[string]any)["node"].(map[string]any)["id"] != saved.Record.ExpenseID {
						t.Fatal("Trip overview replaced or mixed original expense records")
					}
				}
				if tab == "overview" || tab == "expenses" || tab == "balances" {
					balance, ok := group["balances"].(map[string]any)
					if !ok || balance["__typename"] != "GroupBalances" || balance["groupId"] != tripID || balance["totalExpenseMinor"] != fmt.Sprint(input.Total) {
						t.Fatal("Trip summary replaced original group ledger")
					}
				}
				if tab == "expenses" {
					view := data["groupExpenses"]
					if view["__typename"] != "ExpenseView" {
						t.Fatal("compiled Trip structured ledger unavailable")
					}
					edges := view["edges"].([]any)
					if len(edges) != 1 {
						t.Fatal("Trip ledger mixed another space's expenses")
					}
					record := edges[0].(map[string]any)["node"].(map[string]any)
					if record["id"] != saved.Record.ExpenseID || record["groupId"] != tripID {
						t.Fatal("Trip structured ledger lost original expense/group identity")
					}
				}
				if tab == "balances" {
					edges := group["repayments"].(map[string]any)["edges"].([]any)
					if len(edges) != 1 {
						t.Fatal("Trip repayment history missing or mixed")
					}
					record := edges[0].(map[string]any)["node"].(map[string]any)
					if record["id"] != transfer.RepaymentID || record["groupId"] != tripID || record["amountMinor"] != "400" || record["sender"].(map[string]any)["id"] != f.public("Membership", 305) || record["recipient"].(map[string]any)["id"] != f.public("Membership", 304) {
						t.Fatal("Trip repayment lost original transfer identity or participants")
					}
				}
				if tab == "activity" {
					activity := data["groupActivity"]
					if activity["__typename"] != "ActivityConnection" {
						t.Fatal("compiled Trip activity unavailable")
					}
					edges := activity["edges"].([]any)
					if len(edges) != 2 {
						t.Fatal("Trip activity lost financial events or mixed other spaces")
					}
					seen := map[string]bool{}
					for _, edge := range edges {
						event := edge.(map[string]any)["node"].(map[string]any)
						if event["groupId"] != tripID || event["groupKind"] != "TRIP" || event["isHousehold"] != false {
							t.Fatal("Trip activity leaked an unrelated group's event")
						}
						seen[event["recordId"].(string)] = true
					}
					if !seen[saved.Record.ExpenseID] || !seen[transfer.RepaymentID] {
						t.Fatal("Trip activity lost original expense or repayment identity")
					}
				}
			})
		}
	}
	variables := workspaceWireVariables(f, "overview")
	variables["id"] = tripID
	denied := workspaceWireResponse(t, f, 1, query, variables)
	if denied["group"]["__typename"] != "Problem" || denied["group"]["code"] != "NOT_FOUND" {
		t.Fatal("Household owner gained unrelated Trip access")
	}
}

func TestWorkspaceRelayWireOrdinaryActivitySourceKindAndDenial(t *testing.T) {
	f := newGroupTransportFixture(t)
	input := f.input
	input.GroupID = f.public("Group", 202)
	input.Key = uuid.NewString()
	input.PayerID = f.public("Membership", 304)
	input.ParticipantIDs = []string{f.public("Membership", 304)}
	saved := f.create(4, input)
	if saved.Kind != "COMMITTED" {
		t.Fatalf("ordinary expense creation outcome=%s", saved.Kind)
	}
	query := relayWorkspaceWire(t)
	variables := workspaceWireVariables(f, "activity")
	variables["id"] = input.GroupID
	data := workspaceWireResponse(t, f, 4, query, variables)
	activity := data["groupActivity"]
	if activity["__typename"] != "ActivityConnection" {
		t.Fatal("ordinary activity unavailable")
	}
	edges := activity["edges"].([]any)
	if len(edges) != 1 {
		t.Fatal("ordinary activity lost original event")
	}
	event := edges[0].(map[string]any)["node"].(map[string]any)
	if event["recordId"] != saved.Record.ExpenseID || event["groupId"] != input.GroupID || event["groupKind"] != "ORDINARY" || event["isHousehold"] != false {
		t.Fatal("ordinary activity lost original financial identity or authorized source metadata")
	}
	denied := workspaceWireResponse(t, f, 1, query, variables)
	if denied["groupActivity"]["__typename"] != "Problem" || denied["groupActivity"]["code"] != "NOT_FOUND" {
		t.Fatal("unrelated Household owner received ordinary source activity")
	}
}
