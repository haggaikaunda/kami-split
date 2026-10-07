package expense

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"sort"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ExpenseViewRequest selects a structured-filtered spending traversal. Scope is
// HOUSEHOLD or an explicit public Group ID. HasAfter distinguishes an explicitly
// empty (invalid) cursor from omission. Filter presence distinguishes omitted
// identifiers from supplied empty IDs. Cursor validation never grants access.
type ExpenseViewRequest struct {
	Scope               string
	First               int
	After               string
	HasAfter            bool
	GroupFilterPresent  bool
	MemberFilterPresent bool
	Filter              ledger.StructuredFilter
}

// SpendingMonth is a complete filtered calendar-month aggregate at the same
// immutable traversal anchor as the total and ledger, independent of page size.
type SpendingMonth struct {
	Month        string
	Total, Count int64
}

// ExpenseViewEdge preserves original expense and current authorized source metadata.
type ExpenseViewEdge struct {
	Record  Record
	Source  Summary
	Members []Member
	Cursor  string
}

// ExpenseView owns newly allocated complete filtered totals/months and one bounded
// global forward page. It exposes no balances or cross-group financial obligation.
type ExpenseView struct {
	// ContextVersion binds current authorized source/member metadata, not financial anchors.
	ContextVersion       string
	Total, Count         int64
	Months               []SpendingMonth
	Edges                []ExpenseViewEdge
	HasNext, HasPrevious bool
}

type viewScope struct {
	State  string
	Groups []string
}
type viewWire struct {
	State, Eligibility, ContextVersion, Total, Count string
	Groups                                           []string
	ValidGroup, ValidMember                          bool
	Revisions                                        []struct {
		GroupID  string
		Revision int64
	}
	Months  []struct{ Month, Total, Count string }
	Sources []struct {
		Summary
		Members []Member
	}
	Records []Record
}

// ReadExpenseView returns one coherent authorized view with complete anchored
// spending/month aggregates. Household uses the exact dashboard lock/discovery
// protocol; group reads use existing actor→group locks. Three fresh attempts within
// five seconds bound discovery changes. Failure returns no partial rows or totals.
func (s *Service) ReadExpenseView(ctx context.Context, in ExpenseViewRequest, codec *ledger.CursorCodec) (ExpenseView, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	group := ""
	if in.Scope != "HOUSEHOLD" {
		var err error
		group, err = rawID(in.Scope, "Group")
		if err != nil {
			return ExpenseView{}, err
		}
	}
	for attempt := 0; attempt < 3; attempt++ {
		var result ExpenseView
		err := s.transaction(ctx, func(tx pgx.Tx, _ auth.Actor) error {
			var held viewScope
			if group == "" {
				var raw []byte
				if err := tx.QueryRow(ctx, `SELECT app.household_dashboard_lock()`).Scan(&raw); err != nil {
					return err
				}
				if err := json.Unmarshal(raw, &held); err != nil {
					return err
				}
				if held.State == "NOT_FOUND" {
					return Failure("NOT_FOUND")
				}
				if held.State != "COMPLETE" {
					return Failure("UNAVAILABLE")
				}
			} else {
				if _, err := tx.Exec(ctx, `SELECT app.lock_group_read($1)`, group); err != nil {
					return err
				}
				held = viewScope{State: "COMPLETE", Groups: []string{group}}
			}
			// Authorize before reporting malformed filter or cursor state. The query
			// also authorizes each referenced group/member in the final statement snapshot.
			if in.First < 1 || in.First > 100 || ledger.ValidateStructuredFilter(in.Filter) != nil ||
				(in.GroupFilterPresent && in.Filter.GroupID == "") || (in.MemberFilterPresent && in.Filter.MemberID == "") {
				return Failure("INVALID_INPUT")
			}
			if codec == nil {
				return Failure("UNAVAILABLE")
			}
			var cursor *ledger.ExpenseViewCursor
			if in.HasAfter || in.After != "" {
				decoded, err := codec.DecodeExpenseView(in.After, in.Scope, in.Filter)
				if err != nil {
					// Safe identifier existence is checked by an unanchored authorized read
					// before serializing cursor failure.
					wire, e := readViewWire(ctx, tx, group, in, nil)
					if e != nil {
						return e
					}
					if e = authorizeViewWire(wire, held); e != nil {
						return e
					}
					return Failure("INVALID_CURSOR")
				}
				cursor = &decoded
			}
			wire, err := readViewWire(ctx, tx, group, in, cursor)
			if err != nil {
				return err
			}
			if err = authorizeViewWire(wire, held); err != nil {
				return err
			}
			anchors := make([]ledger.SpaceRevision, 0, len(wire.Revisions))
			for _, revision := range wire.Revisions {
				anchors = append(anchors, ledger.SpaceRevision{GroupID: ledger.PublicID("Group", revision.GroupID), Revision: revision.Revision})
			}
			sort.Slice(anchors, func(i, j int) bool { return anchors[i].GroupID < anchors[j].GroupID })
			if cursor != nil {
				if cursor.Eligibility != wire.Eligibility || len(cursor.Anchors) != len(anchors) {
					return Failure("INVALID_CURSOR")
				}
				for i, a := range cursor.Anchors {
					if a.GroupID != anchors[i].GroupID || a.Revision > anchors[i].Revision {
						return Failure("INVALID_CURSOR")
					}
				}
				anchors = cursor.Anchors
			}
			result, err = decodeView(wire, in, cursor, anchors, codec)
			return err
		})
		if err == nil {
			return result, nil
		}
		var driver *pgconn.PgError
		if errors.Is(err, errDashboardRestart) || (errors.As(err, &driver) && driver.Code == "40001") {
			continue
		}
		return ExpenseView{}, safeError(err)
	}
	return ExpenseView{}, Failure("UNAVAILABLE")
}

func readViewWire(ctx context.Context, tx pgx.Tx, group string, in ExpenseViewRequest, cursor *ledger.ExpenseViewCursor) (viewWire, error) {
	var selected, member any
	if in.Filter.GroupID != "" {
		raw, _ := ledger.ParseID(in.Filter.GroupID, "Group")
		selected = raw
	}
	if in.Filter.MemberID != "" {
		raw, _ := ledger.ParseID(in.Filter.MemberID, "Membership")
		member = raw
	}
	var anchorJSON any
	var date, created, boundaryGroup, boundaryExpense any
	if cursor != nil {
		anchors := make([]map[string]any, 0, len(cursor.Anchors))
		for _, a := range cursor.Anchors {
			raw, _ := ledger.ParseID(a.GroupID, "Group")
			anchors = append(anchors, map[string]any{"group_id": raw, "revision": a.Revision})
		}
		encoded, err := json.Marshal(anchors)
		if err != nil {
			return viewWire{}, err
		}
		anchorJSON = encoded
		date = cursor.EffectiveDate
		created = cursor.CreatedAt
		boundaryGroup, _ = ledger.ParseID(cursor.GroupID, "Group")
		boundaryExpense, _ = ledger.ParseID(cursor.ExpenseID, "Expense")
	}
	args := []any{selected, member, nullable(in.Filter.From), nullable(in.Filter.To), nullable(in.Filter.Category), anchorJSON, date, created, boundaryGroup, boundaryExpense, in.First + 1}
	if group != "" {
		args = append(args, group)
	}
	var raw []byte
	if err := tx.QueryRow(ctx, viewProjectionSQL(group != ""), args...).Scan(&raw); err != nil {
		return viewWire{}, err
	}
	var result viewWire
	if err := json.Unmarshal(raw, &result); err != nil {
		return viewWire{}, err
	}
	return result, nil
}

func authorizeViewWire(wire viewWire, held viewScope) error {
	if wire.State == "NOT_FOUND" {
		return Failure("NOT_FOUND")
	}
	if wire.State != "COMPLETE" {
		return Failure("UNAVAILABLE")
	}
	for _, id := range wire.Groups {
		found := false
		for _, locked := range held.Groups {
			if id == locked {
				found = true
				break
			}
		}
		if !found {
			return errDashboardRestart
		}
	}
	if !wire.ValidGroup || !wire.ValidMember {
		return Failure("NOT_FOUND")
	}
	return nil
}

func checkedSpending(s string) (int64, error) {
	n, ok := new(big.Int).SetString(s, 10)
	if !ok || !n.IsInt64() || n.Sign() < 0 {
		return 0, Failure("AMOUNT_OVERFLOW")
	}
	return n.Int64(), nil
}

func decodeView(wire viewWire, in ExpenseViewRequest, cursor *ledger.ExpenseViewCursor, anchors []ledger.SpaceRevision, codec *ledger.CursorCodec) (ExpenseView, error) {
	result := ExpenseView{ContextVersion: wire.ContextVersion, Months: []SpendingMonth{}, Edges: []ExpenseViewEdge{}, HasPrevious: cursor != nil}
	var err error
	result.Total, err = checkedSpending(wire.Total)
	if err != nil {
		return ExpenseView{}, err
	}
	result.Count, err = checkedSpending(wire.Count)
	if err != nil {
		return ExpenseView{}, err
	}
	for _, m := range wire.Months {
		total, err := checkedSpending(m.Total)
		if err != nil {
			return ExpenseView{}, err
		}
		count, err := checkedSpending(m.Count)
		if err != nil {
			return ExpenseView{}, err
		}
		result.Months = append(result.Months, SpendingMonth{Month: m.Month, Total: total, Count: count})
	}
	sources := make(map[string]struct {
		Summary
		Members []Member
	}, len(wire.Sources))
	for _, source := range wire.Sources {
		raw := source.ID
		source.ID = ledger.PublicID("Group", source.ID)
		for i := range source.Members {
			source.Members[i].ID = ledger.PublicID("Membership", source.Members[i].ID)
		}
		sources[raw] = source
	}
	result.HasNext = len(wire.Records) > in.First
	if result.HasNext {
		wire.Records = wire.Records[:in.First]
	}
	for _, r := range wire.Records {
		source, ok := sources[r.GroupID]
		if !ok {
			return ExpenseView{}, Failure("UNAVAILABLE")
		}
		r.GroupID = source.ID
		r.ExpenseID = ledger.PublicID("Expense", r.ExpenseID)
		r.CreatorMembershipID = ledger.PublicID("Membership", r.CreatorMembershipID)
		r.PayerMembershipID = ledger.PublicID("Membership", r.PayerMembershipID)
		for i := range r.Percentages {
			r.Percentages[i].ParticipantID = ledger.PublicID("Membership", r.Percentages[i].ParticipantID)
		}
		for i := range r.Allocations {
			r.Allocations[i].ParticipantID = ledger.PublicID("Membership", r.Allocations[i].ParticipantID)
		}
		token, err := codec.EncodeExpenseView(ledger.ExpenseViewCursor{Scope: in.Scope, Filter: in.Filter, Eligibility: wire.Eligibility, Anchors: anchors, EffectiveDate: r.EffectiveDate, CreatedAt: r.CommittedAt, GroupID: r.GroupID, ExpenseID: r.ExpenseID})
		if err != nil {
			return ExpenseView{}, Failure("UNAVAILABLE")
		}
		result.Edges = append(result.Edges, ExpenseViewEdge{Record: r, Source: source.Summary, Members: source.Members, Cursor: token})
	}
	return result, nil
}
