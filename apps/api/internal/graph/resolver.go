package graph

import (
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
)

// Resolver maps the approved transport to application operations. Cursor keys
// are deployment-managed and survive application restarts.
type Resolver struct {
	Expenses *expense.Service
	Cursors  *ledger.CursorCodec
}
