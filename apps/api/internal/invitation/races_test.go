//go:build integration

package invitation

import (
	"context"
	"encoding/json"
	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestSerializedInvitationRaces(t *testing.T) {
	cases := []struct {
		first, second, want string
		rollback            bool
	}{
		{"ACCEPT", "ACCEPT", "HISTORICAL_ACCEPTANCE", false},
		{"ACCEPT", "REVOKE", "ALREADY_ACCEPTED", false},
		{"REVOKE", "ACCEPT", "UNAVAILABLE_LINK", false},
		{"ACCEPT", "RESEND", "ALREADY_ACCEPTED", false},
		{"RESEND", "ACCEPT", "ADMITTED", false},
		{"RESEND", "REVOKE", "APPLIED", false},
		{"REVOKE", "RESEND", "ALREADY_REVOKED", false},
		{"RESEND", "RESEND", "RATE_LIMITED", false},
		{"ACCEPT", "REVOKE", "APPLIED", true},
		{"REVOKE", "ACCEPT", "ADMITTED", true},
	}
	for _, tc := range cases {
		t.Run(tc.first+"_then_"+tc.second+map[bool]string{true: "_rollback", false: ""}[tc.rollback], func(t *testing.T) {
			f := newFixture(t)
			created, token := f.create("member@example.invalid")
			f.allowResend()
			ctx := context.Background()
			if tc.first == "RESEND" {
				f.exec(`UPDATE app.invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, created.InvitationID)
			}
			tx, err := database.IntegrationPool(f.db).BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			subject := f.owner
			if tc.first == "ACCEPT" {
				subject = f.member
			}
			if _, err = tx.Exec(ctx, `SELECT set_config('app.verified_sub',$1,true)`, subject.String()); err != nil {
				t.Fatal(err)
			}
			var raw []byte
			if tc.first == "ACCEPT" {
				err = tx.QueryRow(ctx, `SELECT app.invitation_accept($1,$2,$3,$4,$5)`, TokenHash(token), "member@example.invalid", uuid.New(), make([]byte, 32), "one").Scan(&raw)
			} else {
				err = tx.QueryRow(ctx, `SELECT app.invitation_owner_action($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, tc.first, f.group, created.InvitationID, uuid.New(), make([]byte, 32), "one", uuid.New(), nil, nil, "", "").Scan(&raw)
			}
			if err != nil {
				t.Fatal(err)
			}
			var initial Result
			if err = json.Unmarshal(raw, &initial); err != nil {
				t.Fatal(err)
			}
			if initial.Outcome != "ADMITTED" && initial.Outcome != "APPLIED" {
				t.Fatalf("first action %+v", initial)
			}
			type answer struct {
				r   Result
				err error
			}
			done := make(chan answer, 1)
			owner, member := f.actor(f.owner), f.actor(f.member)
			go func() {
				var r Result
				var err error
				switch tc.second {
				case "ACCEPT":
					r, err = f.service.Accept(member, token, uuid.New())
				case "REVOKE":
					r, err = f.service.Revoke(owner, f.group, created.InvitationID, uuid.New())
				case "RESEND":
					r, err = f.service.Resend(owner, f.group, created.InvitationID, uuid.New())
				}
				done <- answer{r, err}
			}()
			select {
			case got := <-done:
				t.Fatalf("operation bypassed uncommitted serialized lock: %+v", got)
			case <-time.After(80 * time.Millisecond):
			}
			if tc.rollback {
				err = tx.Rollback(ctx)
			} else {
				err = tx.Commit(ctx)
			}
			if err != nil {
				t.Fatal(err)
			}
			select {
			case got := <-done:
				requireOutcome(t, got.r, got.err, tc.want)
			case <-time.After(8 * time.Second):
				t.Fatal("serialized operation did not finish")
			}
		})
	}
}
