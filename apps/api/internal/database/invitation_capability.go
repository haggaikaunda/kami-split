package database

import "context"

// InvitationPreview contains approved presentation names and invitation kind.
type InvitationPreview struct{ GroupName, InviterName, Kind string }

// PreviewInvitation reads an unconsumed live capability without actor identity.
// This grants no group access; admission must independently recheck evidence.
func (d *DB) PreviewInvitation(ctx context.Context, tokenHash []byte) (InvitationPreview, error) {
	var result InvitationPreview
	err := d.pool.QueryRow(ctx, `SELECT group_name,inviter_name,kind FROM app.onboarding_preview($1)`, tokenHash).Scan(&result.GroupName, &result.InviterName, &result.Kind)
	return result, err
}

// InvitationEligible checks a capability and canonical email without revealing
// account existence or granting membership. Admission rechecks current evidence.
func (d *DB) InvitationEligible(ctx context.Context, tokenHash []byte, canonicalEmail string) (bool, error) {
	var eligible bool
	err := d.pool.QueryRow(ctx, `SELECT app.invitation_eligible($1,$2)`, tokenHash, canonicalEmail).Scan(&eligible)
	return eligible, err
}

// TargetedInvitationRecipient reads or atomically claims a live targeted credential.
// A nil recipient means unavailable or previously consumed. Never expose the
// recipient in public preview; claims survive process restarts and resends.
func (d *DB) TargetedInvitationRecipient(ctx context.Context, hash []byte, consume bool) (*string, error) {
	var recipient *string
	err := d.pool.QueryRow(ctx, `SELECT app.onboarding_target($1,$2)`, hash, consume).Scan(&recipient)
	return recipient, err
}

// OnboardingSubjectAllowed rejects disabled/deleted application identities before
// releasing provider Auth material for a server-observed provider subject.
func (d *DB) OnboardingSubjectAllowed(ctx context.Context, subject string) (bool, error) {
	var allowed bool
	err := d.pool.QueryRow(ctx, `SELECT app.onboarding_subject_allowed($1::uuid)`, subject).Scan(&allowed)
	return allowed, err
}
