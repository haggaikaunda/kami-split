package expense

import (
	"context"
	"encoding/json"
	"math/big"

	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/jackc/pgx/v5"
)

// PageRequest restricts one forward-only connection and its immutable anchor.
type PageRequest struct {
	First                             int
	From, To, Category, ParticipantID string
	Anchor                            *int64
	LastDate, LastCreated, LastID     string
}

// Snapshot is a complete group projection from one freshly authorized SQL statement.
type Snapshot struct {
	ID, Name, Currency, ViewerMembershipID string
	Trip                                   *database.GroupTripInput
	IsHousehold                            bool
	Members                                []Member
	Records                                []Record
	Revision, Total                        int64
	Positions                              []ledger.Position
	HasPrevious, HasNext                   bool
	Balance                                ledger.Balance
	BalanceError                           string
}

// Viewer is the caller's self-only identity and currently visible groups.
type Viewer struct {
	ID, DisplayName, State string
	CanCreateGroups        bool
	Groups                 []Summary
}

// Summary contains no financial values and no unrelated identity details.
type Summary struct {
	ID, Name, Currency string
	Trip               *database.GroupTripInput
	IsHousehold        bool
}

// ReadViewer exposes disabled/unprovisioned states without granting group access.
func (s *Service) ReadViewer(ctx context.Context) (Viewer, error) {
	var result Viewer
	err := auth.WithActor(ctx, s.db, func(tx pgx.Tx, _ auth.Actor) error {
		var raw string
		if e := tx.QueryRow(ctx, `SELECT id::text,display_name,can_create_groups FROM app.viewer_identity()`).Scan(&raw, &result.DisplayName, &result.CanCreateGroups); e != nil {
			return e
		}
		result.ID = ledger.PublicID("Viewer", raw)
		result.Groups = []Summary{}
		rows, e := tx.Query(ctx, `SELECT g.id::text,g.name,g.currency,
 (SELECT jsonb_build_object('destination',t.destination,'startDate',to_char(t.start_date,'YYYY-MM-DD'),'endDate',to_char(t.end_date,'YYYY-MM-DD')) FROM app.group_trip t WHERE t.group_id=g.id),
 app.is_household_group(g.id) FROM app.groups g ORDER BY g.id`)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var g Summary
			var trip []byte
			if e = rows.Scan(&g.ID, &g.Name, &g.Currency, &trip, &g.IsHousehold); e != nil {
				return e
			}
			if trip != nil {
				if e = json.Unmarshal(trip, &g.Trip); e != nil {
					return e
				}
			}
			g.ID = ledger.PublicID("Group", g.ID)
			result.Groups = append(result.Groups, g)
		}
		return rows.Err()
	})
	if err == auth.Disabled || err == auth.Unprovisioned {
		return Viewer{State: string(err.(auth.Outcome))}, nil
	}
	return result, safeError(err)
}

// Read returns complete balances and a bounded page from the same statement.
func (s *Service) Read(ctx context.Context, groupID string, page PageRequest) (Snapshot, error) {
	group, err := rawID(groupID, "Group")
	if err != nil {
		return Snapshot{}, err
	}
	var result Snapshot
	err = s.transaction(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		if _, e := tx.Exec(ctx, `SELECT app.lock_group_read($1)`, group); e != nil {
			return e
		}
		var e error
		result, e = readSnapshot(ctx, tx, group, page, nil)
		return e
	})
	return result, err
}

// Locate finds only an authorized group for a membership or expense node.
func (s *Service) Locate(ctx context.Context, id, kind string) (string, error) {
	raw, err := rawID(id, kind)
	if err != nil {
		return "", err
	}
	var group string
	err = s.transaction(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		query := `SELECT group_id::text FROM app.memberships WHERE id=$1`
		if kind == "Repayment" {
			query = `SELECT group_id::text FROM app.repayments WHERE id=$1`
		} else if kind == "Expense" {
			query = `SELECT group_id::text FROM app.expenses WHERE id=$1`
		}
		return tx.QueryRow(ctx, query, raw).Scan(&group)
	})
	if err != nil {
		return "", err
	}
	return ledger.PublicID("Group", group), nil
}

// ReadExpense resolves one record and its current group profiles atomically.
func (s *Service) ReadExpense(ctx context.Context, groupID, expenseID string) (Snapshot, error) {
	group, err := rawID(groupID, "Group")
	if err != nil {
		return Snapshot{}, err
	}
	id, err := rawID(expenseID, "Expense")
	if err != nil {
		return Snapshot{}, err
	}
	var result Snapshot
	err = s.transaction(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		if _, e := tx.Exec(ctx, `SELECT app.lock_group_read($1)`, group); e != nil {
			return e
		}
		var e error
		result, e = readSnapshot(ctx, tx, group, PageRequest{First: 1}, &id)
		return e
	})
	return result, err
}
func readSnapshot(ctx context.Context, tx pgx.Tx, group string, page PageRequest, expenseID *string) (Snapshot, error) {
	var result Snapshot
	if page.First < 1 || page.First > 100 {
		return result, Failure("INVALID_INPUT")
	}
	if page.From != "" && page.To != "" && page.From > page.To {
		return result, Failure("INVALID_INPUT")
	}
	var participant any
	if page.ParticipantID != "" {
		raw, e := rawID(page.ParticipantID, "Membership")
		if e != nil {
			return result, e
		}
		participant = raw
	}
	var payload []byte
	err := tx.QueryRow(ctx, projectionSQL, group, page.First+1, nullable(page.From), nullable(page.To), nullable(page.Category), participant, page.Anchor, nullable(page.LastDate), nullable(page.LastCreated), nullable(page.LastID), expenseID).Scan(&payload)
	if err != nil {
		return result, err
	}
	return decodeSnapshot(payload, page)
}

func decodeSnapshot(payload []byte, page PageRequest) (Snapshot, error) {
	var result Snapshot
	var err error
	var data struct {
		ID, Name, Currency, ViewerMembershipID, Total string
		Trip                                          *database.GroupTripInput
		IsHousehold                                   bool
		Revision                                      int64
		Members                                       []Member
		Records                                       []Record
		Positions                                     []struct{ MemberID, Paid, Owed, Sent, Received string }
		HasPrevious, ValidParticipant                 bool
	}
	if err = json.Unmarshal(payload, &data); err != nil {
		return result, err
	}
	if !data.ValidParticipant {
		return result, Failure("NOT_FOUND")
	}
	if page.Anchor != nil && (*page.Anchor < 0 || *page.Anchor > data.Revision) {
		return result, Failure("INVALID_CURSOR")
	}
	result = Snapshot{ID: ledger.PublicID("Group", data.ID), Name: data.Name, Currency: data.Currency, Trip: data.Trip, IsHousehold: data.IsHousehold, ViewerMembershipID: ledger.PublicID("Membership", data.ViewerMembershipID), Members: data.Members, Records: data.Records, Revision: data.Revision, HasPrevious: data.HasPrevious, Positions: []ledger.Position{}}
	total, ok := new(big.Int).SetString(data.Total, 10)
	if !ok || !total.IsInt64() || total.Sign() < 0 {
		result.BalanceError = "AMOUNT_OVERFLOW"
	} else {
		result.Total = total.Int64()
	}
	for i := range result.Members {
		result.Members[i].ID = ledger.PublicID("Membership", result.Members[i].ID)
	}
	for _, p := range data.Positions {
		paid, ok1 := new(big.Int).SetString(p.Paid, 10)
		owed, ok2 := new(big.Int).SetString(p.Owed, 10)
		sent, ok3 := new(big.Int).SetString(p.Sent, 10)
		received, ok4 := new(big.Int).SetString(p.Received, 10)
		if !ok1 || !ok2 || !ok3 || !ok4 || !paid.IsInt64() || !owed.IsInt64() || !sent.IsInt64() || !received.IsInt64() || paid.Sign() < 0 || owed.Sign() < 0 || sent.Sign() < 0 || received.Sign() < 0 {
			result.BalanceError = "AMOUNT_OVERFLOW"
			continue
		}
		result.Positions = append(result.Positions, ledger.Position{MemberID: ledger.PublicID("Membership", p.MemberID), Paid: paid.Int64(), Owed: owed.Int64(), Sent: sent.Int64(), Received: received.Int64()})
	}
	if result.BalanceError == "" {
		result.Balance, err = ledger.Balances(result.Total, result.Positions)
		if err != nil {
			result.BalanceError = "AMOUNT_OVERFLOW"
		}
	}
	result.HasNext = len(result.Records) > page.First
	if result.HasNext {
		result.Records = result.Records[:page.First]
	}
	for i := range result.Records {
		r := &result.Records[i]
		r.ExpenseID = ledger.PublicID("Expense", r.ExpenseID)
		r.GroupID = result.ID
		r.CreatorMembershipID = ledger.PublicID("Membership", r.CreatorMembershipID)
		r.PayerMembershipID = ledger.PublicID("Membership", r.PayerMembershipID)
		for j := range r.Percentages {
			r.Percentages[j].ParticipantID = ledger.PublicID("Membership", r.Percentages[j].ParticipantID)
		}
		for j := range r.Allocations {
			r.Allocations[j].ParticipantID = ledger.PublicID("Membership", r.Allocations[j].ParticipantID)
		}
		setEditEligibility(r, result.Members)
	}
	return result, nil
}
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// All complete aggregates and page records share a READ COMMITTED statement
// snapshot after group/actor locks. Filters affect only the expense connection.
const projectionSQL = `WITH visible AS (
 SELECT g.id,g.name,g.currency,app.viewer_membership(g.id) AS viewer
 FROM app.groups g WHERE g.id=$1 AND app.can_read_group(g.id)
), members AS (SELECT * FROM app.group_members($1)),
revision AS (SELECT coalesce(max(revision),0) AS n FROM app.financial_records WHERE group_id=$1),
filtered AS (
 SELECT e.* FROM app.expenses_at_revision($1,coalesce($7::bigint,(SELECT n FROM revision))) e WHERE e.group_id=$1
 AND ($3::date IS NULL OR e.effective_date>=$3) AND ($4::date IS NULL OR e.effective_date<=$4)
 AND ($5::text IS NULL OR e.category=$5)
 AND ($6::uuid IS NULL OR EXISTS(SELECT FROM app.allocations_at_revision(e.id,e.version) a WHERE a.expense_id=e.id AND a.participant_id=$6))
 AND ($11::uuid IS NULL OR e.id=$11)
), page AS (
 SELECT * FROM filtered e WHERE $8::date IS NULL OR (e.effective_date,e.created_at,e.id)<($8::date,$9::timestamptz,$10::uuid)
 ORDER BY effective_date DESC,created_at DESC,id DESC LIMIT $2
), positions AS (
 SELECT m.id,coalesce((SELECT sum(e.total_minor) FROM app.expenses e WHERE e.group_id=$1 AND e.payer_id=m.id),0)::text AS paid,
 coalesce((SELECT sum(a.amount_minor) FROM app.allocations a WHERE a.group_id=$1 AND a.participant_id=m.id),0)::text AS owed,
 coalesce((SELECT sum(r.amount_minor) FROM app.repayments r WHERE r.group_id=$1 AND r.sender_id=m.id),0)::text AS sent,
 coalesce((SELECT sum(r.amount_minor) FROM app.repayments r WHERE r.group_id=$1 AND r.recipient_id=m.id),0)::text AS received
 FROM members m
)
SELECT jsonb_build_object('ID',v.id,'Name',v.name,'Currency',v.currency,'ViewerMembershipID',v.viewer,
 'IsHousehold',app.is_household_group(v.id),
 'Trip',(SELECT jsonb_build_object('destination',t.destination,'startDate',to_char(t.start_date,'YYYY-MM-DD'),'endDate',to_char(t.end_date,'YYYY-MM-DD')) FROM app.group_trip t WHERE t.group_id=v.id),
 'Revision',(SELECT n FROM revision),'Total',(SELECT coalesce(sum(total_minor),0)::text FROM app.expenses WHERE group_id=$1),
 'ValidParticipant',($6::uuid IS NULL OR EXISTS(SELECT FROM members WHERE id=$6)),
 'HasPrevious',($8::date IS NOT NULL AND EXISTS(SELECT FROM filtered e WHERE (e.effective_date,e.created_at,e.id)>=($8::date,$9::timestamptz,$10::uuid))),
 'Members',coalesce((SELECT jsonb_agg(jsonb_build_object('ID',id,'DisplayName',display_name,'Status',status,'Role',role,'CanParticipate',can_participate) ORDER BY id) FROM members),'[]'::jsonb),
 'Positions',coalesce((SELECT jsonb_agg(jsonb_build_object('MemberID',id,'Paid',paid,'Owed',owed,'Sent',sent,'Received',received) ORDER BY id) FROM positions),'[]'::jsonb),
 'Records',coalesce((SELECT jsonb_agg(jsonb_build_object('ExpenseID',e.id,'CreatorMembershipID',e.creator_id,'PayerMembershipID',e.payer_id,'TotalMinor',e.total_minor,'Currency',e.currency,'Description',e.description,'EffectiveDate',to_char(e.effective_date,'YYYY-MM-DD'),'Category',e.category,'Note',e.note,'Split',e.split,'CommittedAt',to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'Revision',e.revision,'Version',e.version,
 'Percentages',(SELECT coalesce(jsonb_agg(jsonb_build_object('ParticipantID',a.participant_id,'Hundredths',a.percentage_hundredths) ORDER BY a.participant_id),'[]'::jsonb) FROM app.allocations_at_revision(e.id,e.version) a WHERE a.expense_id=e.id AND a.percentage_hundredths IS NOT NULL),
 'Allocations',(SELECT jsonb_agg(jsonb_build_object('ParticipantID',a.participant_id,'Amount',a.amount_minor) ORDER BY a.participant_id) FROM app.allocations_at_revision(e.id,e.version) a WHERE a.expense_id=e.id)) ORDER BY e.effective_date DESC,e.created_at DESC,e.id DESC) FROM page e),'[]'::jsonb)) FROM visible v`
