package graph

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"

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
	// Hash the complete fixed DTO before assigning its cache ID. Its acyclic
	// fields are all JSON-supported; selection cannot affect this projection.
	encoded, _ := json.Marshal(out)
	digest := sha256.Sum256(encoded)
	out.ID = "BankingAnnotationResult:" + base64.RawURLEncoding.EncodeToString(digest[:])
	return out
}
