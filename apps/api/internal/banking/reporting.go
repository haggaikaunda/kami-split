package banking

import (
	"context"
	"crypto/hmac"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/jackc/pgx/v5"
)

// ReportFilter is shared by the complete aggregate and paged rows. Dates are
// inclusive bank calendar dates; presets resolve once using the saved timezone.
type ReportFilter struct {
	Discrepancies                            bool
	ArchiveID                                string
	Period                                   string
	Start, End                               string
	Accounts, Categories, Activities, States []string
	Excluded, Reviewed                       *bool
}

// ReportRequest bounds page size without imposing a history-retention cutoff.
type ReportRequest struct {
	Filter ReportFilter
	First  int
	After  string
}

// AnnotationSnapshot is immutable original capture provenance, never an edit owner.
type AnnotationSnapshot struct {
	Revision         string  `json:"revision"`
	MaterialRevision string  `json:"material_revision"`
	Category         *string `json:"category"`
	Activity         *string `json:"activity"`
	Note             *string `json:"note"`
	Excluded         bool    `json:"excluded"`
	Reviewed         bool    `json:"reviewed"`
}

// ArchiveReference identifies immutable provenance; edits target the sole source owner.
type ArchiveReference struct {
	Annotation         *AnnotationSnapshot `json:"annotation"`
	ArchiveID          string              `json:"archive_id"`
	SourceRevision     string              `json:"source_revision"`
	AnnotationRevision *string             `json:"annotation_revision"`
}

// Transaction separates immutable bank facts, retained override intent and the
// effective classification. Current=false records never contribute to reports.
type Transaction struct {
	LatestSourceRevision    string             `json:"latest_source_revision"`
	CurrentID               *string            `json:"current_id"`
	ID                      string             `json:"id"`
	AccountID               string             `json:"account_id"`
	BindingID               string             `json:"binding_id"`
	SourceRevision          string             `json:"source_revision"`
	MaterialRevision        string             `json:"material_revision"`
	AmountMinor             string             `json:"amount_minor"`
	Currency                string             `json:"currency"`
	BankDate                string             `json:"bank_date"`
	AuthorizationDate       *string            `json:"authorization_date"`
	ProcessingState         string             `json:"processing_state"`
	ProviderPrimaryCategory *string            `json:"provider_primary_category"`
	ProviderCategory        *string            `json:"provider_category"`
	ProviderConfidence      *string            `json:"provider_confidence"`
	ProviderCode            *string            `json:"provider_code"`
	MappingVersion          string             `json:"mapping_version"`
	Name                    *string            `json:"name"`
	MerchantName            *string            `json:"merchant_name"`
	Discrepancy             string             `json:"discrepancy"`
	AnnotationRevision      string             `json:"annotation_revision"`
	CategoryOverride        *string            `json:"category"`
	ActivityOverride        *string            `json:"activity"`
	Note                    *string            `json:"note"`
	Excluded                bool               `json:"excluded"`
	Reviewed                bool               `json:"reviewed"`
	MaterialConflict        bool               `json:"material_conflict"`
	Current                 bool               `json:"current"`
	Archives                []ArchiveReference `json:"archives"`
	Category, Activity      string
	Eligible                bool
}

// ReportInterval exposes coverage and collection separately for each date owner.
type ReportInterval struct {
	BindingID           string  `json:"binding_id"`
	AfterDate           *string `json:"after_date"`
	ThroughDate         *string `json:"through_date"`
	ImportState         string  `json:"import_state"`
	CoverageAfter       *string `json:"coverage_after"`
	CoverageThrough     *string `json:"coverage_through"`
	HistoryAvailability string  `json:"history_availability"`
	LastLocalCommit     *string `json:"last_local_commit"`
	ProviderSuccessAt   *string `json:"provider_success_at"`
	HistoricalUpdateAt  *string `json:"historical_update_at"`
	CollectionState     string  `json:"collection_state"`
	CollectionStopped   bool    `json:"collection_stopped"`
	DiscrepancyCount    int     `json:"discrepancy_count"`
	Coverage            string
}

// ReportArchive exposes a noncontributing recovery manifest.
type ReportArchive struct {
	ID           string `json:"id"`
	PlanID       string `json:"plan_id"`
	BoundaryDate string `json:"boundary_date"`
	Count        int    `json:"count"`
}

// ReportAccount is the authorized inventory and latest recovery-plan read model.
// PredecessorID permits recovery discovery, never restores collection authority.
type ReportAccount struct {
	ID                   string           `json:"id"`
	Selected             bool             `json:"selected"`
	Kind                 string           `json:"kind"`
	ReportingRevision    string           `json:"reporting_revision"`
	PlanID               *string          `json:"plan_id"`
	PredecessorID        *string          `json:"predecessor_id"`
	TransitionDate       *string          `json:"transition_date"`
	Intervals            []ReportInterval `json:"intervals"`
	Coverage             string
	RequestedHistoryDays int
	Archives             []ReportArchive `json:"archives"`
}

// ReportCounts explains all matching activity even when no spending headline applies.
type ReportCounts struct {
	Count, PostedCount, PendingCount, RemovedCount, ExcludedCount, UnresolvedCount, ReviewedCount, ZeroCount int
	ClassificationComplete                                                                                   bool
}

// ReportSummary covers all filtered rows using exact USD arithmetic; nil is unavailable.
type ReportSummary struct {
	Count, PostedCount, PendingCount, RemovedCount, ExcludedCount, UnresolvedCount, ReviewedCount, ZeroCount int
	PurchaseMinor, RefundMinor, NetMinor                                                                     string
	ClassificationComplete                                                                                   bool
	Activities                                                                                               []ReportActivity
	Categories                                                                                               []ReportActivity
}

// ReportActivity groups complete counts and eligible net amounts by stable key.
type ReportActivity struct {
	Key      string
	Count    int
	NetMinor string
}

// Report returns one coherent snapshot or an explicit restart/error code.
type Report struct {
	Counts                                   *ReportCounts
	ActivityChoices, CategoryChoices         []string
	SpendingContext                          string
	TotalCount                               int
	Code                                     string
	FieldErrors                              []string
	Start, End, AsOfDate, Timezone, Revision string
	Accounts                                 []ReportAccount
	Rows                                     []Transaction
	Summary                                  *ReportSummary
	EndCursor                                *string
	HasNextPage                              bool
}
type reportSnapshot struct {
	SampledAt time.Time `json:"sampled_at"`
	Timezone  *struct {
		Timezone string `json:"timezone"`
		Version  int64  `json:"version"`
	} `json:"timezone"`
	Accounts []ReportAccount `json:"accounts"`
	Rows     []Transaction   `json:"rows"`
	Revision string          `json:"revision"`
}

func readReportSnapshot(ctx context.Context, tx pgx.Tx, scope map[string]any) (reportSnapshot, error) {
	if _, err := tx.Exec(ctx, `SELECT app.lock_banking_owner()`); err != nil {
		return reportSnapshot{}, err
	}
	var raw []byte
	encoded, err := json.Marshal(scope)
	if err != nil {
		return reportSnapshot{}, err
	}
	if err := tx.QueryRow(ctx, `SELECT app.banking_reporting_snapshot($1::jsonb)`, encoded).Scan(&raw); err != nil {
		return reportSnapshot{}, err
	}
	var snapshot reportSnapshot
	err = json.Unmarshal(raw, &snapshot)
	return snapshot, err
}

// ReadReport rechecks the enabled owner on every page. A changed source, edit,
// lifecycle, plan, preference or preset day requires a complete pagination restart.
func (s *Service) ReadReport(ctx context.Context, request ReportRequest) Report {
	out := Report{ActivityChoices: append([]string(nil), reportActivities...), CategoryChoices: append([]string(nil), reportCategories...), Code: "INVALID_INPUT", FieldErrors: []string{}, Accounts: []ReportAccount{}, Rows: []Transaction{}}
	if request.First == 0 {
		request.First = 50
	}
	if request.First < 1 || request.First > 100 || len(request.After) > 8192 {
		out.FieldErrors = []string{"pagination"}
		return out
	}
	filter := request.Filter
	normalizeReportFilter(&filter)
	if fields := validateReportFilter(filter); len(fields) > 0 {
		out.FieldErrors = fields
		return out
	}
	if !contains([]string{"THIS_MONTH", "LAST_MONTH", "LAST_60_DAYS", "LAST_90_DAYS", "YEAR_TO_DATE", "CUSTOM"}, filter.Period) {
		out.FieldErrors = []string{"period"}
		return out
	}
	if filter.Period == "CUSTOM" && (!validBankDate(filter.Start) || !validBankDate(filter.End) || filter.Start > filter.End) {
		out.FieldErrors = []string{"start", "end"}
		return out
	}
	var snapshot reportSnapshot
	var actorID string
	err := auth.WithActor(ctx, s.db, func(tx pgx.Tx, actor auth.Actor) error {
		actorID = safeID(actor.ID).String()
		var err error
		snapshot, err = readReportSnapshot(ctx, tx, map[string]any{"accounts": filter.Accounts, "period": filter.Period, "start": filter.Start, "end": filter.End, "archive_id": filter.ArchiveID, "discrepancies": filter.Discrepancies})
		return err
	})
	if err != nil {
		out.Code = failure(ctx, err).Code
		return out
	}
	if snapshot.Timezone == nil {
		out.Code = "NOT_INITIALIZED"
		return out
	}
	if len(snapshot.Rows) > 100000 {
		out.Code = "QUERY_LIMIT"
		return out
	}
	out.Start, out.End, out.AsOfDate, out.FieldErrors = reportBounds(filter, snapshot.Timezone.Timezone, snapshot.SampledAt)
	if len(out.FieldErrors) > 0 {
		return out
	}
	if fields := validateReportFilter(filter); len(fields) > 0 {
		out.FieldErrors = fields
		return out
	}
	out.Timezone = snapshot.Timezone.Timezone
	out.Revision = snapshot.Revision
	// Bind the resolved bounds and server actor as well as every normalized filter.
	signature, _ := json.Marshal([]any{actorID, filter, out.Start, out.End, out.AsOfDate, snapshot.Revision})
	digest, _ := s.protector.digest(signature, s.protector.current)
	anchor := base64.RawURLEncoding.EncodeToString(digest)
	var continuation reportCursor
	selected := map[string]bool{}
	for _, account := range snapshot.Accounts {
		if len(filter.Accounts) == 0 || contains(filter.Accounts, account.ID) {
			selected[account.ID] = true
			out.Accounts = append(out.Accounts, account)
		}
	}
	if len(filter.Accounts) > 0 && len(selected) != len(filter.Accounts) {
		out.Code = "NOT_FOUND"
		out.Accounts = []ReportAccount{}
		return out
	}
	if len(selected) == 0 {
		out.Code = "SETUP_REQUIRED"
		return out
	}
	if filter.ArchiveID != "" {
		found := false
		for _, a := range out.Accounts {
			for _, ar := range a.Archives {
				if ar.ID == filter.ArchiveID {
					found = true
				}
			}
		}
		if !found {
			out.Code = "NOT_FOUND"
			out.Accounts = []ReportAccount{}
			return out
		}
	}
	if request.After != "" {
		if !s.decodeReportCursor(request.After, &continuation) || continuation.Anchor != anchor {
			out.Code = "RESTART_REQUIRED"
			return out
		}
	}
	usable := true
	for n := range out.Accounts {
		if !deriveReportCoverage(&out.Accounts[n], out.Start, out.End) {
			usable = false
		}
	}
	if !usable && filter.ArchiveID == "" && !filter.Discrepancies {
		out.Code = "DATA_UNAVAILABLE"
		return out
	}
	rows := []Transaction{}
	for _, row := range snapshot.Rows {
		visible := row.Current
		if filter.Discrepancies {
			visible = row.Discrepancy != "none" && row.SourceRevision == row.LatestSourceRevision
		}
		if filter.ArchiveID != "" {
			visible = false
			for _, ar := range row.Archives {
				if ar.ArchiveID == filter.ArchiveID {
					visible = true
				}
			}
		}
		if !visible || !selected[row.AccountID] || row.BankDate < out.Start || row.BankDate > out.End {
			continue
		}
		if err := classifyTransaction(&row); err != nil {
			out.Code = "DATA_ERROR"
			return out
		}
		if !matchesReportFilter(row, filter) {
			continue
		}
		rows = append(rows, row)
	}
	summary, err := summarizeReport(rows)
	if err != nil {
		out.Code = "DATA_ERROR"
		return out
	}
	out.Counts = &ReportCounts{Count: summary.Count, PostedCount: summary.PostedCount, PendingCount: summary.PendingCount, RemovedCount: summary.RemovedCount, ExcludedCount: summary.ExcludedCount, UnresolvedCount: summary.UnresolvedCount, ReviewedCount: summary.ReviewedCount, ZeroCount: summary.ZeroCount, ClassificationComplete: summary.ClassificationComplete}
	out.TotalCount = len(rows)
	out.SpendingContext = "SPENDING_FROM_ACCOUNTS"
	if filter.Discrepancies {
		out.SpendingContext = "SOURCE_DISCREPANCIES"
	} else if filter.ArchiveID != "" {
		out.SpendingContext = "RECOVERY_ARCHIVE"
	} else if (len(filter.States) == 1 && filter.States[0] == "pending") || filter.Reviewed != nil {
		out.SpendingContext = "ACTIVITY_CONTEXT"
	} else {
		out.Summary = &summary
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].BankDate != rows[j].BankDate {
			return rows[i].BankDate > rows[j].BankDate
		}
		return rows[i].ID > rows[j].ID
	})
	for _, row := range rows {
		if request.After != "" && (row.BankDate > continuation.Date || (row.BankDate == continuation.Date && row.ID >= continuation.ID)) {
			continue
		}
		if len(out.Rows) == request.First {
			out.HasNextPage = true
			break
		}
		out.Rows = append(out.Rows, row)
	}
	if len(out.Rows) > 0 {
		last := out.Rows[len(out.Rows)-1]
		cursor := s.encodeReportCursor(reportCursor{Anchor: anchor, Date: last.BankDate, ID: last.ID, Version: s.protector.current})
		out.EndCursor = &cursor
	}
	out.Code = "READY"
	return out
}

func normalizeReportFilter(f *ReportFilter) {
	if f.Period == "" {
		f.Period = "THIS_MONTH"
	}
	for _, values := range []*[]string{&f.Accounts, &f.Categories, &f.Activities, &f.States} {
		*values = append([]string(nil), (*values)...)
		sort.Strings(*values)
		*values = unique(*values)
	}
}
func unique(values []string) []string {
	out := []string{}
	for _, value := range values {
		if len(out) == 0 || out[len(out)-1] != value {
			out = append(out, value)
		}
	}
	return out
}
func contains(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
func validateReportFilter(f ReportFilter) []string {
	fields := []string{}
	if f.Discrepancies && f.ArchiveID != "" {
		fields = append(fields, "archiveId")
	}
	if f.ArchiveID != "" {
		if _, err := uuid.Parse(f.ArchiveID); err != nil {
			fields = append(fields, "archiveId")
		}
	}
	if len(f.Accounts) > 100 || len(f.Categories) > len(reportCategories) || len(f.Activities) > len(reportActivities) || len(f.States) > 3 {
		return []string{"filter"}
	}
	for _, id := range f.Accounts {
		if _, err := uuid.Parse(id); err != nil {
			fields = append(fields, "accounts")
			break
		}
	}
	for _, value := range f.Categories {
		if !contains(reportCategories, value) {
			fields = append(fields, "categories")
			break
		}
	}
	for _, value := range f.Activities {
		if !contains(reportActivities, value) {
			fields = append(fields, "activities")
			break
		}
	}
	for _, value := range f.States {
		if !contains([]string{"posted", "pending", "removed"}, value) {
			fields = append(fields, "states")
			break
		}
	}
	return fields
}
func matchesReportFilter(r Transaction, f ReportFilter) bool {
	return (len(f.Categories) == 0 || contains(f.Categories, r.Category)) && (len(f.Activities) == 0 || contains(f.Activities, r.Activity)) && (len(f.States) == 0 || contains(f.States, r.ProcessingState)) && (f.Excluded == nil || r.Excluded == *f.Excluded) && (f.Reviewed == nil || r.Reviewed == *f.Reviewed)
}
func reportBounds(f ReportFilter, zone string, now time.Time) (string, string, string, []string) {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return "", "", "", []string{"timezone"}
	}
	local := now.In(loc)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	start, end := today, today
	fields := []string{}
	switch f.Period {
	case "THIS_MONTH":
		start = time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, time.UTC)
	case "LAST_MONTH":
		end = time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -1)
		start = time.Date(end.Year(), end.Month(), 1, 0, 0, 0, 0, time.UTC)
	case "LAST_60_DAYS":
		start = today.AddDate(0, 0, -59)
	case "LAST_90_DAYS":
		start = today.AddDate(0, 0, -89)
	case "YEAR_TO_DATE":
		start = time.Date(today.Year(), 1, 1, 0, 0, 0, 0, time.UTC)
	case "CUSTOM":
		start, err = time.Parse(time.DateOnly, f.Start)
		if err != nil || !validBankDate(f.Start) {
			fields = append(fields, "start")
		}
		end, err = time.Parse(time.DateOnly, f.End)
		if err != nil || !validBankDate(f.End) || end.After(today) {
			fields = append(fields, "end")
		}
		if len(fields) == 0 && start.After(end) {
			fields = append(fields, "start")
		}
	default:
		fields = append(fields, "period")
	}
	if f.Period != "CUSTOM" && (f.Start != "" || f.End != "") {
		fields = append(fields, "bounds")
	}
	if start.Year() < 1 || end.Year() < 1 {
		fields = append(fields, "period")
	}
	return start.Format(time.DateOnly), end.Format(time.DateOnly), today.Format(time.DateOnly), fields
}
func deriveReportCoverage(a *ReportAccount, start, end string) bool {
	a.Coverage = "COMPLETE"
	a.RequestedHistoryDays = 365
	usable := len(a.Intervals) > 0
	for n := range a.Intervals {
		i := &a.Intervals[n]
		i.Coverage = "COMPLETE"
		lower, upper := start, end
		if i.AfterDate != nil && lower <= *i.AfterDate {
			d, _ := time.Parse(time.DateOnly, *i.AfterDate)
			lower = d.AddDate(0, 0, 1).Format(time.DateOnly)
		}
		if i.ThroughDate != nil && upper > *i.ThroughDate {
			upper = *i.ThroughDate
		}
		if lower > upper {
			i.Coverage = "OUTSIDE_RANGE"
			continue
		}
		if i.ImportState != "usable" {
			usable = false
			i.Coverage = "UNAVAILABLE"
		} else if i.CoverageAfter == nil || i.CoverageThrough == nil {
			i.Coverage = "UNKNOWN"
		} else if lower <= *i.CoverageAfter || upper > *i.CoverageThrough {
			i.Coverage = "PARTIAL"
		}
		if i.DiscrepancyCount > 0 || i.CollectionStopped || strings.Contains(i.CollectionState, "/stopped/") || strings.HasSuffix(i.CollectionState, "/revoked") {
			if i.Coverage == "COMPLETE" {
				i.Coverage = "PARTIAL"
			}
		}
		if i.Coverage != "COMPLETE" {
			a.Coverage = "PARTIAL"
		}
	}
	return usable
}

type reportCursor struct{ Anchor, Date, ID, Version string }

func (s *Service) encodeReportCursor(c reportCursor) string {
	raw, _ := json.Marshal(c)
	sig, _ := s.protector.digest(raw, c.Version)
	return base64.RawURLEncoding.EncodeToString(raw) + "." + base64.RawURLEncoding.EncodeToString(sig)
}
func (s *Service) decodeReportCursor(value string, c *reportCursor) bool {
	parts := strings.Split(value, ".")
	if len(parts) != 2 {
		return false
	}
	raw, e := base64.RawURLEncoding.DecodeString(parts[0])
	if e != nil || json.Unmarshal(raw, c) != nil {
		return false
	}
	sig, e := base64.RawURLEncoding.DecodeString(parts[1])
	if e != nil {
		return false
	}
	expected, e := s.protector.digest(raw, c.Version)
	return e == nil && hmac.Equal(sig, expected)
}

// TransactionDetail masks absent, staged, deleted and foreign sources alike.
// An archive reference to a current source links CurrentID to its sole edit owner.
type TransactionDetail struct {
	Code        string
	Transaction *Transaction
	CurrentID   *string
}

// ReadTransaction reauthorizes canonical or archive detail without provider I/O.
func (s *Service) ReadTransaction(ctx context.Context, id, archive string) TransactionDetail {
	return s.readTransaction(ctx, id, archive, false)
}

// ReadDiscrepancy inspects the latest noncanonical source correction without
// counting it, reconciling identities or granting a separate annotation owner.
func (s *Service) ReadDiscrepancy(ctx context.Context, id string) TransactionDetail {
	return s.readTransaction(ctx, id, "", true)
}
func (s *Service) readTransaction(ctx context.Context, id, archive string, discrepancy bool) TransactionDetail {
	out := TransactionDetail{Code: "NOT_FOUND"}
	err := auth.WithActor(ctx, s.db, func(tx pgx.Tx, _ auth.Actor) error {
		snapshot, err := readReportSnapshot(ctx, tx, map[string]any{"source_id": id, "archive_id": archive, "discrepancies": discrepancy})
		if err != nil {
			return err
		}
		if len(snapshot.Rows) > 100000 {
			out.Code = "QUERY_LIMIT"
			return nil
		}
		for _, r := range snapshot.Rows {
			if r.ID == id && r.CurrentID != nil {
				out.CurrentID = r.CurrentID
			}
		}
		for _, r := range snapshot.Rows {
			if r.ID != id {
				continue
			}
			match := archive == "" && r.Current
			if discrepancy {
				match = r.Discrepancy != "none" && r.SourceRevision == r.LatestSourceRevision
			}
			for _, ref := range r.Archives {
				if ref.ArchiveID == archive {
					match = true
				}
			}
			if !match {
				continue
			}
			if err := classifyTransaction(&r); err != nil {
				out.Code = "DATA_ERROR"
				return nil
			}
			out.Code = "READY"
			out.Transaction = &r
			break
		}
		return nil
	})
	if err != nil {
		return TransactionDetail{Code: failure(ctx, err).Code}
	}
	if out.Transaction == nil {
		out.CurrentID = nil
	}
	return out
}

// AnnotationInput changes exactly one approved override. Nil Value resets only
// that field. Expected versions bind intent to the selected immutable bank fact.
type AnnotationInput struct {
	AttemptID, SourceID                                uuid.UUID
	SourceRevision, ExpectedRevision, MaterialRevision int64
	Field                                              string
	Value                                              *string
}

// EditAnnotation uses durable attempt recovery and immutable versioned edits.
// The receipt contains only the original safe outcome and opaque source ID.
func (s *Service) EditAnnotation(ctx context.Context, input AnnotationInput) Result {
	if input.AttemptID == uuid.Nil || input.SourceID == uuid.Nil || input.SourceRevision < 1 || input.MaterialRevision < 1 || input.ExpectedRevision < 0 || input.ExpectedRevision == int64(^uint64(0)>>1) || !validAnnotationValue(input) {
		return Result{Code: "INVALID_INPUT"}
	}
	return s.run(ctx, input.AttemptID, "annotation", input, func(tx pgx.Tx, _ auth.Actor) (Result, error) {
		// Validate activity sign against authorized facts inside the guarded write.
		var code string
		err := tx.QueryRow(ctx, `SELECT app.banking_edit_annotation($1,$2,$3,$4,$5,$6)`, input.SourceID, input.SourceRevision, input.ExpectedRevision, input.MaterialRevision, input.Field, input.Value).Scan(&code)
		return Result{Code: code, ID: input.SourceID}, err
	})
}
func validAnnotationValue(i AnnotationInput) bool {
	if !contains([]string{"category", "activity", "note", "excluded", "reviewed"}, i.Field) {
		return false
	}
	if i.Value == nil {
		return true
	}
	v := *i.Value
	switch i.Field {
	case "category":
		return contains(reportCategories, v)
	case "activity":
		return contains(reportActivities, v)
	case "excluded", "reviewed":
		return v == "true" || v == "false"
	case "note":
		if !utf8.ValidString(v) || utf8.RuneCountInString(v) > 2000 {
			return false
		}
		for _, r := range v {
			if unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t' {
				return false
			}
		}
		return true
	}
	return false
}

var reportCategories = []string{"INCOME", "LOAN_DISBURSEMENTS", "OTHER", "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS", "BANK_FEES", "ENTERTAINMENT", "FOOD_AND_DRINK", "GENERAL_MERCHANDISE", "HOME_IMPROVEMENT", "MEDICAL", "PERSONAL_CARE", "GENERAL_SERVICES", "GOVERNMENT_AND_NON_PROFIT", "TRANSPORTATION", "TRAVEL", "RENT_AND_UTILITIES", "UNCATEGORIZED"}
var reportActivities = []string{"purchase", "bank_fee", "debit_interest", "refund", "income", "transfer", "repayment", "cash_withdrawal", "loan_proceeds", "unresolved"}

func compatibleActivity(activity string, amount int64) bool {
	if amount == 0 {
		return contains(reportActivities, activity)
	}
	if amount > 0 {
		return contains([]string{"purchase", "bank_fee", "debit_interest", "cash_withdrawal", "transfer", "repayment", "unresolved"}, activity)
	}
	return contains([]string{"refund", "income", "loan_proceeds", "transfer", "repayment", "unresolved"}, activity)
}
func classifyTransaction(r *Transaction) error {
	amount, err := strconv.ParseInt(r.AmountMinor, 10, 64)
	if err != nil || strconv.FormatInt(amount, 10) != r.AmountMinor || r.Currency != "USD" || amount > 9007199254740991 || amount < -9007199254740991 {
		return errors.New("invalid source money")
	}
	r.Category = "UNCATEGORIZED"
	r.Activity = "unresolved"
	detail, providerCategory, knownTaxonomy := "", "", false
	if r.ProviderCategory != nil {
		detail = *r.ProviderCategory
		providerCategory, knownTaxonomy = pfcV2Categories[detail]
	}
	if r.ProviderPrimaryCategory != nil && *r.ProviderPrimaryCategory != "" {
		if detail == "" && contains(reportCategories, *r.ProviderPrimaryCategory) && *r.ProviderPrimaryCategory != "UNCATEGORIZED" {
			providerCategory = *r.ProviderPrimaryCategory
			knownTaxonomy = true
		}
		if knownTaxonomy && providerCategory != *r.ProviderPrimaryCategory {
			knownTaxonomy = false
		}
	}
	if knownTaxonomy {
		r.Category = providerCategory
	}
	if r.CategoryOverride != nil {
		r.Category = *r.CategoryOverride
	}
	if r.ActivityOverride != nil {
		if !r.MaterialConflict && compatibleActivity(*r.ActivityOverride, amount) {
			r.Activity = *r.ActivityOverride
		}
	} else {
		recognizedCode := false
		if r.ProviderCode != nil {
			switch *r.ProviderCode {
			case "purchase":
				recognizedCode = true
				r.Activity = "purchase"
			case "refund":
				recognizedCode = true
				r.Activity = "refund"
			case "bank charge", "late fee", "returned item fee":
				recognizedCode = true
				r.Activity = "bank_fee"
			case "interest":
				recognizedCode = true
				if amount < 0 {
					r.Activity = "income"
				} else {
					r.Activity = "debit_interest"
				}
			case "cash", "cash withdrawal", "atm":
				recognizedCode = true
				r.Activity = "cash_withdrawal"
			case "transfer":
				recognizedCode = true
				r.Activity = "transfer"
			}
		}
		categoryActivity := "unresolved"
		if knownTaxonomy && r.ProviderConfidence != nil && contains([]string{"HIGH", "VERY_HIGH"}, *r.ProviderConfidence) {
			categoryActivity = reportCategoryActivity(providerCategory, detail, amount)
		}
		if recognizedCode {
			if categoryActivity != "unresolved" && r.Activity != categoryActivity {
				r.Activity = "unresolved"
			}
		} else {
			r.Activity = categoryActivity
		}
		if !compatibleActivity(r.Activity, amount) {
			r.Activity = "unresolved"
		}
	}
	r.Eligible = r.Current && r.ProcessingState == "posted" && !r.Excluded && !r.MaterialConflict && contains([]string{"purchase", "bank_fee", "debit_interest", "refund"}, r.Activity)
	return nil
}
func reportCategoryActivity(category, detail string, amount int64) string {
	activity := "unresolved"
	switch category {
	case "ENTERTAINMENT", "FOOD_AND_DRINK", "GENERAL_MERCHANDISE", "HOME_IMPROVEMENT", "MEDICAL", "PERSONAL_CARE", "GENERAL_SERVICES", "TRANSPORTATION", "TRAVEL", "RENT_AND_UTILITIES":
		if amount >= 0 {
			activity = "purchase"
		}
	case "BANK_FEES":
		activity = "bank_fee"
		if detail == "BANK_FEES_INTEREST_CHARGE" {
			activity = "debit_interest"
		}
	case "INCOME":
		activity = "income"
	case "TRANSFER_IN", "TRANSFER_OUT":
		activity = "transfer"
		if detail == "TRANSFER_OUT_WITHDRAWAL" {
			activity = "cash_withdrawal"
		}
	case "LOAN_DISBURSEMENTS":
		activity = "loan_proceeds"
	case "LOAN_PAYMENTS":
		activity = "repayment"
	}
	if !compatibleActivity(activity, amount) {
		return "unresolved"
	}
	return activity
}
func summarizeReport(rows []Transaction) (ReportSummary, error) {
	out := ReportSummary{Count: len(rows), ClassificationComplete: true, Activities: []ReportActivity{}, Categories: []ReportActivity{}}
	positive, refund := new(big.Int), new(big.Int)
	activities, categories := map[string]*ReportActivity{}, map[string]*ReportActivity{}
	for _, r := range rows {
		switch r.ProcessingState {
		case "posted":
			out.PostedCount++
		case "pending":
			out.PendingCount++
		case "removed":
			out.RemovedCount++
		}
		if r.Excluded {
			out.ExcludedCount++
		}
		if r.Reviewed {
			out.ReviewedCount++
		}
		if r.AmountMinor == "0" {
			out.ZeroCount++
		}
		if r.Activity == "unresolved" || r.MaterialConflict {
			out.UnresolvedCount++
			out.ClassificationComplete = false
		}
		amount, _ := new(big.Int).SetString(r.AmountMinor, 10)
		if r.Eligible {
			if amount.Sign() < 0 {
				refund.Sub(refund, amount)
			} else {
				positive.Add(positive, amount)
			}
		}
		for key, group := range map[string]map[string]*ReportActivity{r.Activity: activities, "category:" + r.Category: categories} {
			lookup := strings.TrimPrefix(key, "category:")
			if group[lookup] == nil {
				group[lookup] = &ReportActivity{Key: lookup, NetMinor: "0"}
			}
			v := group[lookup]
			v.Count++
			if r.Eligible {
				total, _ := new(big.Int).SetString(v.NetMinor, 10)
				v.NetMinor = total.Add(total, amount).String()
			}
		}
	}
	net := new(big.Int).Sub(positive, refund)
	limit := big.NewInt(9007199254740991)
	for _, v := range []*big.Int{positive, refund, net} {
		if new(big.Int).Abs(v).Cmp(limit) > 0 {
			return ReportSummary{}, errors.New("aggregate overflow")
		}
	}
	out.PurchaseMinor = positive.String()
	out.RefundMinor = refund.String()
	out.NetMinor = net.String()
	for _, group := range []struct {
		values map[string]*ReportActivity
		out    *[]ReportActivity
	}{{activities, &out.Activities}, {categories, &out.Categories}} {
		for _, v := range group.values {
			*group.out = append(*group.out, *v)
		}
		sort.Slice(*group.out, func(i, j int) bool { return (*group.out)[i].Key < (*group.out)[j].Key })
	}
	return out, nil
}

// AnnotationOperationStatus reauthorizes only an annotation-kind durable receipt.
func (s *Service) AnnotationOperationStatus(ctx context.Context, attempt uuid.UUID) Result {
	return s.operationStatus(ctx, attempt, "annotation")
}
