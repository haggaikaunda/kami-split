package graph

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph/model"
	"github.com/haggaikaunda/kami-split/apps/api/internal/invitation"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
)

func invitationID(raw, kind string) (uuid.UUID, error) {
	id, err := ledger.ParseID(raw, kind)
	if err != nil {
		return uuid.Nil, invitation.Outcome("INVALID_INPUT")
	}
	return uuid.Parse(id)
}
func inviteProblem(ctx context.Context, err error) *model.InvitationProblem {
	diagnostic.Report(ctx, err)
	code := "UNAVAILABLE"
	var domain invitation.Outcome
	var identity auth.Outcome
	if errors.As(err, &domain) {
		switch string(domain) {
		case "ACCESS_DENIED", "INVALID_INPUT", "INVALID_EMAIL", "UNAVAILABLE_LINK", "NOT_CLAIMABLE":
			code = string(domain)
		}
	}
	if errors.As(err, &identity) {
		switch string(identity) {
		case "DISABLED":
			code = "ACCESS_DISABLED"
		case "UNAUTHENTICATED", "VERIFY_EMAIL":
			code = string(identity)
		}
	}
	return &model.InvitationProblem{Code: code, Message: "The invitation operation could not be completed. Recover the original action before retrying."}
}
func inviteID(kind string, id uuid.UUID) *string {
	if id == uuid.Nil {
		return nil
	}
	s := ledger.PublicID(kind, id.String())
	return &s
}
func inviteTime(t time.Time) *ledger.DateTime {
	if t.IsZero() {
		return nil
	}
	s := ledger.DateTime(t.UTC().Format("2006-01-02T15:04:05.000000Z"))
	return &s
}
func nonempty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
func invitationResult(ctx context.Context, out invitation.Result, err error) model.InvitationResult {
	if err != nil {
		return inviteProblem(ctx, err)
	}
	outcome := model.InvitationOutcome(out.Outcome)
	if !outcome.IsValid() {
		return inviteProblem(ctx, invitation.Unavailable)
	}
	return &model.InvitationActionResult{ActionID: inviteID("InvitationAction", out.ActionID), InvitationID: inviteID("Invitation", out.InvitationID), GroupID: inviteID("Group", out.GroupID), Outcome: outcome, CommittedExpiresAt: inviteTime(out.ExpiresAt), CurrentExpiresAt: inviteTime(out.CurrentExpiresAt), Lifecycle: nonempty(out.Lifecycle), Delivery: nonempty(out.Delivery), HasAccess: out.HasAccess}
}
