# Authenticated expense journey

Issue #83 connects `/groups` to the implemented GraphQL schema through pinned
Relay 21.0.1 tooling. After [onboarding](onboarding.md), choose **Open your groups
and expenses** from the account navigation. Groups lists active authorized memberships; Trips filters that same list by trip metadata
and server UTC date, with abstract covers and no partial-page totals. An accessible
designated Household has a shortcut; friends receive no inferred household role.
Canonical `/groups/:groupId` and `/groups/:groupId/expenses/:expenseId` routes
recheck access and expense ownership. Select an admitted group to read a
structured expense view, create an expense, and see complete server balances.
The existing `ONBOARDING_ORIGIN`, `ONBOARDING_API_URL` and public Supabase
configuration also serve this journey through the same-origin GraphQL proxy.

## Data and presentation boundary

This route does not instantiate the preview `DataPort`, navigation command
providers or mock household snapshot. Its form consumes current authorized
membership IDs and eligibility, and its balance panel consumes `GroupBalances`.
A whole-household snapshot adapter would incorrectly treat one expense page as a
complete ledger and retain preview-only membership and trip assumptions.
[Activity workspaces](activity.md) also use authenticated network-only financial reads at `/groups/:groupId/activity` and `/household/activity`, with fresh feed and node authorization on details. The legacy seeded routes and provider stack were removed in #184; `/` enters real `/groups` discovery and `/trips` lists independent authenticated Trip groups. This slice does not implement
expense edit/delete.
#171 adds shared Group/Trip workspace tabs, overview and balance details, members,
and persisted group-local repayment entry. #170 adds the shared
[production Expenses workspaces](expenses-ledger.md), including the complete
Household ledger; Activity consumes the authenticated feed from #172.
Trip dates affect status only; financial history remains complete and group-local.

Overview recent expenses use the original bounded connection; the Expenses tab
uses the [structured view](expenses-ledger.md), with pages of 20 and signed cursors.
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
into a complete server schema in ignored `.tools`, resolving `extend type` fields before compiling checked-in TypeScript operation artifacts. This prevents Relay from treating persisted server operations as client-only fields. Wire-operation tests validate every compiled request against the authoritative SDL.
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

## Discovery and return navigation (#105)

A normal card/expense activation captures an actor-session source visit with its
filter URL, scroll and logical focus. Modified clicks use canonical standalone
URLs. Back to source restores after a fresh authorized read; missing records focus
the heading. Unknown visits fall back to Groups. Session replacement clears these
private visits alongside financial drafts. Drafts continue to retain their original
group. UTC midnight and foregrounding refresh discovery and temporarily hide stale
fields; delayed responses cannot populate a different group/account visit.

Overview recent expenses and standalone records are bounded reads. The Expenses
ledger appends authorized structured pages within a visit while retaining complete
server aggregates; it does not merge data from separate source visits. Failed reads never establish an empty group or settled
balance. New ordinary/trip groups reuse the same expense form and complete balances,
without preview household trip pickers or repayment shortcuts.

## Group creation (#106)

Enabled designated creators can open `/groups/new` from Groups (ordinary by
default) or Create trip from Trips (trip by default). USD is read-only; trip
dates initially use the fresh server UTC date. Names use ASCII trimming and
Unicode scalar limits; destinations preserve whitespace. There is no member
picker or household inheritance: the server atomically creates a sole owner
and an empty group-local ledger.

Versioned tab storage binds the draft and frozen canonical creation input to the
stable Viewer ID, independently of the selected group. The client persists a
CSPRNG operation key before dispatch. Uncertain attempts survive navigation and
same-tab reload; Check creation and Retry original creation keep that original
key/input, including after NOT_STARTED. Conflicts remain frozen. Only definitive
domain rejection permits correction with a new key. Logout or account switch
clears creation context alongside financial drafts. Password-session logout also
continues when the invitation context is already absent or expired. Unreadable/lost storage
explains that an earlier group may exist and offers group inspection before an
explicitly acknowledged new creation; unavailable storage blocks dispatch.

A completed result triggers a separate network-only authorized Group read before
opening its canonical route. Read failure retains recovery and never asserts a
zero balance or empty ledger. Leaving or replacing the actor suppresses delayed
completion and navigation. Recovery denial hides the original fields and blocks
commands until access is refreshed. Invitation management remains a separate
onboarding operation rather than an implicit step in creation.

## Group/Trip workspace (#171)

The canonical group route defaults to Overview. The common Overview, Expenses,
Balances, Activity and Members navigation uses `tab` in the URL, preserving direct
entry and history. Ordinary groups use neutral contextual art; trips add travel
metadata/abstract illustration. Complete server totals and viewer positions drive
two horizontal overview metrics; a zero viewer position does not imply every
member is settled. Balance details identify each simplified obligation and offer
repayment entry only on an explicit eligible sender/recipient row. Summary cards
only disclose balance details. See [persisted repayments](persisted-repayments.md)
for actual-transfer validation, frozen recovery scope and browser integration.
Owner settings disclose current metadata; metadata editing remains unavailable.

## Household workspace

#112 connects `/household` to the complete authorized `householdDashboard` read.
Overview shows expense face-value total/count, exact signed viewer net/open-space
count, and eligible-space count in a horizontal row, followed by at most five
source-attributed expenses from `householdExpenses`. Balances uses the complete
server source set and never derives totals from the recent page. No Household
settlement action exists: each row opens its original group's Balances surface.
Zero aggregate with open sources stays open. Members separately reads the actual
Household `Group.members`, including more than two members and historical profiles;
only owners see existing invitation management. Activity reuses #172. #170 adds
the shared [Expenses ledger](expenses-ledger.md) at `/household/expenses`; the
Expenses tab opens it and legacy `?tab=expenses` links preserve their filters on
redirect. Its navigation destination is distinct from Overview.

Account changes, foreground revalidation, refresh and route changes remove prior
private data before network-only reads. Failed/incomplete reads never fabricate
zeros. Unavailable designation exposes only the server-authorized ledger fallback
without a partner identity or suspension reason. Source return and browser Back
restore focus/scroll after fresh authorization; a missing row uses the heading.
