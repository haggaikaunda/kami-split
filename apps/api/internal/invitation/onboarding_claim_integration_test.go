//go:build integration

package invitation

import (
	"context"
	"sync"
	"testing"

	"github.com/google/uuid"
)

func TestTargetedAuthClaimIsDurableAndSingleUse(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	created, token := f.create("member@example.invalid")
	hash := TokenHash(token)
	if recipient, err := f.db.TargetedInvitationRecipient(ctx, hash, true); err != nil || recipient != nil {
		t.Fatal("unsent capability accepted as delivered mailbox proof", err)
	}
	f.exec(`UPDATE app.invitation_delivery SET state='PROVIDER_ACCEPTED' WHERE action_id=$1`, created.ActionID)
	var wg sync.WaitGroup
	results := make(chan bool, 12)
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			recipient, err := f.db.TargetedInvitationRecipient(ctx, hash, true)
			if err != nil {
				t.Error(err)
			}
			results <- recipient != nil
		}()
	}
	wg.Wait()
	close(results)
	wins := 0
	for ok := range results {
		if ok {
			wins++
		}
	}
	if wins != 1 {
		t.Fatalf("concurrent claims: %d", wins)
	}
	f.allowResend()
	_, err := f.service.Resend(f.actor(f.owner), f.group, created.InvitationID, uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if recipient, err := f.db.TargetedInvitationRecipient(ctx, hash, true); err != nil || recipient != nil {
		t.Fatal("resend reset consumed login credential", err)
	}
	if recipient, err := f.db.TargetedInvitationRecipient(ctx, hash, false); err != nil || recipient == nil {
		t.Fatal("claim consumed explicit admission capability", err)
	}
	f.exec(`UPDATE app.invitations SET expires_at=clock_timestamp() WHERE id=$1`, created.InvitationID)
	if recipient, err := f.db.TargetedInvitationRecipient(ctx, hash, false); err != nil || recipient != nil {
		t.Fatal("expired capability exposed recipient", err)
	}
	shared, err := f.service.CreateShared(f.actor(f.owner), f.group, uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	link, err := f.service.CopyShared(f.actor(f.owner), f.group, shared.InvitationID)
	if err != nil {
		t.Fatal(err)
	}
	if recipient, err := f.db.TargetedInvitationRecipient(ctx, TokenHash(link.Value()), true); err != nil || recipient != nil {
		t.Fatal("shared link accepted as mailbox proof", err)
	}
}
