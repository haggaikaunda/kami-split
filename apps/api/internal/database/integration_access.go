//go:build integration

package database

import "github.com/jackc/pgx/v5/pgxpool"

// IntegrationPool exposes the runtime connection only in integration builds for
// permission probes and fault injection. Production builds have no raw-pool API.
func IntegrationPool(db *DB) *pgxpool.Pool { return db.pool }
