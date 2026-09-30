package database

import "context"

// InvitationPreview contains only the two names approved for capability preview.
type InvitationPreview struct{ GroupName, InviterName string }

// PreviewInvitation reads an unconsumed live capability without actor identity.
// This grants no group access; admission must independently recheck evidence.
func (d *DB) PreviewInvitation(ctx context.Context, tokenHash []byte) (InvitationPreview, error) {
	var result InvitationPreview
	err := d.pool.QueryRow(ctx, `SELECT group_name,inviter_name FROM app.invitation_preview($1)`, tokenHash).Scan(&result.GroupName, &result.InviterName)
	return result, err
}

// InvitationEligible checks a capability and canonical email without revealing
// account existence or granting membership. Admission rechecks current evidence.
func (d *DB) InvitationEligible(ctx context.Context, tokenHash []byte, canonicalEmail string) (bool, error) {
	var eligible bool
	err := d.pool.QueryRow(ctx, `SELECT app.invitation_eligible($1,$2)`, tokenHash, canonicalEmail).Scan(&eligible)
	return eligible, err
}
