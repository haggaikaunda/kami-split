//go:build integration

package invitation

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestSharedLifecycle(t *testing.T) {
	f := newFixture(t)
	owner := f.actor(f.owner)
	key := uuid.New()
	created, err := f.service.CreateShared(owner, f.group, key)
	if err != nil || created.Outcome != "SAVED" || created.Delivery != "NOT_REQUESTED" {
		t.Fatalf("create: %+v %v", created, err)
	}
	token, err := f.service.CopyShared(owner, f.group, created.InvitationID)
	if err != nil || TokenHash(token.Value()) == nil {
		t.Fatal("copy failed", err)
	}
	if strings.Contains(fmt.Sprintf("%v %#v", token, token), token.Value()) {
		t.Fatal("unredacted token")
	}
	again, err := f.service.CreateShared(owner, f.group, uuid.New())
	if err != nil || again.InvitationID != created.InvitationID || !again.ExpiresAt.Equal(created.ExpiresAt) {
		t.Fatalf("duplicate create: %+v %v", again, err)
	}
	f.exec(`UPDATE app.invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, created.InvitationID)
	if _, err := f.service.Preview(context.Background(), token.Value()); err != Outcome("UNAVAILABLE_LINK") {
		t.Fatalf("expired preview: %v", err)
	}
	copied, err := f.service.CopyShared(owner, f.group, created.InvitationID)
	if err != nil || copied.Value() != token.Value() {
		t.Fatal("expired copy changed link", err)
	}
	renewKey := uuid.New()
	before := time.Now()
	renewed, err := f.service.RenewShared(owner, f.group, created.InvitationID, renewKey)
	if err != nil || renewed.ExpiresAt.Before(before.Add(7*24*time.Hour)) || renewed.ExpiresAt.After(time.Now().Add(7*24*time.Hour)) {
		t.Fatalf("renew: %+v %v", renewed, err)
	}
	replay, err := f.service.RenewShared(owner, f.group, created.InvitationID, renewKey)
	if err != nil || !replay.ExpiresAt.Equal(renewed.ExpiresAt) {
		t.Fatal("renew replay changed expiry", err)
	}
	copied, err = f.service.CopyShared(owner, f.group, created.InvitationID)
	if err != nil || copied.Value() != token.Value() {
		t.Fatal("renew changed link", err)
	}
	preview, err := f.service.Preview(context.Background(), token.Value())
	if err != nil || preview.GroupName != "Synthetic group" || preview.InviterName != "Owner" {
		t.Fatal("preview", preview, err)
	}
	eligible, err := f.service.Eligible(context.Background(), token.Value(), "member@example.invalid")
	if err != nil || eligible {
		t.Fatal("shared link must not provision Auth accounts", err)
	}
	var wg sync.WaitGroup
	results := make(chan Result, 8)
	errs := make(chan error, 8)
	for range 8 {
		wg.Go(func() {
			out, e := f.service.Accept(f.actor(f.member), token.Value(), uuid.New())
			results <- out
			errs <- e
		})
	}
	wg.Wait()
	close(results)
	close(errs)
	admitted := 0
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	for out := range results {
		if out.Outcome == "ADMITTED" {
			admitted++
		}
		if !out.HasAccess || out.MembershipID == uuid.Nil || (out.Outcome != "ADMITTED" && out.Outcome != "ALREADY_MEMBER") {
			t.Fatalf("join %+v", out)
		}
	}
	if admitted != 1 {
		t.Fatalf("admission effects %d", admitted)
	}
	// The original owner is another eligible actor; join leaves their role intact.
	out, err := f.service.Accept(owner, token.Value(), uuid.New())
	if err != nil || out.Outcome != "ALREADY_MEMBER" || !out.HasAccess {
		t.Fatal("owner join", out, err)
	}
	var count int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.invitation_delivery d JOIN app.invitation_actions a ON a.id=d.action_id WHERE a.invitation_id=$1`, created.InvitationID).Scan(&count); err != nil || count != 0 {
		t.Fatal("shared email scheduled", count, err)
	}
	live, err := f.service.CopyShared(owner, f.group, created.InvitationID)
	if err != nil || live.Value() != token.Value() {
		t.Fatal("join consumed link", err)
	}
	_, err = f.service.Revoke(owner, f.group, created.InvitationID, uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.service.CopyShared(owner, f.group, created.InvitationID); err != Outcome("UNAVAILABLE_LINK") {
		t.Fatal("revoked copy", err)
	}
	out, err = f.service.RenewShared(owner, f.group, created.InvitationID, uuid.New())
	if err != nil || out.Outcome != "ALREADY_REVOKED" {
		t.Fatal("revoked renewed", out, err)
	}
	out, err = f.service.Accept(f.actor(f.member), token.Value(), uuid.New())
	if err != nil || out.Outcome != "UNAVAILABLE_LINK" {
		t.Fatal("revoked joined", out, err)
	}
	var active bool
	if err := f.admin.QueryRow(context.Background(), `SELECT m.active FROM app.memberships m JOIN app.users u ON u.id=m.user_id WHERE m.group_id=$1 AND u.auth_subject=$2`, f.group, f.member).Scan(&active); err != nil || !active {
		t.Fatal("revocation removed member", err)
	}
	replacement, err := f.service.CreateShared(owner, f.group, uuid.New())
	if err != nil || replacement.InvitationID == created.InvitationID {
		t.Fatal("replacement", replacement, err)
	}
}
