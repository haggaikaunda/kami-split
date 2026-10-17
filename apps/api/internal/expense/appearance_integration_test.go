//go:build integration

package expense_test

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"

	"github.com/haggaikaunda/kami-split/apps/api/internal/profile"
	"github.com/jackc/pgx/v5"
)

func TestAppearancePersistenceIsolationAndConcurrency(t *testing.T) {
	f := newExpenseFixture(t)
	query := `query { currentProfile { __typename ... on Profile { id displayName appearance } ... on ProfileProblem { code } } }`
	mutation := `mutation ($value: Appearance!, $expected: Appearance!) {
  updateMyAppearance(appearance: $value, expectedAppearance: $expected) {
    __typename
    ... on Profile {
      id
      displayName
      appearance
    }
    ... on ProfileProblem {
      code
    }
  }
}`
	read := func(actor int) map[string]any {
		return groupRequest(t, f, actor, query, nil, "currentProfile", "Profile")
	}
	update := func(actor int, value, expected, kind string) map[string]any {
		return groupRequest(t, f, actor, mutation, map[string]any{"value": value, "expected": expected}, "updateMyAppearance", kind)
	}
	if read(2)["appearance"] != "SYSTEM" {
		t.Fatal("new account must default to system")
	}
	for _, value := range []string{"DARK", "SYSTEM", "LIGHT"} {
		expected := read(2)["appearance"].(string)
		saved := update(2, value, expected, "Profile")
		if saved["appearance"] != value || saved["displayName"] != "Actor 2" || saved["id"] != f.public("Profile", 102) {
			t.Fatal(saved)
		}
		if read(2)["appearance"] != value {
			t.Fatal("preference did not persist")
		}
	}
	update(2, "DARK", "LIGHT", "Profile")
	update(2, "DARK", "LIGHT", "Profile") // Lost-response retry.
	if stale := update(2, "SYSTEM", "LIGHT", "ProfileProblem"); stale["code"] != "CONFLICT" {
		t.Fatal(stale)
	}
	if read(1)["appearance"] != "SYSTEM" {
		t.Fatal("another user's preference changed")
	}
	name := groupRequest(t, f, 2, `mutation {
  updateMyProfile(displayName: "Renamed", expectedDisplayName: "Actor 2") {
    __typename
    ... on Profile {
      displayName
      appearance
    }
  }
}`, nil, "updateMyProfile", "Profile")
	if name["appearance"] != "DARK" {
		t.Fatal("name edit reset appearance", name)
	}
	if saved := update(2, "LIGHT", "DARK", "Profile"); saved["displayName"] != "Renamed" {
		t.Fatal(saved)
	}

	var wg sync.WaitGroup
	outcomes := make(chan []byte, 2)
	for _, value := range []string{"DARK", "SYSTEM"} {
		wg.Add(1)
		go func(value string) {
			defer wg.Done()
			_, body, err := groupHTTP(f, 2, mutation, map[string]any{"value": value, "expected": "LIGHT"})
			if err != nil {
				t.Error(err)
				return
			}
			outcomes <- body
		}(value)
	}
	wg.Wait()
	close(outcomes)
	successes, conflicts := 0, 0
	for body := range outcomes {
		var response struct{ Data map[string]map[string]any }
		if err := json.Unmarshal(body, &response); err != nil {
			t.Fatal(err)
		}
		result := response.Data["updateMyAppearance"]
		if result["__typename"] == "Profile" {
			successes++
		}
		if result["code"] == "CONFLICT" {
			conflicts++
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("successes=%d conflicts=%d", successes, conflicts)
	}

	for _, values := range [][2]any{{"INVALID", "LIGHT"}, {"LIGHT", "INVALID"}, {nil, "LIGHT"}, {"LIGHT", nil}} {
		err := f.db.WithIdentity(f.ctx, f.id(2), func(tx pgx.Tx) error {
			var status string
			if err := tx.QueryRow(f.ctx, `SELECT app.update_my_appearance($1,$2)`, values[0], values[1]).Scan(&status); err != nil {
				return err
			}
			if status != "INVALID_INPUT" {
				return fmt.Errorf("invalid preference accepted: %s", status)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if result := update(5, "DARK", "LIGHT", "ProfileProblem"); result["code"] != "FORBIDDEN" {
		t.Fatal(result)
	}
	_, body, err := groupHTTP(f, 0, mutation, map[string]any{"value": "DARK", "expected": "LIGHT"})
	if err != nil {
		t.Fatal(err)
	}
	var anonymous struct{ Errors []any }
	if json.Unmarshal(body, &anonymous) != nil || len(anonymous.Errors) == 0 {
		t.Fatal("anonymous update accepted")
	}
	if out := profile.New(nil).UpdateAppearance(f.ctx, "DARK", "LIGHT"); out.Code != "UNAUTHENTICATED" {
		t.Fatal(out)
	}
	_, body, err = groupHTTP(f, 1, `mutation { updateMyAppearance(appearance:DARK,expectedAppearance:LIGHT,id:"other") { __typename } }`, nil)
	if err != nil {
		t.Fatal(err)
	}
	var injected struct{ Errors []any }
	if json.Unmarshal(body, &injected) != nil || len(injected.Errors) == 0 {
		t.Fatal("target argument accepted")
	}
	f.exec(fmt.Sprintf(`SET ROLE kami_migrator; UPDATE app.users SET enabled=false WHERE id='%s'; RESET ROLE`, f.id(102)))
	if result := update(2, "LIGHT", "DARK", "ProfileProblem"); result["code"] != "FORBIDDEN" {
		t.Fatal(result)
	}
	if err := f.db.WithIdentity(f.ctx, f.id(1), func(tx pgx.Tx) error {
		_, err := tx.Exec(f.ctx, `UPDATE app.users SET appearance='DARK' WHERE id=$1`, f.id(102))
		return err
	}); err == nil {
		t.Fatal("runtime arbitrary preference write allowed")
	}
}
