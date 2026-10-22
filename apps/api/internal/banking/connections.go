package banking

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"

	"github.com/google/uuid"
	"github.com/haggaikaunda/kami-split/apps/api/internal/auth"
	"github.com/jackc/pgx/v5"
)

// ConnectionPage contains one bounded owner-private inventory snapshot. Cursors
// identify an ordering position only; every continuation rechecks current access.
type ConnectionPage struct {
	Connections []ConnectionStatus
	EndCursor   *string
	HasNextPage bool
}

// ReadConnections discovers active and stopped connections without prior browser
// identity or provider I/O. It reuses the status-by-ID projection, hides deleted
// history and returns no partial data when any read fails. first must be 1..50.
func (s *Service) ReadConnections(ctx context.Context, first int, after *string) (ConnectionPage, Result) {
	page := ConnectionPage{Connections: []ConnectionStatus{}}
	position, valid := connectionPosition(after)
	if first < 1 || first > 50 || !valid {
		return page, Result{Code: "INVALID_INPUT"}
	}
	err := auth.WithActor(ctx, s.db, func(tx pgx.Tx, _ auth.Actor) error {
		if _, err := tx.Exec(ctx, `SELECT app.lock_banking_owner()`); err != nil {
			return err
		}
		// Parameters: exclusive UUID position (nil starts), bounded limit + 1.
		// RLS selects the enabled owner's visible connections. A single statement
		// projects the same coherent status facts as a known-ID read.
		rows, err := tx.Query(ctx, `SELECT app.banking_connection_status(c.id)
            FROM (SELECT id FROM app.banking_connections
                  WHERE ($1::uuid IS NULL OR id > $1::uuid)
                  ORDER BY id LIMIT $2) c ORDER BY c.id`, position, first+1)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var raw []byte
			if err := rows.Scan(&raw); err != nil {
				return err
			}
			var snapshot ConnectionStatus
			if err := json.Unmarshal(raw, &snapshot); err != nil {
				return err
			}
			if len(page.Connections) == first {
				page.HasNextPage = true
				continue
			}
			for i := range snapshot.Accounts {
				deriveImportStatus(snapshot, &snapshot.Accounts[i])
			}
			page.Connections = append(page.Connections, snapshot)
		}
		return rows.Err()
	})
	if err != nil {
		return ConnectionPage{Connections: []ConnectionStatus{}}, failure(ctx, err)
	}
	if len(page.Connections) > 0 {
		cursor := base64.RawURLEncoding.EncodeToString([]byte("banking-connections-v1/" + page.Connections[len(page.Connections)-1].ID))
		page.EndCursor = &cursor
	}
	return page, Result{Code: "READY"}
}

func connectionPosition(after *string) (*uuid.UUID, bool) {
	if after == nil {
		return nil, true
	}
	if len(*after) > 128 {
		return nil, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(*after)
	if err != nil || !strings.HasPrefix(string(raw), "banking-connections-v1/") {
		return nil, false
	}
	id, err := uuid.Parse(strings.TrimPrefix(string(raw), "banking-connections-v1/"))
	if err != nil || id == uuid.Nil || string(raw) != "banking-connections-v1/"+id.String() {
		return nil, false
	}
	return &id, true
}
