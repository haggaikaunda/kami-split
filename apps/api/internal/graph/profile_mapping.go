package graph

import (
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph/model"
	"github.com/haggaikaunda/kami-split/apps/api/internal/profile"
)

func mapProfile(out profile.Result) model.ProfileResult {
	if out.Code == "READY" {
		return &model.Profile{ID: out.ID, DisplayName: out.DisplayName}
	}
	message := "Your profile could not be loaded or saved. Reload to check its current value."
	switch out.Code {
	case "INVALID_INPUT":
		message = "Enter a display name of 1–120 characters."
	case "CONFLICT":
		message = "Your display name changed elsewhere. Reload your profile before saving again."
	case "FORBIDDEN":
		message = "An enabled application account is required."
	case "UNAUTHENTICATED":
		message = "Sign in to access your profile."
	}
	return &model.ProfileProblem{Code: out.Code, Message: message}
}
