//go:build integration

package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestVerifiedRequestRuntimeBoundary(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	admin, err := pgx.Connect(ctx, os.Getenv("TEST_DATABASE_ADMIN_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close(context.Background())
	db, err := database.Open(ctx, database.Config{URL: os.Getenv("TEST_DATABASE_URL"), MaxConns: 1, Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := func(n int) string { return fmt.Sprintf("78000000-0000-4000-8000-%012d", n) }
	uuid := func(n int) pgtype.UUID { var value pgtype.UUID; _ = value.Scan(id(n)); return value }
	execute := func(sql string) {
		t.Helper()
		if _, err := admin.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	execute(fmt.Sprintf(`INSERT INTO auth.users(id, email)
VALUES('%s', 'one78@example.invalid'), ('%s', 'two78@example.invalid');
BEGIN;
SET LOCAL ROLE kami_migrator;
INSERT INTO app.users(id, auth_subject, live_auth_id, display_name)
VALUES('%s', '%s', '%s', 'One'), ('%s', '%s', '%s', 'Two');
INSERT INTO app.groups(id, name, owner_membership_id)
VALUES('%s', 'First', '%s'), ('%s', 'Second', '%s');
INSERT INTO app.memberships(id, group_id, user_id, active)
VALUES('%s', '%s', '%s', true), ('%s', '%s', '%s', true), ('%s', '%s', '%s', false);
COMMIT;`, id(1), id(2), id(101), id(1), id(1), id(102), id(2), id(2), id(201), id(301), id(202), id(302), id(301), id(201), id(101), id(302), id(202), id(102), id(303), id(202), id(101)))
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_, err := admin.Exec(cleanup, fmt.Sprintf(`BEGIN; SET LOCAL ROLE kami_migrator; DELETE FROM app.memberships WHERE group_id IN ('%s','%s'); DELETE FROM app.groups WHERE id IN ('%s','%s'); DELETE FROM app.users WHERE id IN ('%s','%s'); COMMIT; DELETE FROM auth.users WHERE id IN ('%s','%s');`, id(201), id(202), id(201), id(202), id(101), id(102), id(1), id(2)))
		if err != nil {
			t.Errorf("fixture cleanup: %v", err)
		}
	}()
	verifier, key, now := requestFixture(t)
	token := func(n int) string { c := fixtureClaims(now); c["sub"] = id(n); return signFixture(t, key, c, nil) }
	started := make(chan struct{})
	finished := make(chan struct{})
	var once sync.Once
	endpoint := httptest.NewServer(verifier.Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload any
		err := WithActor(r.Context(), db, func(tx pgx.Tx, actor Actor) error {
			groups, err := database.ListGroups(r.Context(), tx)
			if err != nil {
				return err
			}
			payload = map[string]any{"actor": actor.ID, "groups": groups}
			switch r.URL.Query().Get("action") {
			case "cross-group":
				_, err = database.ReadGroup(r.Context(), tx, uuid(202))
				return err
			case "rollback":
				return errors.New("private SQL financial detail")
			case "cancel":
				once.Do(func() { close(started) })
				_, err = tx.Exec(r.Context(), "SELECT pg_sleep(20)")
				return err
			}
			return nil
		})
		if r.URL.Query().Get("action") == "cancel" {
			close(finished)
		}
		if err != nil {
			WriteError(w, err)
			return
		}
		_ = json.NewEncoder(w).Encode(payload)
	})))
	defer endpoint.Close()
	request := func(n int, action string) (int, string) {
		t.Helper()
		req, _ := http.NewRequestWithContext(ctx, "GET", endpoint.URL+"?action="+action, nil)
		req.Header.Set("Authorization", "Bearer "+token(n))
		req.Header.Set("X-User-ID", id(102))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		body, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(body)
	}
	noLeak := func() {
		t.Helper()
		var subject string
		if err := database.IntegrationPool(db).QueryRow(ctx, "SELECT coalesce(current_setting('app.verified_sub',true),'')").Scan(&subject); err != nil || subject != "" {
			t.Fatalf("identity survived reuse: %q %v", subject, err)
		}
	}
	for _, n := range []int{1, 2, 1, 2} {
		status, body := request(n, "")
		if status != 200 {
			t.Fatalf("enabled %d: %d %s", n, status, body)
		}
		var result struct {
			Actor  pgtype.UUID
			Groups []struct{ ID pgtype.UUID }
		}
		if err := json.Unmarshal([]byte(body), &result); err != nil {
			t.Fatal(err)
		}
		if result.Actor != uuid(100+n) || len(result.Groups) != 1 || result.Groups[0].ID != uuid(200+n) {
			t.Fatalf("wrong verified application actor or groups: %s", body)
		}
		noLeak()
	}
	for _, action := range []string{"rollback", "cross-group"} {
		status, body := request(1, action)
		if status != 503 || body == "" {
			t.Fatalf("unauthorized/failure path returned %d %s", status, body)
		}
		noLeak()
	}
	execute(fmt.Sprintf("SET ROLE kami_migrator; UPDATE app.users SET enabled=false WHERE id='%s'; RESET ROLE", id(101)))
	if status, body := request(1, ""); status != 403 || body == "" {
		t.Fatalf("old token disabled access: %d %s", status, body)
	}
	noLeak()
	if status, body := request(3, ""); status != 403 || body == "" {
		t.Fatalf("unprovisioned access: %d %s", status, body)
	}
	noLeak()
	requestCtx, stop := context.WithCancel(ctx)
	req, _ := http.NewRequestWithContext(requestCtx, "GET", endpoint.URL+"?action=cancel", nil)
	req.Header.Set("Authorization", "Bearer "+token(2))
	responseDone := make(chan struct{})
	go func() {
		defer close(responseDone)
		res, _ := http.DefaultClient.Do(req)
		if res != nil {
			res.Body.Close()
		}
	}()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("transaction did not start")
	}
	stop()
	select {
	case <-finished:
	case <-ctx.Done():
		t.Fatal("request cancellation did not reach database")
	}
	<-responseDone
	noLeak()
	if status, _ := request(2, ""); status != 200 {
		t.Fatal("pool did not recover after cancellation")
	}
	noLeak()
}
