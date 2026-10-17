package expense

import (
	"context"
	"encoding/json"
	"math"
	"math/big"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/jackc/pgx/v5"
)

// DirectoryEntry contains one authorized source's compact current facts, without
// member identities or ledger rows. Financial failures carry no usable amounts.
type DirectoryEntry struct {
	Group             Summary
	ActiveMemberCount int
	FinancialSummary  FinancialSummary
}

// FinancialSummary separates complete expense face-value spending from the
// viewer's signed personal position. Error makes both amounts unavailable.
type FinancialSummary struct {
	TotalSpendMinor, ViewerNetMinor int64
	Error                           string
}

// ReadDirectory returns every currently accessible non-Household group from one
// statement snapshot under runtime RLS, bounded by a five-second request deadline.
// It aggregates in PostgreSQL rather than reading expense pages or member lists.
// Any discovery/query/decoding failure returns no entries; financial overflow is
// explicit per source. Each new call rechecks current account and group access.
func (s *Service) ReadDirectory(ctx context.Context) ([]DirectoryEntry, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result []DirectoryEntry
	err := s.transaction(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		var payload []byte
		if err := tx.QueryRow(ctx, directoryProjectionSQL).Scan(&payload); err != nil {
			return err
		}
		var data struct {
			State string
			Rows  []struct {
				Group                             Summary
				ActiveMemberCount                 int64
				Total, Paid, Owed, Sent, Received string
			}
		}
		if err := json.Unmarshal(payload, &data); err != nil {
			return err
		}
		if data.State != "READY" {
			return Failure("NOT_FOUND")
		}
		result = make([]DirectoryEntry, 0, len(data.Rows))
		for _, row := range data.Rows {
			if row.ActiveMemberCount < 1 || row.ActiveMemberCount > math.MaxInt32 {
				return Failure("UNAVAILABLE")
			}
			row.Group.ID = ledger.PublicID("Group", row.Group.ID)
			result = append(result, DirectoryEntry{
				Group: row.Group, ActiveMemberCount: int(row.ActiveMemberCount),
				FinancialSummary: financialSummary(row.Total, row.Paid, row.Owed, row.Sent, row.Received),
			})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func financialSummary(total, paid, owed, sent, received string) FinancialSummary {
	values := make([]*big.Int, 0, 5)
	for _, raw := range []string{total, paid, owed, sent, received} {
		value, ok := new(big.Int).SetString(raw, 10)
		if !ok || !value.IsInt64() || value.Sign() < 0 {
			return FinancialSummary{Error: "AMOUNT_OVERFLOW"}
		}
		values = append(values, value)
	}
	net := new(big.Int).Sub(values[1], values[2])
	net.Add(net, values[3])
	net.Sub(net, values[4])
	if !net.IsInt64() || net.Int64() == math.MinInt64 {
		return FinancialSummary{Error: "AMOUNT_OVERFLOW"}
	}
	return FinancialSummary{TotalSpendMinor: values[0].Int64(), ViewerNetMinor: net.Int64()}
}
