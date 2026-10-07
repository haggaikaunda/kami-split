package expense

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"math/big"
	"strings"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Dashboard is a freshly authorized complete scope. Unavailable sharing exposes
// only the authorized Household ledger; incomplete rows never carry totals.
type Dashboard struct {
	// ContextVersion is present only for a complete authorized metadata projection.
	ContextVersion *string
	State          string
	Spaces         []DashboardSpace
	Totals         *DashboardTotals
}

// DashboardSpace keeps each original ledger independently actionable. Net is
// absent when the complete financial projection exceeds its exact bounds.
type DashboardSpace struct {
	Snapshot     Snapshot
	ViewerNet    *int64
	ExpenseCount int64
}

// DashboardTotals contains informational exact sums, never a repayment target.
// Counts use the canonical exact scalar range, independently of pagination.
type DashboardTotals struct {
	ViewerNetMinor, OpenBalanceCount, ActiveSpaceCount int64
	TotalSharedExpenseMinor, TotalSharedExpenseCount   int64
}

var errDashboardRestart = errors.New("dashboard discovery changed")

// ReadDashboard holds canonical user→scope guard→group locks and reads every
// eligible ledger and its current scope in one statement snapshot. Three fresh
// transactions within five seconds bound discovery races; failure returns no rows.
func (s *Service) ReadDashboard(ctx context.Context) (Dashboard, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	for attempt := 0; attempt < 3; attempt++ {
		var result Dashboard
		err := auth.WithActor(ctx, s.db, func(tx pgx.Tx, _ auth.Actor) error {
			var locked []byte
			if err := tx.QueryRow(ctx, `SELECT app.household_dashboard_lock()`).Scan(&locked); err != nil {
				return err
			}
			var scope struct {
				State  string
				Groups []string
			}
			if err := json.Unmarshal(locked, &scope); err != nil {
				return err
			}
			if scope.State == "NOT_FOUND" {
				return Failure("NOT_FOUND")
			}
			query := dashboardProjectionSQL()
			var raw []byte
			if err := tx.QueryRow(ctx, query).Scan(&raw); err != nil {
				return err
			}
			var data struct {
				State          string
				ContextVersion *string
				Groups         []string
				Rows           []struct {
					Snapshot json.RawMessage
					Count    string
				}
			}
			if err := json.Unmarshal(raw, &data); err != nil {
				return err
			}
			if data.State == "NOT_FOUND" {
				return Failure("NOT_FOUND")
			}
			held := make(map[string]bool, len(scope.Groups))
			for _, id := range scope.Groups {
				held[id] = true
			}
			for _, id := range data.Groups {
				if !held[id] {
					return errDashboardRestart
				}
			}
			result = Dashboard{State: data.State, ContextVersion: data.ContextVersion, Spaces: []DashboardSpace{}}
			for _, row := range data.Rows {
				snapshot, err := decodeSnapshot(row.Snapshot, PageRequest{First: 1})
				if err != nil {
					return err
				}
				count, ok := new(big.Int).SetString(row.Count, 10)
				if !ok || !count.IsInt64() || count.Sign() < 0 {
					return Failure("AMOUNT_OVERFLOW")
				}
				space := DashboardSpace{Snapshot: snapshot, ExpenseCount: count.Int64()}
				if snapshot.BalanceError == "" {
					for _, p := range snapshot.Balance.Positions {
						if p.MemberID == snapshot.ViewerMembershipID {
							net := p.Net
							space.ViewerNet = &net
						}
					}
				}
				result.Spaces = append(result.Spaces, space)
			}
			if result.State == "COMPLETE" {
				result.Totals = dashboardTotals(result.Spaces)
				if result.Totals == nil {
					result.State = "INCOMPLETE"
					result.ContextVersion = nil
				}
			}
			return nil
		})
		if err == nil {
			return result, nil
		}
		var failure *pgconn.PgError
		if errors.Is(err, errDashboardRestart) || (errors.As(err, &failure) && failure.Code == "40001") {
			continue
		}
		return Dashboard{}, safeError(err)
	}
	return Dashboard{}, Failure("UNAVAILABLE")
}

func dashboardTotals(spaces []DashboardSpace) *DashboardTotals {
	net, total, count := new(big.Int), new(big.Int), new(big.Int)
	open := int64(0)
	for _, space := range spaces {
		if space.ViewerNet == nil || space.Snapshot.BalanceError != "" {
			return nil
		}
		net.Add(net, big.NewInt(*space.ViewerNet))
		total.Add(total, big.NewInt(space.Snapshot.Total))
		count.Add(count, big.NewInt(space.ExpenseCount))
		if *space.ViewerNet != 0 {
			open++
		}
	}
	if !net.IsInt64() || (net.IsInt64() && net.Int64() == math.MinInt64) || !total.IsInt64() || !count.IsInt64() {
		return nil
	}
	return &DashboardTotals{ViewerNetMinor: net.Int64(), OpenBalanceCount: open, ActiveSpaceCount: int64(len(spaces)), TotalSharedExpenseMinor: total.Int64(), TotalSharedExpenseCount: count.Int64()}
}

func dashboardProjectionSQL() string {
	projection := projectionSQL
	// The ordinary projection remains authoritative; its bounded record page is
	// empty here, while all complete aggregates retain their original semantics.
	replacements := []string{"$11", "NULL::uuid", "$10", "NULL::uuid", "$9", "NULL::timestamptz", "$8", "NULL::date", "$7", "NULL::bigint", "$6", "NULL::uuid", "$5", "NULL::text", "$4", "NULL::date", "$3", "NULL::date", "$2", "0", "$1", "selected.id"}
	projection = strings.NewReplacer(replacements...).Replace(projection)
	return `WITH scope AS MATERIALIZED (SELECT app.household_expense_scope() AS data), selected AS (SELECT discovered.group_id::uuid AS id FROM scope,jsonb_array_elements_text(scope.data->'groups') AS discovered(group_id)) SELECT jsonb_build_object('State',scope.data->>'state','ContextVersion',` + contextVersionSQL + `,'Groups',scope.data->'groups','Rows',coalesce((SELECT jsonb_agg(jsonb_build_object('Snapshot',projection.value,'Count',(SELECT count(*)::text FROM app.expenses e WHERE e.group_id=selected.id)) ORDER BY selected.id) FROM selected CROSS JOIN LATERAL (` + projection + `) projection(value)),'[]'::jsonb)) FROM scope`
}
