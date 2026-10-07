// Package database owns the API's connection pool, never migrations.
package database

import (
	"context"
	"errors"
	"net/url"
	"strconv"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/diagnostic"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Config is validated before any connections are opened. An absent DATABASE_URL
// selects the health-only development mode; an explicitly empty URL is invalid.
type Config struct {
	URL      string
	MaxConns int32
	Timeout  time.Duration
}

// Load validates database settings from lookup. It returns nil configuration when
// DATABASE_URL and its dependent settings are absent; explicit empty values fail.
func Load(lookup func(string) (string, bool)) (*Config, error) {
	raw, enabled := lookup("DATABASE_URL")
	if !enabled {
		for _, key := range []string{"DATABASE_MAX_CONNS", "DATABASE_TIMEOUT"} {
			if _, ok := lookup(key); ok {
				return nil, errors.New("database settings require DATABASE_URL")
			}
		}
		return nil, nil
	}
	c := &Config{URL: raw, MaxConns: 5, Timeout: 2 * time.Second}
	if v, ok := lookup("DATABASE_MAX_CONNS"); ok {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 20 {
			return nil, errors.New("DATABASE_MAX_CONNS must be between 1 and 20")
		}
		c.MaxConns = int32(n)
	}
	if v, ok := lookup("DATABASE_TIMEOUT"); ok {
		d, err := time.ParseDuration(v)
		if err != nil || d < 100*time.Millisecond || d > 10*time.Second {
			return nil, errors.New("DATABASE_TIMEOUT must be between 100ms and 10s")
		}
		c.Timeout = d
	}
	if _, err := c.poolConfig(); err != nil {
		return nil, err
	}
	return c, nil
}

func (c Config) poolConfig() (*pgxpool.Config, error) {
	if c.MaxConns < 1 || c.MaxConns > 20 || c.Timeout < 100*time.Millisecond || c.Timeout > 10*time.Second {
		return nil, errors.New("invalid database pool bounds")
	}
	u, err := url.Parse(c.URL)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Hostname() == "" || u.User == nil || u.User.Username() == "" || u.Path == "" || u.Path == "/" {
		return nil, errors.New("DATABASE_URL must be a complete PostgreSQL URL")
	}
	// Allow only reviewed connection options. In particular, URL options must not
	// override the pool bounds or change the authenticated role/search path.
	q, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return nil, errors.New("invalid DATABASE_URL options")
	}
	for k, v := range q {
		if (k != "sslmode" && k != "sslrootcert") || len(v) != 1 {
			return nil, errors.New("unsupported DATABASE_URL option")
		}
	}
	mode := q.Get("sslmode")
	if mode != "verify-full" && mode != "disable" {
		return nil, errors.New("DATABASE_URL requires sslmode=verify-full (or disable for local Supabase)")
	}
	if mode == "verify-full" && q.Get("sslrootcert") == "" {
		return nil, errors.New("DATABASE_URL requires sslrootcert with sslmode=verify-full")
	}
	if mode == "disable" && u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost" && u.Hostname() != "::1" && u.Hostname() != "supabase_db_kami-split" {
		return nil, errors.New("unencrypted database connections are local-only")
	}
	cfg, err := pgxpool.ParseConfig(c.URL)
	if err != nil {
		return nil, errors.New("invalid DATABASE_URL")
	}
	cfg.MaxConns, cfg.MinConns, cfg.MinIdleConns = c.MaxConns, 0, 0
	cfg.ConnConfig.RuntimeParams = map[string]string{"application_name": "kami-api"}
	cfg.MaxConnLifetime, cfg.MaxConnIdleTime = 30*time.Minute, 5*time.Minute
	cfg.HealthCheckPeriod = 30 * time.Second
	cfg.ConnConfig.ConnectTimeout = c.Timeout
	return cfg, nil
}

// DB owns a bounded pool. Callers must release acquired connections before Close.
type DB struct {
	pool    *pgxpool.Pool
	timeout time.Duration
}

// Open creates a bounded pool and verifies the restricted runtime role within the
// configured timeout. On failure it closes the pool; on success the caller owns Close.
func Open(ctx context.Context, c Config) (*DB, error) {
	cfg, err := c.poolConfig()
	if err != nil {
		return nil, err
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, diagnostic.Wrap(errors.New("create database pool"), err, "database.open")
	}
	db := &DB{pool: pool, timeout: c.Timeout}
	probe, cancel := context.WithTimeout(ctx, c.Timeout)
	defer cancel()
	// SELECT 1 / Ping does not require pg_monitor or privileges on provider internals.
	// Refuse accidental administrative credentials, including inherited owner access.
	var safe bool
	err = pool.QueryRow(probe, `SELECT current_user = 'kami_api'
 AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
 AND NOT pg_has_role(current_user, 'kami_migrator', 'MEMBER')
 FROM pg_roles WHERE rolname = current_user`).Scan(&safe)
	if err != nil {
		pool.Close()
		return nil, diagnostic.Wrap(errors.New("database startup or runtime-role validation failed"), err, "database.startup")
	}
	if !safe {
		pool.Close()
		return nil, errors.New("database startup or runtime-role validation failed")
	}
	return db, nil
}

// Ready checks connectivity within the configured timeout and the caller deadline.
// It does not check migrations or grant administrative monitoring privileges.
func (d *DB) Ready(ctx context.Context) error {
	probe, cancel := context.WithTimeout(ctx, d.timeout)
	defer cancel()
	if err := d.pool.Ping(probe); err != nil {
		return diagnostic.Wrap(errors.New("database unavailable"), err, "database.ready")
	}
	return nil
}

// Close waits for acquired connections to be returned and releases the pool.
// Callers must finish database work before closing the shared dependency.
func (d *DB) Close() { d.pool.Close() }
