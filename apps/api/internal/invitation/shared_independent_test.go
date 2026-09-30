//go:build integration

package invitation

import (
	"context"
	"encoding/json"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/jackc/pgx/v5"
	"testing"
	"time"

	"github.com/google/uuid"
)

func independentShared(t *testing.T, f *fixture) (Result, string) {
	t.Helper()
	r, err := f.service.CreateShared(f.actor(f.owner), f.group, uuid.New())
	requireOutcome(t, r, err, "SAVED")
	token, err := f.service.CopyShared(f.actor(f.owner), f.group, r.InvitationID)
	if err != nil || token.Value() == "" {
		t.Fatal("copy shared capability", err)
	}
	return r, token.Value()
}

func TestIndependentSharedExpiryRenewalAndTerminalReplacement(t *testing.T) {
	f := newFixture(t)
	r, token := independentShared(t, f)
	f.exec(`UPDATE app.invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, r.InvitationID)
	var expired time.Time
	if err := f.admin.QueryRow(context.Background(), `SELECT expires_at FROM app.invitations WHERE id=$1`, r.InvitationID).Scan(&expired); err != nil {
		t.Fatal(err)
	}
	duplicate, err := f.service.CreateShared(f.actor(f.owner), f.group, uuid.New())
	requireOutcome(t, duplicate, err, "EXISTING")
	if duplicate.InvitationID != r.InvitationID || !duplicate.CurrentExpiresAt.Equal(expired) {
		t.Fatal("duplicate create replaced or renewed expired link")
	}
	copy, err := f.service.CopyShared(f.actor(f.owner), f.group, r.InvitationID)
	if err != nil || copy.Value() != token {
		t.Fatal("expired copy changed link", err)
	}
	if _, err := f.service.Preview(context.Background(), token); err == nil {
		t.Fatal("expired preview leaked names")
	}
	denied, err := f.service.Accept(f.actor(f.member), token, uuid.New())
	requireOutcome(t, denied, err, "UNAVAILABLE_LINK")
	key := uuid.New()
	renewed, err := f.service.RenewShared(f.actor(f.owner), f.group, r.InvitationID, key)
	requireOutcome(t, renewed, err, "APPLIED")
	var decision time.Time
	if err := f.admin.QueryRow(context.Background(), `SELECT committed_at FROM app.invitation_actions WHERE id=$1`, renewed.ActionID).Scan(&decision); err != nil {
		t.Fatal(err)
	}
	if !renewed.CurrentExpiresAt.Equal(decision.Add(7 * 24 * time.Hour)) {
		t.Fatal("expiry not seven days after serialized decision")
	}
	replay, err := f.service.RenewShared(f.actor(f.owner), f.group, r.InvitationID, key)
	requireOutcome(t, replay, err, "APPLIED")
	if !replay.CurrentExpiresAt.Equal(renewed.CurrentExpiresAt) {
		t.Fatal("replay extended expiry")
	}
	copy, err = f.service.CopyShared(f.actor(f.owner), f.group, r.InvitationID)
	if err != nil || copy.Value() != token {
		t.Fatal("renewal changed exact capability", err)
	}
	revoked, err := f.service.Revoke(f.actor(f.owner), f.group, r.InvitationID, uuid.New())
	requireOutcome(t, revoked, err, "APPLIED")
	terminal, err := f.service.RenewShared(f.actor(f.owner), f.group, r.InvitationID, uuid.New())
	requireOutcome(t, terminal, err, "ALREADY_REVOKED")
	if _, err := f.service.CopyShared(f.actor(f.owner), f.group, r.InvitationID); err == nil {
		t.Fatal("revoked token copied")
	}
	replacement, newToken := independentShared(t, f)
	if replacement.InvitationID == r.InvitationID || newToken == token {
		t.Fatal("replacement revived revoked capability")
	}
	var emails int
	if err := f.admin.QueryRow(context.Background(), `SELECT count(*) FROM app.invitation_delivery d JOIN app.invitation_actions a ON a.id=d.action_id WHERE a.group_id=$1`, f.group).Scan(&emails); err != nil || emails != 0 {
		t.Fatal("shared lifecycle scheduled application email", emails, err)
	}
}

func TestIndependentSharedFormerMemberNeverReadmitted(t *testing.T) {
	f := newFixture(t)
	r, token := independentShared(t, f)
	joined, err := f.service.Accept(f.actor(f.member), token, uuid.New())
	requireOutcome(t, joined, err, "ADMITTED")
	f.exec(`UPDATE app.memberships SET active=false WHERE id=$1`, joined.MembershipID)
	renewed, err := f.service.RenewShared(f.actor(f.owner), f.group, r.InvitationID, uuid.New())
	requireOutcome(t, renewed, err, "APPLIED")
	denied, err := f.service.Accept(f.actor(f.member), token, uuid.New())
	requireOutcome(t, denied, err, "NEW_TARGETED_INVITATION_REQUIRED")
	revoked, err := f.service.Revoke(f.actor(f.owner), f.group, r.InvitationID, uuid.New())
	requireOutcome(t, revoked, err, "APPLIED")
	_, fresh := independentShared(t, f)
	denied, err = f.service.Accept(f.actor(f.member), fresh, uuid.New())
	requireOutcome(t, denied, err, "NEW_TARGETED_INVITATION_REQUIRED")
	var active bool
	if err := f.admin.QueryRow(context.Background(), `SELECT active FROM app.memberships WHERE id=$1`, joined.MembershipID).Scan(&active); err != nil || active {
		t.Fatal("shared link undid departure", err)
	}
	_, targeted := f.create("member@example.invalid")
	returned, err := f.service.Accept(f.actor(f.member), targeted, uuid.New())
	requireOutcome(t, returned, err, "ADMITTED")
	if returned.MembershipID != joined.MembershipID {
		t.Fatal("targeted return lost stable membership")
	}
}

func TestIndependentSharedOwnershipAndMembershipSurviveRevocation(t *testing.T) {
	f := newFixture(t)
	r, token := independentShared(t, f)
	joined, err := f.service.Accept(f.actor(f.member), token, uuid.New())
	requireOutcome(t, joined, err, "ADMITTED")
	f.exec(`UPDATE app.groups SET owner_membership_id=$1 WHERE id=$2`, joined.MembershipID, f.group)
	if _, err := f.service.CopyShared(f.actor(f.owner), f.group, r.InvitationID); err == nil {
		t.Fatal("former owner copied capability")
	}
	if _, err := f.service.RenewShared(f.actor(f.owner), f.group, r.InvitationID, uuid.New()); err == nil {
		t.Fatal("former owner renewed")
	}
	copy, err := f.service.CopyShared(f.actor(f.member), f.group, r.InvitationID)
	if err != nil || copy.Value() != token {
		t.Fatal("ownership transfer invalidated link", err)
	}
	revoked, err := f.service.Revoke(f.actor(f.member), f.group, r.InvitationID, uuid.New())
	requireOutcome(t, revoked, err, "APPLIED")
	var active bool
	if err := f.admin.QueryRow(context.Background(), `SELECT active FROM app.memberships WHERE id=$1`, joined.MembershipID).Scan(&active); err != nil || !active {
		t.Fatal("revoke removed existing member", err)
	}
}

func TestIndependentSharedJoinRevokeSerialized(t *testing.T) {
	for _, first := range []string{"ACCEPT", "REVOKE"} {
		t.Run(first, func(t *testing.T) {
			f := newFixture(t)
			r, token := independentShared(t, f)
			ctx := context.Background()
			tx, err := database.IntegrationPool(f.db).BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			subject := f.owner
			if first == "ACCEPT" {
				subject = f.member
			}
			if _, err = tx.Exec(ctx, `SELECT set_config('app.verified_sub',$1,true)`, subject.String()); err != nil {
				t.Fatal(err)
			}
			var raw []byte
			if first == "ACCEPT" {
				err = tx.QueryRow(ctx, `SELECT app.invitation_accept($1,$2,$3,$4,$5)`, TokenHash(token), "member@example.invalid", uuid.New(), make([]byte, 32), "one").Scan(&raw)
			} else {
				err = tx.QueryRow(ctx, `SELECT app.invitation_owner_action($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, first, f.group, r.InvitationID, uuid.New(), make([]byte, 32), "one", uuid.New(), nil, nil, "", "").Scan(&raw)
			}
			if err != nil {
				t.Fatal(err)
			}
			var initial Result
			if err = json.Unmarshal(raw, &initial); err != nil {
				t.Fatal(err)
			}
			if initial.Outcome != "ADMITTED" && initial.Outcome != "APPLIED" {
				t.Fatal(initial)
			}
			type answer struct {
				r   Result
				err error
			}
			done := make(chan answer, 1)
			owner, member := f.actor(f.owner), f.actor(f.member)
			go func() {
				var out Result
				var e error
				if first == "ACCEPT" {
					out, e = f.service.Revoke(owner, f.group, r.InvitationID, uuid.New())
				} else {
					out, e = f.service.Accept(member, token, uuid.New())
				}
				done <- answer{out, e}
			}()
			select {
			case got := <-done:
				t.Fatalf("operation bypassed serialized decision: %+v", got)
			case <-time.After(80 * time.Millisecond):
			}
			if err = tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			want := "APPLIED"
			if first == "REVOKE" {
				want = "UNAVAILABLE_LINK"
			}
			select {
			case got := <-done:
				requireOutcome(t, got.r, got.err, want)
			case <-time.After(8 * time.Second):
				t.Fatal("blocked operation did not finish")
			}
			var count int
			if err = f.admin.QueryRow(ctx, `SELECT count(*) FROM app.memberships m JOIN app.users u ON u.id=m.user_id WHERE m.group_id=$1 AND u.auth_subject=$2 AND m.active`, f.group, f.member).Scan(&count); err != nil {
				t.Fatal(err)
			}
			if (first == "ACCEPT" && count != 1) || (first == "REVOKE" && count != 0) {
				t.Fatal("wrong membership effect", count)
			}
		})
	}
}
