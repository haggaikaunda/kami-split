package banking

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"time"

	// The minimal production image has no system zoneinfo database.
	_ "time/tzdata"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/jackc/pgx/v5"
)

// ReplacementRequest explicitly selects a logical account, action and posted-date
// boundary. Actions are ACTIVATE, CHANGE_BOUNDARY and RESTORE_PREDECESSOR.
// BindingID is required for ACTIVATE; recovery derives its binding from saved plans.
type ReplacementRequest struct {
	AccountID      uuid.UUID `json:"account_id"`
	BindingID      uuid.UUID `json:"binding_id"`
	Action         string    `json:"action"`
	TransitionDate string    `json:"transition_date"`
}

// ReplacementRevisions bind confirmation to every relevant persisted dimension.
// Values are opaque digests, not ordered counters and grant no provider authority.
type ReplacementRevisions struct {
	Plan       string `json:"plan"`
	Import     string `json:"import"`
	Data       string `json:"data"`
	Annotation string `json:"annotation"`
	Lifecycle  string `json:"lifecycle"`
}

// ReplacementConfirmation uses a client-known durable attempt and the exact
// preview revisions. A conflict requires a fresh preview and explicit confirmation.
type ReplacementConfirmation struct {
	AttemptID uuid.UUID
	Request   ReplacementRequest
	Expected  ReplacementRevisions
}

// ReportingInterval owns posted dates in (AfterDate, ThroughDate]; nil is unbounded.
// BindingID is stable provenance, never a guessed cross-bank transaction identity.
type ReportingInterval struct {
	BindingID   uuid.UUID `json:"binding_id"`
	AfterDate   *string   `json:"after_date"`
	ThroughDate *string   `json:"through_date"`
}

// ReplacementImpact describes a complete row set independently of page size.
// SpendingMinor is exact USD cents for valid classified posted rows only.
type ReplacementImpact struct {
	Count           int     `json:"count"`
	FromDate        *string `json:"from_date"`
	ThroughDate     *string `json:"through_date"`
	SpendingMinor   string  `json:"spending_minor"`
	AnnotationCount int     `json:"annotation_count"`
	PendingCount    int     `json:"pending_count"`
	UnresolvedCount int     `json:"unresolved_count"`
}

// ReplacementPreview is a coherent owner-only impact contract. Coverage is
// separate from usability: unknown coverage may coexist with a usable import.
// Archive references never contribute again, and pending never contributes spend.
type ReplacementPreview struct {
	Code              string               `json:"code"`
	Request           ReplacementRequest   `json:"request"`
	Revisions         ReplacementRevisions `json:"revisions"`
	ReportingRevision int64                `json:"reporting_revision"`
	Intervals         []ReportingInterval  `json:"intervals"`
	Prior             ReplacementImpact    `json:"prior"`
	Proposed          ReplacementImpact    `json:"proposed"`
	Retained          ReplacementImpact    `json:"retained"`
	New               ReplacementImpact    `json:"new"`
	Archived          ReplacementImpact    `json:"archived"`
	Overlap           ReplacementImpact    `json:"overlap"`
	OldAfterBoundary  ReplacementImpact    `json:"old_after_boundary"`
	Coverage          string               `json:"coverage"`
	CoverageAfter     *string              `json:"coverage_after"`
	CoverageThrough   *string              `json:"coverage_through"`
	DiscrepancyCount  int                  `json:"discrepancy_count"`
	CollectionState   string               `json:"collection_state"`
}

type replacementBinding struct {
	ID              uuid.UUID `json:"id"`
	ReportingState  string    `json:"reporting_state"`
	ImportState     string    `json:"import_state"`
	ConnectionState string    `json:"connection_state"`
	PermissionState string    `json:"permission_state"`
	CoverageAfter   *string   `json:"coverage_after"`
	CoverageThrough *string   `json:"coverage_through"`
}
type replacementSource struct {
	ID                 uuid.UUID `json:"id"`
	BindingID          uuid.UUID `json:"binding_id"`
	Revision           int64     `json:"revision"`
	Latest             bool      `json:"is_latest"`
	Discrepancy        string    `json:"discrepancy"`
	Amount             string    `json:"amount_minor"`
	Date               string    `json:"bank_date"`
	Processing         string    `json:"processing_state"`
	AnnotationRevision int64     `json:"annotation_revision"`
	Activity           *string   `json:"activity"`
	Excluded           bool      `json:"excluded"`
}
type replacementCapture struct {
	SourceID uuid.UUID `json:"source_id"`
	Revision int64     `json:"source_revision"`
}
type replacementPlan struct {
	ID              uuid.UUID            `json:"id"`
	PredecessorID   *uuid.UUID           `json:"predecessor_id"`
	TransitionDate  *string              `json:"transition_date"`
	ActiveBindingID *uuid.UUID           `json:"active_binding_id"`
	Intervals       []ReportingInterval  `json:"intervals"`
	Captures        []replacementCapture `json:"captures"`
}
type replacementSnapshot struct {
	Account struct {
		ID                uuid.UUID `json:"id"`
		Selected          bool      `json:"selected"`
		ReportingRevision int64     `json:"reporting_revision"`
	} `json:"account"`
	Bindings []replacementBinding `json:"bindings"`
	Sources  []replacementSource  `json:"sources"`
	Plans    []replacementPlan    `json:"plans"`
	Timezone *struct {
		Zone string `json:"timezone"`
	} `json:"timezone"`
	Revisions ReplacementRevisions `json:"revisions"`
}
type replacementProposal struct {
	ActiveBindingID    uuid.UUID            `json:"active_binding_id"`
	TransitionDate     string               `json:"transition_date"`
	PlanTransitionDate *string              `json:"plan_transition_date"`
	Intervals          []ReportingInterval  `json:"intervals"`
	Captures           []replacementCapture `json:"captures"`
}

func readReplacement(ctx context.Context, tx pgx.Tx, id uuid.UUID) (replacementSnapshot, error) {
	var raw []byte
	err := tx.QueryRow(ctx, `SELECT app.banking_replacement_snapshot($1)`, id).Scan(&raw)
	if err != nil {
		return replacementSnapshot{}, err
	}
	if len(raw) == 0 {
		return replacementSnapshot{}, pgx.ErrNoRows
	}
	var snapshot replacementSnapshot
	err = json.Unmarshal(raw, &snapshot)
	return snapshot, err
}

// PreviewReplacement reauthorizes the enabled owner and computes the complete
// impact from one persisted snapshot, without publishing or changing collection.
func (s *Service) PreviewReplacement(ctx context.Context, request ReplacementRequest) ReplacementPreview {
	var snapshot replacementSnapshot
	err := auth.WithActor(ctx, s.db, func(tx pgx.Tx, _ auth.Actor) error {
		var err error
		snapshot, err = readReplacement(ctx, tx, request.AccountID)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ReplacementPreview{Code: "NOT_FOUND"}
	}
	if err != nil {
		return ReplacementPreview{Code: failure(ctx, err).Code}
	}
	preview, _ := prepareReplacement(snapshot, request, time.Now())
	return preview
}

// ConfirmReplacement atomically publishes a server-derived plan and immutable
// recovery manifest through the existing durable operation engine. Status/retry
// returns the original opaque plan ID after a lost response.
func (s *Service) ConfirmReplacement(ctx context.Context, input ReplacementConfirmation) Result {
	if input.AttemptID == uuid.Nil || input.Request.AccountID == uuid.Nil {
		return Result{Code: "INVALID_INPUT"}
	}
	return s.run(ctx, input.AttemptID, "replacement_publish", input, func(tx pgx.Tx, _ auth.Actor) (Result, error) {
		snapshot, err := readReplacement(ctx, tx, input.Request.AccountID)
		if errors.Is(err, pgx.ErrNoRows) {
			return Result{Code: "NOT_FOUND"}, nil
		}
		if err != nil {
			return Result{}, err
		}
		if snapshot.Revisions != input.Expected {
			return Result{Code: "CONFLICT"}, nil
		}
		preview, proposal := prepareReplacement(snapshot, input.Request, time.Now())
		if preview.Code != "READY" {
			return Result{Code: preview.Code}, nil
		}
		expected, _ := json.Marshal(input.Expected)
		encoded, _ := json.Marshal(proposal)
		var id *uuid.UUID
		err = tx.QueryRow(ctx, `SELECT app.banking_replacement_publish($1,$2,$3)`, input.Request.AccountID, expected, encoded).Scan(&id)
		if err != nil {
			return Result{}, err
		}
		if id == nil {
			return Result{Code: "CONFLICT"}, nil
		}
		return Result{Code: "READY", ID: *id}, nil
	})
}

// CancelReplacement fences only a staged generation. The current plan remains
// intact; cancellation does not attest unchanged OAuth permission or removal.
func (s *Service) CancelReplacement(ctx context.Context, input ReplacementConfirmation) Result {
	if input.AttemptID == uuid.Nil || input.Request.AccountID == uuid.Nil || input.Request.BindingID == uuid.Nil {
		return Result{Code: "INVALID_INPUT"}
	}
	return s.run(ctx, input.AttemptID, "replacement_cancel", input, func(tx pgx.Tx, _ auth.Actor) (Result, error) {
		expected, _ := json.Marshal(input.Expected)
		var ok bool
		err := tx.QueryRow(ctx, `SELECT app.banking_replacement_cancel($1,$2,$3)`, input.Request.AccountID, input.Request.BindingID, expected).Scan(&ok)
		if !ok {
			return Result{Code: "CONFLICT"}, err
		}
		return Result{Code: "READY", ID: input.Request.BindingID}, err
	})
}

func currentReplacementPlan(s replacementSnapshot) (replacementPlan, bool) {
	if len(s.Plans) > 0 {
		return s.Plans[len(s.Plans)-1], true
	}
	var current uuid.UUID
	for _, b := range s.Bindings {
		if b.ReportingState == "current" {
			if current != uuid.Nil {
				return replacementPlan{}, false
			}
			current = b.ID
		}
	}
	if current == uuid.Nil {
		return replacementPlan{}, false
	}
	return replacementPlan{ActiveBindingID: &current, Intervals: []ReportingInterval{{BindingID: current}}}, true
}
func predecessorPlan(s replacementSnapshot, p replacementPlan) (replacementPlan, bool) {
	if p.PredecessorID == nil {
		return replacementPlan{}, false
	}
	for _, candidate := range s.Plans {
		if candidate.ID == *p.PredecessorID {
			return candidate, true
		}
	}
	return replacementPlan{}, false
}
func validTransition(date string, zone string, now time.Time) bool {
	parsed, err := time.Parse("2006-01-02", date)
	location, zoneErr := time.LoadLocation(zone)
	return err == nil && zoneErr == nil && parsed.Year() >= 1 && parsed.Year() <= 9999 && parsed.Format("2006-01-02") == date && date <= now.In(location).Format("2006-01-02")
}
func within(date string, i ReportingInterval) bool {
	return (i.AfterDate == nil || date > *i.AfterDate) && (i.ThroughDate == nil || date <= *i.ThroughDate)
}

func prepareReplacement(s replacementSnapshot, request ReplacementRequest, now time.Time) (ReplacementPreview, replacementProposal) {
	p := ReplacementPreview{Code: "INVALID_INPUT", Request: request, Revisions: s.Revisions, ReportingRevision: s.Account.ReportingRevision, Coverage: "unknown"}
	proposal := replacementProposal{Captures: []replacementCapture{}}
	current, ok := currentReplacementPlan(s)
	if !ok {
		p.Code = "DATA_UNAVAILABLE"
		return p, proposal
	}
	if s.Timezone == nil {
		p.Code = "NOT_INITIALIZED"
		return p, proposal
	}
	intervals := append([]ReportingInterval(nil), current.Intervals...)
	active := uuid.Nil
	if current.ActiveBindingID != nil {
		active = *current.ActiveBindingID
	}
	boundary := request.TransitionDate
	var planBoundary *string
	targetCaptures := current.Captures
	switch request.Action {
	case "ACTIVATE":
		if request.BindingID == uuid.Nil || !s.Account.Selected {
			return p, proposal
		}
		found := false
		for _, b := range s.Bindings {
			if b.ID == request.BindingID && b.ReportingState == "staged" && b.ConnectionState == "active" && b.PermissionState == "granted" {
				found = true
			}
		}
		if !found {
			p.Code = "CONFLICT"
			return p, proposal
		}
		if current.TransitionDate != nil && boundary <= *current.TransitionDate {
			return p, proposal
		}
		if len(intervals) == 0 {
			return p, proposal
		}
		intervals[len(intervals)-1].ThroughDate = &boundary
		intervals = append(intervals, ReportingInterval{BindingID: request.BindingID, AfterDate: &boundary})
		active = request.BindingID
	case "CHANGE_BOUNDARY":
		if current.TransitionDate == nil || len(intervals) < 2 {
			return p, proposal
		}
		previous := intervals[len(intervals)-2].AfterDate
		if previous != nil && boundary <= *previous {
			return p, proposal
		}
		intervals[len(intervals)-2].ThroughDate = &boundary
		intervals[len(intervals)-1].AfterDate = &boundary
	case "RESTORE_PREDECESSOR":
		previous, found := predecessorPlan(s, current)
		if !found {
			p.Code = "DATA_UNAVAILABLE"
			return p, proposal
		}
		intervals = append([]ReportingInterval(nil), previous.Intervals...)
		if previous.ActiveBindingID == nil {
			p.Code = "DATA_UNAVAILABLE"
			return p, proposal
		}
		active = *previous.ActiveBindingID
		// Archives always record the boundary of the change being undone. A restored
		// initial plan has no transition of its own.
		if current.TransitionDate != nil {
			boundary = *current.TransitionDate
		} else if previous.TransitionDate != nil {
			boundary = *previous.TransitionDate
		} else {
			p.Code = "DATA_UNAVAILABLE"
			return p, proposal
		}
		planBoundary = previous.TransitionDate
		targetCaptures = previous.Captures
		for _, capture := range previous.Captures {
			found := false
			for _, source := range s.Sources {
				if source.ID == capture.SourceID && source.Revision == capture.Revision {
					found = true
					break
				}
			}
			if !found {
				p.Code = "DATA_UNAVAILABLE"
				return p, proposal
			}
		}
	default:
		return p, proposal
	}
	if !validTransition(boundary, s.Timezone.Zone, now) {
		return p, proposal
	}
	for _, i := range intervals {
		found := false
		for _, b := range s.Bindings {
			if b.ID == i.BindingID {
				found = true
				if b.ImportState != "usable" {
					p.Code = "IMPORT_UNAVAILABLE"
					return p, proposal
				}
				if b.ID == active {
					p.CoverageAfter = b.CoverageAfter
					p.CoverageThrough = b.CoverageThrough
					p.CollectionState = b.ReportingState + "/" + b.ConnectionState + "/" + b.PermissionState
				}
			}
		}
		if !found {
			p.Code = "DATA_UNAVAILABLE"
			return p, proposal
		}
	}
	if p.CoverageAfter != nil && p.CoverageThrough != nil {
		p.Coverage = "known_partial"
		if *p.CoverageAfter > boundary {
			p.Coverage = "known_gap"
		}
	}
	before := effectiveSources(s, current.Intervals, activeID(current), current.Captures)
	after := effectiveSources(s, intervals, active, targetCaptures)
	oldIDs := map[uuid.UUID]bool{}
	newIDs := map[uuid.UUID]bool{}
	for _, row := range before {
		oldIDs[row.ID] = true
	}
	for _, row := range after {
		newIDs[row.ID] = true
	}
	retained, added, archived, overlap, oldAfter := []replacementSource{}, []replacementSource{}, []replacementSource{}, []replacementSource{}, []replacementSource{}
	for _, row := range before {
		if newIDs[row.ID] {
			retained = append(retained, row)
		} else {
			archived = append(archived, row)
		}
		if row.Processing == "posted" && row.Date > boundary {
			oldAfter = append(oldAfter, row)
		}
	}
	for _, row := range after {
		if !oldIDs[row.ID] {
			added = append(added, row)
		}
		proposal.Captures = append(proposal.Captures, replacementCapture{SourceID: row.ID, Revision: row.Revision})
	}
	for _, row := range s.Sources {
		if row.Latest && row.BindingID == active && row.Processing == "posted" && row.Date <= boundary {
			overlap = append(overlap, row)
		}
		if row.Latest && row.Discrepancy != "none" {
			p.DiscrepancyCount++
		}
	}
	var err error
	impacts := []struct {
		rows   []replacementSource
		target *ReplacementImpact
	}{{before, &p.Prior}, {after, &p.Proposed}, {retained, &p.Retained}, {added, &p.New}, {archived, &p.Archived}, {overlap, &p.Overlap}, {oldAfter, &p.OldAfterBoundary}}
	for _, impact := range impacts {
		*impact.target, err = summarizeReplacement(impact.rows)
		if err != nil {
			p.Code = "DATA_ERROR"
			return p, replacementProposal{}
		}
	}
	p.Code = "READY"
	p.Intervals = intervals
	if request.Action != "RESTORE_PREDECESSOR" {
		planBoundary = &boundary
	}
	proposal.ActiveBindingID = active
	proposal.TransitionDate = boundary
	proposal.PlanTransitionDate = planBoundary
	proposal.Intervals = intervals
	return p, proposal
}
func activeID(p replacementPlan) uuid.UUID {
	if p.ActiveBindingID != nil {
		return *p.ActiveBindingID
	}
	return uuid.Nil
}
func effectiveSources(s replacementSnapshot, intervals []ReportingInterval, active uuid.UUID, captures []replacementCapture) []replacementSource {
	result := []replacementSource{}
	for _, row := range s.Sources {
		use := row.Latest
		// A stored discrepancy cannot silently replace an already captured fact.
		if row.Discrepancy != "none" {
			for _, capture := range captures {
				if capture.SourceID == row.ID {
					use = row.Revision == capture.Revision
					break
				}
			}
		}
		if !use {
			continue
		}
		for _, interval := range intervals {
			if row.BindingID != interval.BindingID {
				continue
			}
			if row.Processing == "pending" {
				collecting := false
				for _, b := range s.Bindings {
					if b.ID == row.BindingID && b.ReportingState != "retired" && b.ReportingState != "cancelled" {
						collecting = true
					}
				}
				if row.BindingID == active && collecting {
					result = append(result, row)
				}
				break
			}
			if row.Processing == "posted" && within(row.Date, interval) {
				result = append(result, row)
			}
			break
		}
	}
	return result
}
func summarizeReplacement(rows []replacementSource) (ReplacementImpact, error) {
	impact := ReplacementImpact{Count: len(rows), SpendingMinor: "0"}
	total := new(big.Int)
	for _, row := range rows {
		if impact.FromDate == nil || row.Date < *impact.FromDate {
			date := row.Date
			impact.FromDate = &date
		}
		if impact.ThroughDate == nil || row.Date > *impact.ThroughDate {
			date := row.Date
			impact.ThroughDate = &date
		}
		if row.AnnotationRevision > 0 {
			impact.AnnotationCount++
		}
		if row.Processing == "pending" {
			impact.PendingCount++
			continue
		}
		if row.Excluded {
			continue
		}
		if row.Activity == nil {
			impact.UnresolvedCount++
			continue
		}
		amount, ok := new(big.Int).SetString(row.Amount, 10)
		if !ok {
			return impact, errors.New("invalid source amount")
		}
		switch *row.Activity {
		case "purchase", "bank_fee", "debit_interest":
			if amount.Sign() <= 0 {
				impact.UnresolvedCount++
				continue
			}
			total.Add(total, amount)
		case "refund":
			if amount.Sign() >= 0 {
				impact.UnresolvedCount++
				continue
			}
			total.Add(total, amount)
		case "income", "transfer", "card_repayment", "cash_withdrawal":
		default:
			impact.UnresolvedCount++
		}
	}
	limit := big.NewInt(9007199254740991)
	if new(big.Int).Abs(new(big.Int).Set(total)).Cmp(limit) > 0 {
		return impact, errors.New("spending overflow")
	}
	impact.SpendingMinor = total.String()
	return impact, nil
}
