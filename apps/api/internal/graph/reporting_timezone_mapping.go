package graph

import (
	"github.com/haggaikaunda/kami-split/apps/api/internal/graph/model"
	"github.com/haggaikaunda/kami-split/apps/api/internal/reportingtimezone"
)

func mapReportingTimezone(out reportingtimezone.Result) model.ReportingTimezoneResult {
	if out.Code == "READY" && out.Timezone != nil && out.Version != nil {
		return &model.ReportingTimezone{Timezone: *out.Timezone, Version: reportingtimezone.Version(*out.Version)}
	}
	message := "The reporting timezone could not be loaded or saved. Recover the original attempt before trying again."
	switch out.Code {
	case "NOT_INITIALIZED":
		message = "Initialize your reporting timezone before changing it."
	case "INVALID_INPUT":
		message = "Choose a valid IANA timezone and preference version."
	case "CONFLICT":
		message = "Your reporting timezone changed. Read its current value before an explicit new attempt."
	case "ATTEMPT_MISMATCH":
		message = "This attempt was already used with different input. Recover its original outcome."
	case "NOT_FOUND":
		message = "No outcome is available. An in-flight write may still complete; retry the identical attempt and input."
	case "FORBIDDEN":
		message = "An enabled application account is required."
	case "UNAUTHENTICATED":
		message = "Sign in to access your reporting timezone."
	}
	return &model.ReportingTimezoneProblem{Code: out.Code, Message: message}
}
