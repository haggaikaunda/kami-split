package database

import (
	"strings"
	"testing"
)

func TestConfiguration(t *testing.T) {
	valid := "postgres://kami_api:synthetic@127.0.0.1:54322/postgres?sslmode=disable"
	for _, tc := range []struct {
		name string
		env  map[string]string
		bad  bool
	}{
		{"health only", nil, false},
		{"local", map[string]string{"DATABASE_URL": valid}, false},
		{"remote verified", map[string]string{"DATABASE_URL": "postgres://kami_api:x@db.example.com/postgres?sslmode=verify-full"}, false},
		{"empty", map[string]string{"DATABASE_URL": ""}, true},
		{"malformed", map[string]string{"DATABASE_URL": "secret%%%"}, true},
		{"missing user", map[string]string{"DATABASE_URL": "postgres://localhost/postgres?sslmode=disable"}, true},
		{"missing database", map[string]string{"DATABASE_URL": "postgres://kami_api:x@localhost/?sslmode=disable"}, true},
		{"remote insecure", map[string]string{"DATABASE_URL": "postgres://kami_api:secret@db.example.com/postgres?sslmode=disable"}, true},
		{"tls downgrade", map[string]string{"DATABASE_URL": strings.Replace(valid, "disable", "prefer", 1)}, true},
		{"URL pool override", map[string]string{"DATABASE_URL": valid + "&pool_max_conns=1000"}, true},
		{"role override", map[string]string{"DATABASE_URL": valid + "&options=-crole=postgres"}, true},
		{"negative pool", map[string]string{"DATABASE_URL": valid, "DATABASE_MAX_CONNS": "-1"}, true},
		{"huge pool", map[string]string{"DATABASE_URL": valid, "DATABASE_MAX_CONNS": "21"}, true},
		{"invalid pool", map[string]string{"DATABASE_URL": valid, "DATABASE_MAX_CONNS": "x"}, true},
		{"empty timeout", map[string]string{"DATABASE_URL": valid, "DATABASE_TIMEOUT": ""}, true},
		{"unbounded timeout", map[string]string{"DATABASE_URL": valid, "DATABASE_TIMEOUT": "11s"}, true},
		{"orphan setting", map[string]string{"DATABASE_MAX_CONNS": "5"}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := Load(func(k string) (string, bool) { v, ok := tc.env[k]; return v, ok })
			if (err != nil) != tc.bad {
				t.Fatalf("error = %v", err)
			}
			if err != nil && strings.Contains(err.Error(), "secret") {
				t.Fatal("configuration leaked secret")
			}
			if err == nil && cfg != nil {
				pc, err := cfg.poolConfig()
				if err != nil || pc.MaxConns != 5 || pc.MinConns != 0 {
					t.Fatal("unexpected defaults")
				}
			}
		})
	}
}
