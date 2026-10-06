package graph

import (
	"github.com/haggaikaunda/kami-split/apps/api/internal/expense"
	"github.com/haggaikaunda/kami-split/apps/api/internal/group"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/haggaikaunda/kami-split/apps/api/internal/onboarding"
	"github.com/haggaikaunda/kami-split/apps/api/internal/profile"
)

// Resolver maps the approved transport to application operations. Cursor keys
// are deployment-managed and survive application restarts.
type Resolver struct {
	Profiles    *profile.Service
	Expenses    *expense.Service
	Groups      *group.Service
	Cursors     *ledger.CursorCodec
	Invitations *onboarding.Factory
}
