package graph

import (
	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/banking"
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph/model"
	"strconv"
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

func parseBankingFence(input model.BankingFenceInput) (banking.FenceInput, bool) {
	attempt, e1 := uuid.Parse(input.AttemptID)
	connection, e2 := uuid.Parse(input.ConnectionID)
	generation, e3 := strconv.ParseInt(input.ExpectedGeneration, 10, 64)
	return banking.FenceInput{AttemptID: attempt, ConnectionID: connection, ExpectedGeneration: generation}, e1 == nil && e2 == nil && e3 == nil && generation > 0 && strconv.FormatInt(generation, 10) == input.ExpectedGeneration
}
