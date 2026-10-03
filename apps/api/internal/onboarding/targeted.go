package onboarding

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/haggaikaunda/kami-split/apps/api/internal/invitation"
)

// targetedContinuation consumes application mailbox proof before generating an
// Auth OTP. An interrupted attempt intentionally cannot mint another login token.
// The browser verifies the OTP on an isolated client before installing a session.
func (h *Handler) targetedContinuation(ctx context.Context, w http.ResponseWriter, token string) {
	hash := invitation.TokenHash(token)
	recipient, err := h.factory.db.TargetedInvitationRecipient(ctx, hash, false)
	if err != nil {
		h.providerOutcome(ctx, "targeted", "eligibility_failure", 0)
	}
	if err != nil || recipient == nil {
		respond(w, 400, map[string]string{"code": "UNAVAILABLE_LINK"})
		return
	}
	if bearer, _ := ctx.Value(requestTokenKey{}).(string); bearer != "" {
		provider, err := NewEmailProvider(h.factory.authURL, h.factory.apiKey, bearer)
		if err != nil {
			h.providerOutcome(ctx, "targeted", "email_observation_failure", 0)
			respond(w, 503, map[string]string{"code": "UNAVAILABLE"})
			return
		}
		evidence, err := auth.ObserveCurrentEmail(ctx, provider)
		if err != nil {
			if safeOutcome(err) == "UNAVAILABLE" {
				h.providerOutcome(ctx, "targeted", "email_observation_failure", 0)
			}
			respond(w, 401, map[string]string{"code": safeOutcome(err)})
			return
		}
		email, err := evidence.CanonicalEmail(ctx)
		if err != nil {
			respond(w, 401, map[string]string{"code": safeOutcome(err)})
			return
		}
		if email != *recipient {
			respond(w, 409, map[string]string{"code": "WRONG_ACCOUNT"})
			return
		}
		respond(w, 200, map[string]string{"code": "ALREADY_AUTHENTICATED"})
		return
	}
	digest, err := h.factory.protector.ActionDigest([]byte("provider:"+*recipient), "")
	if err != nil {
		h.providerOutcome(ctx, "targeted", "digest_failure", 0)
		respond(w, 503, map[string]string{"code": "UNAVAILABLE"})
		return
	}
	if !h.allow("email:"+base64.RawURLEncoding.EncodeToString(digest), 2) || !h.allow("provider", 20) {
		respond(w, 429, map[string]string{"code": "RATE_LIMITED"})
		return
	}
	recipient, err = h.factory.db.TargetedInvitationRecipient(ctx, hash, true)
	if err != nil {
		h.providerOutcome(ctx, "targeted", "claim_failure", 0)
		respond(w, 503, map[string]string{"code": "UNAVAILABLE"})
		return
	}
	if recipient == nil {
		respond(w, 409, map[string]string{"code": "TARGET_CONTINUATION_USED"})
		return
	}
	result, ok := h.generateTargetLink(ctx, *recipient)
	if !ok {
		respond(w, 503, map[string]string{"code": "TARGET_CONTINUATION_USED"})
		return
	}
	allowed, err := h.factory.db.OnboardingSubjectAllowed(ctx, result.ID)
	if err != nil {
		h.providerOutcome(ctx, "targeted", "subject_failure", 0)
	}
	if err != nil || !allowed {
		respond(w, 403, map[string]string{"code": "ACCESS_DISABLED"})
		return
	}
	// Recheck revocation/expiry after provider I/O and before releasing credentials.
	live, err := h.factory.db.TargetedInvitationRecipient(ctx, hash, false)
	if err != nil {
		h.providerOutcome(ctx, "targeted", "recheck_failure", 0)
	}
	if err != nil || live == nil || *live != *recipient {
		respond(w, 400, map[string]string{"code": "UNAVAILABLE_LINK"})
		return
	}
	respond(w, 200, map[string]any{"code": "READY", "tokenHash": result.Hash, "type": result.Type, "needsPassword": result.Confirmed == nil})
}

type generatedTargetLink struct {
	ID        string     `json:"id"`
	Email     string     `json:"email"`
	Hash      string     `json:"hashed_token"`
	Type      string     `json:"verification_type"`
	Confirmed *time.Time `json:"email_confirmed_at"`
}

func (h *Handler) generateTargetLink(ctx context.Context, email string) (generatedTargetLink, bool) {
	var result generatedTargetLink
	body, _ := json.Marshal(map[string]string{"type": "magiclink", "email": email})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.factory.authURL+"/admin/generate_link", bytes.NewReader(body))
	if err != nil {
		h.providerOutcome(ctx, "targeted", "request_failure", 0)
		return result, false
	}
	req.Header.Set("apikey", h.adminKey)
	if !strings.HasPrefix(h.adminKey, "sb_secret_") {
		req.Header.Set("Authorization", "Bearer "+h.adminKey)
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := h.client.Do(req)
	if err != nil {
		h.providerOutcome(ctx, "targeted", "transport_failure", 0)
		return result, false
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		h.providerOutcome(ctx, "targeted", "provider_failure", response.StatusCode)
		return result, false
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 64<<10+1))
	if err != nil || len(raw) > 64<<10 || json.Unmarshal(raw, &result) != nil {
		h.providerOutcome(ctx, "targeted", "response_failure", response.StatusCode)
		return generatedTargetLink{}, false
	}
	canonical, err := auth.CanonicalEmail(result.Email)
	_, idErr := uuid.Parse(result.ID)
	if err != nil || canonical != email || idErr != nil || result.Hash == "" || (result.Type != "signup" && result.Type != "magiclink") {
		h.providerOutcome(ctx, "targeted", "response_failure", response.StatusCode)
		return generatedTargetLink{}, false
	}
	h.providerOutcome(ctx, "targeted", "accepted", response.StatusCode)
	return result, true
}
