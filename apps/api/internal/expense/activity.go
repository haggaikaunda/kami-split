package expense

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"strings"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ActivityRequest selects a server-authorized group or the membership-authorized Household
// dashboard. Empty GroupID means Household; SourceID is never a discovery input.
type ActivityRequest struct {
	GroupID, SourceID, Kind, After string
	First                          int
	eventID                        string
}

// ActivityEvent is immutable financial provenance with fresh authorized labels.
// RecordID refers to the existing expense or repayment; event and effective times
// have separate meanings. No unsupported mutation is inferred from current state.
// GroupKind is current authorized source metadata, not an immutable event kind.
type ActivityEvent struct {
	ID, RecordID, Kind, GroupID, GroupName, GroupKind, Currency, EffectiveDate, Timestamp string
	IsHousehold                                                                           bool
	AmountMinor                                                                           int64
	Creator, Payer, Sender, Recipient                                                     *ActivityIdentity
	Actor                                                                                 *ActivityIdentity
	Description, Note                                                                     string
	Before, After                                                                         *Record
	SnapshotMembers                                                                       []Member
	EventID                                                                               string
}

// ActivityIdentity is a historical membership's current minimal authorized label.
type ActivityIdentity struct{ ID, DisplayName string }

// ActivityPage is a bounded complete event page and signed continuation tokens.
type ActivityPage struct {
	Events  []ActivityEvent
	Cursors []string
	HasNext bool
}

// ReadActivity rechecks access before interpreting cursors, locks the authorized
// sources, anchors each financial revision and reads events independently of
// expense/repayment pagination. Membership/account generations invalidate
// continuations. Three fresh attempts within five seconds bound discovery races.
func (s *Service) ReadActivity(ctx context.Context, in ActivityRequest, codec *ledger.CursorCodec) (ActivityPage, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	for attempt := 0; attempt < 3; attempt++ {
		result, err := s.readActivity(ctx, in, codec)
		if err == nil {
			return result, nil
		}
		var driver *pgconn.PgError
		if errors.Is(err, errDashboardRestart) || (errors.As(err, &driver) && driver.Code == "40001") {
			continue
		}
		return ActivityPage{}, err
	}
	return ActivityPage{}, Failure("UNAVAILABLE")
}

func (s *Service) readActivity(ctx context.Context, in ActivityRequest, codec *ledger.CursorCodec) (ActivityPage, error) {
	var group, source string
	var err error
	if in.GroupID != "" {
		group, err = rawID(in.GroupID, "Group")
		if err != nil {
			return ActivityPage{}, err
		}
	}
	if in.SourceID != "" {
		source, err = rawID(in.SourceID, "Group")
		if err != nil {
			return ActivityPage{}, err
		}
	}
	result := ActivityPage{Events: []ActivityEvent{}, Cursors: []string{}}
	err = s.transaction(ctx, func(tx pgx.Tx, actor auth.Actor) error {
		scope := "household"
		ids := []string{}
		if group != "" {
			scope = group
			if _, e := tx.Exec(ctx, `SELECT app.lock_group_read($1)`, group); e != nil {
				return e
			}
			ids = append(ids, group)
		} else {
			var raw []byte
			if e := tx.QueryRow(ctx, `SELECT app.household_dashboard_lock()`).Scan(&raw); e != nil {
				return e
			}
			var projection struct {
				State  string   `json:"state"`
				Groups []string `json:"groups"`
			}
			if e := json.Unmarshal(raw, &projection); e != nil {
				return e
			}
			if projection.State != "COMPLETE" {
				if projection.State == "NOT_FOUND" {
					return Failure("NOT_FOUND")
				}
				return Failure("UNAVAILABLE")
			}
			ids = projection.Groups
			// Pair versions have no authority. Bind Household continuations to the
			// same membership/account generation as Expenses and recheck the
			// scope sampled with the events before returning any private rows.
			var eligibility struct {
				State, Anchor string
				Groups        []string
			}
			if e := tx.QueryRow(ctx, `SELECT app.household_expense_scope()`).Scan(&raw); e != nil {
				return e
			}
			if e := json.Unmarshal(raw, &eligibility); e != nil {
				return e
			}
			if eligibility.State != "COMPLETE" || eligibility.Anchor == "" {
				return Failure("UNAVAILABLE")
			}
			held := make(map[string]bool, len(ids))
			for _, id := range ids {
				held[id] = true
			}
			for _, id := range eligibility.Groups {
				if !held[id] {
					return errDashboardRestart
				}
			}
			ids = eligibility.Groups
			scope += ":" + eligibility.Anchor
		}
		if in.First < 1 || in.First > 100 || codec == nil {
			return Failure("INVALID_INPUT")
		}
		if in.Kind != "" && in.Kind != "EXPENSE_CREATED" && in.Kind != "EXPENSE_UPDATED" && in.Kind != "REPAYMENT_RECORDED" {
			return Failure("INVALID_INPUT")
		}
		if source != "" {
			found := false
			for _, id := range ids {
				if source == id {
					found = true
				}
			}
			if !found {
				return Failure("NOT_FOUND")
			}
		}
		var raw []byte
		if e := tx.QueryRow(ctx, activityAnchorsSQL, ids).Scan(&raw); e != nil {
			return e
		}
		var anchors []ledger.ActivityAnchor
		if e := json.Unmarshal(raw, &anchors); e != nil {
			return e
		}
		if len(anchors) != len(ids) {
			return Failure("UNAVAILABLE")
		}
		cursor := ledger.ActivityCursor{Version: 1, Actor: uuid.UUID(actor.ID.Bytes).String(), Scope: scope, Source: source, EventKind: in.Kind, Anchors: anchors}
		if in.After != "" {
			cursor, err = codec.DecodeActivity(in.After, cursor.Actor, scope, in.Kind, source, anchors)
			if err != nil {
				return Failure("INVALID_CURSOR")
			}
		}
		anchorJSON, e := json.Marshal(cursor.Anchors)
		if e != nil {
			return e
		}
		query := activityReadSQL(group == "")
		if e = tx.QueryRow(ctx, query, anchorJSON, in.Kind, nullable(source), nullable(cursor.Timestamp), nullable(cursor.RecordKind), nullable(cursor.RecordID), in.First+1, nullable(in.eventID)).Scan(&raw); e != nil {
			return e
		}
		if group == "" {
			var sampled struct {
				Scope  struct{ State, Anchor string }
				Events json.RawMessage
			}
			if e = json.Unmarshal(raw, &sampled); e != nil {
				return e
			}
			if sampled.Scope.State != "COMPLETE" || "household:"+sampled.Scope.Anchor != scope {
				return errDashboardRestart
			}
			raw = sampled.Events
		}
		if e = json.Unmarshal(raw, &result.Events); e != nil {
			return e
		}
		result.HasNext = len(result.Events) > in.First
		if result.HasNext {
			result.Events = result.Events[:in.First]
		}
		for i := range result.Events {
			event := &result.Events[i]
			cursor.Timestamp = event.Timestamp
			cursor.RecordKind = event.Kind
			cursor.RecordID = event.EventID
			token, e := codec.EncodeActivity(cursor)
			if e != nil {
				return e
			}
			result.Cursors = append(result.Cursors, token)
			kind := "Expense"
			if event.Kind == "REPAYMENT_RECORDED" {
				kind = "Repayment"
			}
			event.ID = "activity:" + event.Kind + ":" + event.EventID
			event.RecordID = ledger.PublicID(kind, event.RecordID)
			event.GroupID = ledger.PublicID("Group", event.GroupID)
			for _, identity := range []*ActivityIdentity{event.Creator, event.Payer, event.Sender, event.Recipient, event.Actor} {
				if identity != nil {
					identity.ID = ledger.PublicID("Membership", identity.ID)
				}
			}
			for j := range event.SnapshotMembers {
				event.SnapshotMembers[j].ID = ledger.PublicID("Membership", event.SnapshotMembers[j].ID)
			}
			for _, record := range []*Record{event.Before, event.After} {
				if record == nil {
					continue
				}
				record.ExpenseID = ledger.PublicID("Expense", record.ExpenseID)
				record.GroupID = event.GroupID
				record.CreatorMembershipID = ledger.PublicID("Membership", record.CreatorMembershipID)
				record.PayerMembershipID = ledger.PublicID("Membership", record.PayerMembershipID)
				for j := range record.Allocations {
					record.Allocations[j].ParticipantID = ledger.PublicID("Membership", record.Allocations[j].ParticipantID)
				}
				for j := range record.Percentages {
					record.Percentages[j].ParticipantID = ledger.PublicID("Membership", record.Percentages[j].ParticipantID)
				}
			}
		}
		return nil
	})
	if err != nil {
		return ActivityPage{}, err
	}
	return result, nil
}

// ReadActivityDetail resolves immutable event facts under the same current
// source-scope authorization as the feed, independently of a previously loaded page.
func (s *Service) ReadActivityDetail(ctx context.Context, in ActivityRequest, eventID string, codec *ledger.CursorCodec) (ActivityEvent, error) {
	parts := strings.Split(eventID, ":")
	if len(parts) != 3 || parts[0] != "activity" {
		return ActivityEvent{}, Failure("INVALID_INPUT")
	}
	if _, err := uuid.Parse(parts[2]); err != nil {
		return ActivityEvent{}, Failure("INVALID_INPUT")
	}
	in.Kind = parts[1]
	in.eventID = parts[2]
	in.First = 1
	in.After = ""
	page, err := s.ReadActivity(ctx, in, codec)
	if err != nil {
		return ActivityEvent{}, err
	}
	if len(page.Events) != 1 {
		return ActivityEvent{}, Failure("NOT_FOUND")
	}
	return page.Events[0], nil
}
