package expense

import (
	"context"
	"encoding/json"

	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/jackc/pgx/v5"
)

// RepaymentPage is a complete bounded traversal page with freshly authorized
// minimal profiles. Its anchor may be older than a separately read balance.
type RepaymentPage struct {
	GroupID              string
	Revision             int64
	Members              []Member
	Records              []RepaymentRecord
	HasPrevious, HasNext bool
}

// ReadRepayments reads one signed-cursor boundary or a single node from one
// statement snapshot under current actor/group locks. No expense filters apply.
func (s *Service) ReadRepayments(ctx context.Context, groupID string, page PageRequest, repaymentID *string) (RepaymentPage, error) {
	group, err := rawID(groupID, "Group")
	if err != nil {
		return RepaymentPage{}, err
	}
	var node any
	if repaymentID != nil {
		node, err = rawID(*repaymentID, "Repayment")
		if err != nil {
			return RepaymentPage{}, err
		}
	}
	var result RepaymentPage
	err = s.transaction(ctx, func(tx pgx.Tx, _ auth.Actor) error {
		if _, e := tx.Exec(ctx, `SELECT app.lock_group_read($1)`, group); e != nil {
			return e
		}
		if page.First < 1 || page.First > 100 {
			return Failure("INVALID_INPUT")
		}
		var payload []byte
		if e := tx.QueryRow(ctx, repaymentProjectionSQL, group, page.First+1, page.Anchor, nullable(page.LastDate), nullable(page.LastCreated), nullable(page.LastID), node).Scan(&payload); e != nil {
			return e
		}
		if e := json.Unmarshal(payload, &result); e != nil {
			return e
		}
		if page.Anchor != nil {
			if *page.Anchor < 0 || *page.Anchor > result.Revision {
				return Failure("INVALID_CURSOR")
			}
			result.Revision = *page.Anchor
		}
		result.GroupID = groupID
		result.HasNext = len(result.Records) > page.First
		if result.HasNext {
			result.Records = result.Records[:page.First]
		}
		for i := range result.Members {
			result.Members[i].ID = ledger.PublicID("Membership", result.Members[i].ID)
		}
		for i := range result.Records {
			r := &result.Records[i]
			r.RepaymentID = ledger.PublicID("Repayment", r.RepaymentID)
			r.GroupID = groupID
			r.CreatorMembershipID = ledger.PublicID("Membership", r.CreatorMembershipID)
			r.SenderMembershipID = ledger.PublicID("Membership", r.SenderMembershipID)
			r.RecipientMembershipID = ledger.PublicID("Membership", r.RecipientMembershipID)
		}
		return nil
	})
	return result, err
}
