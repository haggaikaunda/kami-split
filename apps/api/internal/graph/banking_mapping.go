package graph

import (
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/banking"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph/model"
	"time"
)

func mapEnrollment(o banking.EnrollmentOutcome) *model.BankingEnrollmentResult {
	result := &model.BankingEnrollmentResult{Code: o.Code}
	if o.State != "" {
		result.State = &o.State
	}
	if o.AttemptID != uuid.Nil {
		id := o.AttemptID.String()
		result.AttemptID = &id
	}
	if o.ConnectionID != uuid.Nil {
		id := o.ConnectionID.String()
		result.ConnectionID = &id
	}
	if o.LinkToken != "" {
		result.LinkToken = &o.LinkToken
	}
	if !o.ExpiresAt.IsZero() {
		value := o.ExpiresAt.UTC().Format(time.RFC3339)
		result.ExpiresAt = &value
	}
	return result
}
