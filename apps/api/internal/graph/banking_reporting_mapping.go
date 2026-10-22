package graph

import (
	"context"
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/banking"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph/model"
)

func (r *Resolver) annotationResult(ctx context.Context, result banking.Result) *model.BankingAnnotationResult {
	out := &model.BankingAnnotationResult{Code: result.Code}
	if result.ID != uuid.Nil {
		id := result.ID.String()
		out.SourceID = &id
		detail := r.BankingStorage.ReadTransaction(ctx, id, "")
		out.Detail = &detail
	}
	return out
}
