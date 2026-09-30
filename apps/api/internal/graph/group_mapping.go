package graph

import (
	"context"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph/model"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"strings"
)

func mapGroupCreation(ctx context.Context, key ledger.OperationKey, out database.GroupCreationResult) any {
	switch out.State {
	case "COMPLETED":
		return &model.GroupCreationCompleted{OperationKey: key, GroupID: ledger.PublicID("Group", out.GroupID), CreatorMembershipID: ledger.PublicID("Membership", out.OwnerMembershipID), CreatedAt: ledger.DateTime(out.CreatedAt.UTC().Format("2006-01-02T15:04:05.000000Z"))}
	case "REJECTED":
		result := &model.GroupCreationRejected{OperationKey: key, Fields: []*model.FieldProblem{}}
		for _, field := range out.FieldErrors {
			result.Fields = append(result.Fields, &model.FieldProblem{Path: strings.Split(field.Field, "."), Code: field.Code, Message: "The field does not satisfy group creation requirements."})
		}
		return result
	case "OPERATION_CONFLICT":
		return &model.GroupCreationConflict{OperationKey: key}
	case "NOT_STARTED":
		return &model.GroupCreationNotStarted{OperationKey: key}
	case "NOT_FOUND":
		return problem(ctx, expense.Failure("NOT_FOUND"))
	default:
		return problem(ctx, expense.Failure("UNAVAILABLE"))
	}
}
