package database

import (
	"context"
	"strings"
	"testing"
	"time"
)

// Verify effective driver configuration rather than just accepted environment input.
func TestIndependentEffectivePoolConfiguration(t *testing.T) {
	t.Setenv("PGOPTIONS", "-c role=postgres -c search_path=auth")
	t.Setenv("PGAPPNAME", "ambient-application")
	t.Setenv("PGCONNECT_TIMEOUT", "999")
	t.Setenv("PGUSER", "postgres")
	t.Setenv("PGDATABASE", "unintended")
	t.Setenv("PGHOST", "unintended.example")
	c := Config{URL: "postgres://kami_api:synthetic@127.0.0.1:55422/postgres?sslmode=disable", MaxConns: 3, Timeout: 150 * time.Millisecond}
	pc, err := c.poolConfig()
	if err != nil {
		t.Fatal(err)
	}
	if pc.MaxConns != 3 || pc.MinConns != 0 || pc.MinIdleConns != 0 || pc.ConnConfig.ConnectTimeout != c.Timeout {
		t.Fatal("driver did not preserve explicit connection bounds")
	}
	if pc.ConnConfig.Host != "127.0.0.1" || pc.ConnConfig.Port != 55422 || pc.ConnConfig.User != "kami_api" || pc.ConnConfig.Database != "postgres" {
		t.Fatal("ambient environment replaced explicit connection identity")
	}
	if len(pc.ConnConfig.RuntimeParams) != 1 || pc.ConnConfig.RuntimeParams["application_name"] != "kami-api" {
		t.Fatalf("ambient session settings were retained: %v", pc.ConnConfig.RuntimeParams)
	}
}

func TestIndependentConfigurationBoundaries(t *testing.T) {
	valid := "postgres://kami_api:synthetic@127.0.0.1:55422/postgres?sslmode=disable"
	for _, tc := range []struct {
		name, key, value string
		valid            bool
	}{
		{"minimum pool", "DATABASE_MAX_CONNS", "1", true},
		{"maximum pool", "DATABASE_MAX_CONNS", "20", true},
		{"zero pool", "DATABASE_MAX_CONNS", "0", false},
		{"overflow pool", "DATABASE_MAX_CONNS", "999999999999999999999999999", false},
		{"minimum timeout", "DATABASE_TIMEOUT", "100ms", true},
		{"maximum timeout", "DATABASE_TIMEOUT", "10s", true},
		{"too short timeout", "DATABASE_TIMEOUT", "99ms", false},
		{"zero timeout", "DATABASE_TIMEOUT", "0s", false},
		{"negative timeout", "DATABASE_TIMEOUT", "-1s", false},
		{"missing TLS", "DATABASE_URL", strings.Split(valid, "?")[0], false},
		{"duplicate TLS", "DATABASE_URL", valid + "&sslmode=verify-full", false},
		{"escaped role option", "DATABASE_URL", valid + "&%6fptions=-crole%3Dpostgres", false},
		{"malformed option", "DATABASE_URL", valid + "&bad=%ZZ", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := map[string]string{"DATABASE_URL": valid, tc.key: tc.value}
			_, err := Load(func(key string) (string, bool) { v, ok := env[key]; return v, ok })
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, error=%v", tc.valid, err)
			}
		})
	}
}

func TestIndependentCanceledStartup(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	started := time.Now()
	db, err := Open(ctx, Config{URL: "postgres://kami_api:synthetic@127.0.0.1:1/postgres?sslmode=disable", MaxConns: 1, Timeout: 100 * time.Millisecond})
	if db != nil {
		db.Close()
		t.Fatal("canceled startup returned a pool")
	}
	if err == nil {
		t.Fatal("canceled startup succeeded")
	}
	if strings.Contains(err.Error(), "synthetic") {
		t.Fatal("startup leaked credentials")
	}
	if time.Since(started) > time.Second {
		t.Fatal("canceled startup exceeded its bound")
	}
}
