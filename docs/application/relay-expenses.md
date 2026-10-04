# Authenticated expense journey

Issue #83 connects `/groups` to the implemented GraphQL schema through pinned
Relay 21.0.1 tooling. After [onboarding](onboarding.md), choose **Open your groups
and expenses** from the account navigation. Select an admitted group to read a
bounded expense connection, create an expense, and see complete server balances.
The existing `ONBOARDING_ORIGIN`, `ONBOARDING_API_URL` and public Supabase
configuration also serve this journey through the same-origin GraphQL proxy.

## Data and presentation boundary

This route does not instantiate the preview `DataPort`, navigation command
providers or mock household snapshot. Its form consumes current authorized
membership IDs and eligibility, and its balance panel consumes `GroupBalances`.
A whole-household snapshot adapter would incorrectly treat one expense page as a
complete ledger and retain preview-only membership and trip assumptions.
[Activity workspaces](activity.md) also use authenticated network-only financial reads at `/groups/activity` and `/household/activity`, with fresh feed and node authorization on details. Remaining preview routes are explicitly labeled simulated and link to `/groups`;
they do not receive authenticated financial data. This slice does not implement
expense edit/delete, group creation, repayments, trips or dashboard integration.

Expenses use the approved forward connection with pages of 20 and signed cursors.
**Refresh group and restart list** resets the traversal after changes. Complete
balances include all financial history, including inactive members and actual
repayments, independently of loaded pages. Only the server's individual-net
settlement result is displayed. Loading, denied and failed reads hide previous
financial fields; failed page and balance projections have explicit unavailable
states rather than zero values. The simplified obligation list is within one
group and does not add original direct expense debts a second time.

Wire money stays in canonical decimal strings; validation and previews use
`bigint`. Formatting never converts aggregate cents to JavaScript numbers.
Equal remainders follow ascending canonical membership IDs; exact shares include
explicit zero. Description counts Unicode scalar values after ASCII trimming;
notes preserve whitespace. Dates allow valid future dates. Server validation and
current membership authorization remain authoritative.

## Sessions, drafts and recovery

The client-only financial session boundary lives above navigation. No SSR request
loads private data, and no server singleton holds sessions or Relay stores. Every
network request obtains the current access token from #80's Supabase client; no
refresh token is sent to Go. Token refresh does not retry financial operations.
Logout/account changes dispose the previous environment before storage cleanup,
cancel requests and replace private UI. Late results cannot enter a new store or
apply to another group visit. The same current-session logout and up-to-15-minute
existing access-token lifetime described in onboarding continue to apply.

Versioned tab `sessionStorage` retains drafts and unresolved attempts by actor
and explicit group. Navigation and same-tab reload preserve them; no timed expiry
is introduced. Logout/account changes clear them. Malformed/unavailable storage
blocks new submissions instead of silently replacing an unknown attempt.
The client persists the UUID key and frozen complete input before sending.
Double submission is suppressed. Uncertain transport results keep the original
attempt locked; **Recover original result** looks up that exact group/key and
**Retry original expense** submits that exact original payload. Missing lookup
never establishes noncommit. Access denial hides the original fields and blocks
retry until refreshed authorization. A definitive validation rejection permits
correction with a new key; mismatched intent remains locked for recovery.

Success identifies the immutable original expense, then requests freshly
authorized group data and complete balances separately. Navigation during a
pending action cannot redirect or update a later visit; retained unresolved
state is recovered on returning. A native unload prompt protects dirty/pending
work where the browser supports it. Closing the tab or signing out loses client
recovery context; server operation records remain for the lifetime of financial
history. Returning without the key/input requires inspecting current history,
not automatically recreating a similar expense.

## Generation and verification

`pnpm relay:generate` assembles the implemented `packages/schema/*.graphql` SDL
in ignored `.tools` and compiles checked-in TypeScript operation artifacts.
`pnpm relay:check` validates schema/operation generation drift without changing
artifacts and runs in required web CI. Scalar mappings are explicitly strings.
Application modules import compiled artifacts directly, so no runtime GraphQL tag
or additional Babel transform is required. Generated code is excluded from
handwritten formatting/lint rules and checked by the pinned compiler.

Run root format, lint, type checking, tests and build sequentially, plus the API,
database and container checks in the [testing strategy](../testing-strategy.md).
Independent tests cover scalar boundaries, exact previews, session replacement,
current tokens, stale responses and recovery. Component regressions cover
storage failures, duplicate suppression, frozen retries, denied access and
unmounted results. The PR records synthetic real-provider invitation, browser,
PostgreSQL persistence, commit-loss, pagination, keyboard/focus and responsive
verification with tested commit and explicit limitations.
