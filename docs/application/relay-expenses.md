# Authenticated expense journey

Issue #83 connects `/groups` to the implemented GraphQL schema through pinned
Relay 21.0.1 tooling. After [onboarding](onboarding.md), choose **Open your groups
and expenses** from the account navigation. Groups lists ordinary authorized groups; Household and Trips have dedicated entries. Trips filters authorized Trip groups by metadata
and server UTC date, with local decorative scenic covers and no partial-page totals. The shared navigation links to Household aggregation without inferring eligibility.
Discovery cards open only the groups returned for the current authorized actor.
Canonical ordinary-group `/groups/:groupId`, Trip `/trips/:groupId`, and original Household `/household/ledger` routes
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
[Activity workspaces](activity.md) also use authenticated network-only financial reads at workspace `?tab=activity` routes for `/groups/:groupId`, `/trips/:groupId`, `/household/ledger`, and aggregated `/household/activity`, with fresh feed and node authorization on details. The legacy seeded routes and provider stack were removed in #184; `/` enters real `/groups` discovery after server-verified authentication (signed-out requests go to `/sign-in`) and `/trips` lists independent authenticated Trip groups. Collaborative expense editing is implemented under #212; deletion remains deferred.
#171 adds shared Group/Trip workspace tabs, overview and balance details, members,
and persisted group-local repayment entry. #170 adds the shared
[production Expenses workspaces](expenses-ledger.md), including the complete
Household ledger; Activity consumes the authenticated feed from #172.
Trip dates affect status only; financial history remains complete and group-local.

Current system typography, Light/System/Dark, persistent navigation, workspace banners and compact expense rows follow the [shared UI guide](ui.md). Source-scoped financial behavior remains unchanged; historical visual acceptance belongs on the owning GitHub PR.

Overview recent expenses request at most four rows from the bounded connection.
The Expenses tab uses the [structured view](expenses-ledger.md), requesting an
initial six rows and six-row scroll-triggered pages with signed cursors and a
manual Load more fallback. These display
bounds do not limit complete server totals, counts, category aggregates or balances.
Fresh authorization after mutations, pull or foreground refresh resets the traversal. Complete
balances include all financial history, including inactive members and actual
repayments, independently of loaded pages. Only the server's individual-net
settlement result is displayed. Initial loading, denied reads and failed balance projections hide previous
financial fields rather than establish zero values. A retryable transport failure
on a later expense page retains the already authorized rows and complete anchored
totals, with an explicit retry; authentication/session errors hide the list. The simplified obligation list is within one
group and does not add original direct expense debts a second time.

Wire money stays in canonical decimal strings; validation and previews use
`bigint`. Formatting never converts aggregate cents to JavaScript numbers.
Equal remainders follow ascending canonical membership IDs; exact shares include
explicit zero. [Percentage splits](percentage-splits.md) retain normalized intended
percentages and resolve cents by largest remainder with canonical-ID tie breaks. Description counts Unicode scalar values after ASCII trimming;
notes preserve whitespace. Dates allow valid future dates. New expenses default to the device-local calendar day at form opening, preserving chosen and recovered dates; [date presentation](dates.md) distinguishes calendar values from UTC-labelled recorded instants. Server validation and
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
Authored documents live beside their owning components/features; the compiler scans
`apps/web/src` and writes `src/lib/relay/__generated__`. See the [frontend guide](frontend.md)
for ownership and interaction boundaries. Application modules import compiled artifacts directly, so no runtime GraphQL tag
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
three tonal overview metrics (total, viewer net, and complete viewer share); a zero viewer position does not imply every
member is settled. Balance details identify each simplified obligation and offer
repayment entry only on an explicit eligible sender/recipient row. Summary cards
only disclose balance details. See [persisted repayments](persisted-repayments.md)
for actual-transfer validation, frozen recovery scope and browser integration.
Owner settings disclose current metadata; metadata editing remains unavailable.

## Household workspace

#112 connects `/household` to the complete authorized `householdDashboard` read.
Overview shows expense face-value total/count, exact signed viewer net/open-space
count, and complete viewer share with expense-payer amount in a tonal row, followed by at most four
source-attributed expenses from `householdExpenses`. Balances uses the complete
server source set and never derives totals from the recent page. No Household
settlement action exists: each row opens its original group's Balances surface.
Zero aggregate with open sources stays open. Members first reads minimal Household identity, then the actual
Household `Group.members`, including more than two members and historical profiles;
only owners see existing invitation management. Activity reuses #172. #170 adds
the shared [Expenses ledger](expenses-ledger.md) at `/household/expenses`; the
Expenses tab opens it and legacy `?tab=expenses` links preserve their filters on
redirect. Its navigation destination is distinct from Overview.

Account changes, foreground revalidation, refresh and route changes remove prior
private data before network-only reads. Failed/incomplete reads never fabricate
zeros. Membership-based Household discovery uses the [ADR-010 common-member scope](decisions/010-household-membership-sharing.md). Legacy unavailable service states expose only the server-authorized ledger fallback
without a partner identity or suspension reason. Source return and browser Back
restore focus/scroll after fresh authorization; a missing row uses the heading.

## Navigation and read ownership (#193)

The [workspace loading contract](../navigation/workspace-loading.md) documents destination-sized operations, the persistent signed-in Household/Group navigation, separately owned private visits, bounded intent warming, cancellation and fresh activation reads. Household Expenses composes its initial context and ledger reads and validates server context versions before revealing either; GraphQL composition does not imply a transaction.

## Household and Trip navigation

Household is absent from Groups discovery and its original ledger/details/forms
use `/household/ledger` within the dedicated Household frame. Trips are absent
from Groups and use `/trips/<Group ID>` plus original expense/repayment subroutes.
Legacy group paths canonicalize after authorized metadata resolution. All reads,
writes and recoveries retain the original group IDs and server authorization.
See [workspace loading](../navigation/workspace-loading.md) for route and exact
wire-query verification.

## Collaborative corrections (#212)

Eligible expense details open the shared expense fields in an edit flow. The
server's expense version and saved-involvement eligibility are authoritative;
original source context is preserved from Group, Trip and Household ledgers.
Edit drafts and frozen attempts are isolated from creation drafts by
actor/group/expense/operation, survive same-tab reload, and are cleared with
financial session ownership changes. Conflict review never silently overwrites
the draft. Current detail, ledgers and balances refresh after a committed edit;
failed refresh is separate from failed mutation. See the
[editing contract](expense-editing.md) and [historical Activity](activity.md).

## Mobile typography and expense sheets (#237)

The current interface uses system fonts, rem-based text, a 17 CSS-pixel mobile
body baseline and secondary text of at least 14 CSS pixels in financial workspaces.
This supersedes the #227 Roboto typography baseline; historical reference evidence
is unchanged. Editable login and expense controls use at least 16 CSS pixels,
without limiting pinch zoom or text enlargement.

Expense sheets retain their title/close controls while the body scrolls. Actions
stay at the bottom of the form scroll area when space permits; at short heights
they join the scroll flow so enlarged actions cannot obscure the fields. The visual viewport follows keyboard
resizing at normal scale; pinch zoom remains browser-owned. Opening a sheet or
switching to editing focuses a heading, while validation deliberately focuses an
invalid field. Empty optional notes can be expanded; saved/recovered note text and
note errors stay exposed. Draft, original-attempt and dismissal contracts are unchanged.

Desktop/mobile browser emulation is layout evidence only. Actual iPhone Safari or
an iOS simulator must separately verify focus zoom and the software keyboard.

## Persistent navigation and content widths (#238)

Global navigation keeps the app header and desktop rail or mobile bottom bar
available while the document scrolls. The shared navigation measures its rendered
height so wrapped/enlarged labels and safe-area padding reserve real content space.
Under #267, the global brand bar is in normal document flow with `position:
sticky; top: 0`; its navigation wrapper uses `display: contents` so the full-height
page shell supplies the sticky boundary. The shell reserves only the gap after
the header, not a second header height. The mobile navigation is fixed with
`top: auto; bottom: 0`, including safe-area padding. The desktop rail remains
fixed below the measured header and can scroll at short desktop heights.

ResizeObserver measures header and navigation heights for content clearance and
document scroll padding. Global navigation does not read visualViewport or set
viewport-derived offsets, even during keyboard focus, toolbar changes or pinch
zoom. The document remains the scroll owner for source-return restoration;
workspace banners and tabs continue scrolling normally. Expense sheets retain
their own focused-form keyboard accommodation. Browser-owned zoom and rubber
banding are not suppressed.

Physical iPhone verification of toolbar expansion/collapse, overscroll return,
keyboard panning/dismissal and portrait/landscape safe areas remains required
for #267 in Safari and the affected in-app browser, with device, OS, mode and
revision recorded on the delivery PR. Desktop browser fixtures do not establish
those device behaviors.

The content wrapper owns container queries and centers lists/tables within a
72rem maximum width; Account uses 46rem and existing form cards use 42rem.
Under #269 below, every tab retains the illustrated workspace banner and its Add expense action. Filter dates use the same bounded native
date styling as expense forms, and the filter grid stacks when enlarged text or
a narrow dialog leaves insufficient width. These changes supersede the scrolling
chrome and working-tab banner layout in the historical #227 visual evidence.

## Balance explanations and Household scope (#241)

Household overview and balance summaries identify their aggregation of the
Household source ledger and currently eligible Groups/Trips shared by every active
Household member. Source links distinguish the Household ledger, Group and Trip.
A zero aggregate may offset debts across spaces; a zero balance in every eligible
space describes only the viewer and does not establish every member is settled.
Incomplete aggregate reads hide source balance rows; failed source projections
show unavailable rather than a zero or settlement claim.

Source balance details explain the authoritative calculation: paid for expenses
minus allocated share plus repayments sent minus repayments received. Each member
has exact server amounts and a displayed equation; examples cover a payer receiving
a repayment and a participant sending one. Positive means owed and negative means
owing. “Who owes whom” lists suggested repayments within that source, without
counting original expenses again. Activity and its expense before/after history
remain linked. Under #269, optional explanations appear on summary and Balances surfaces; Expenses no longer has a Balance details disclosure.

## Workspace summaries and banner (#269)

All workspace tabs retain their identity banner and existing background image, with
a single labeled Add expense action targeting an authorized original source.
Household uses “Shared spending, at home and away.” and optional What’s included
help; balance/share definitions are optional rich help with explicit dismissal.
Your balance shows “Payments still to settle” for offsetting nonzero source balances
and “Nothing to pay or collect” only for personal zero in every included source.
Incomplete/unavailable reads remain errors. Detailed member contributions, repayment
suggestions and Activity history remain accessible; explanations and worked examples
are disclosures on Balances. Routine Refresh controls are removed across screens;
existing pull/foreground boundaries and native browser reload remain. The Expenses
list is compact at ordinary phone widths; Spending by category and Recent expenses
retain their existing content and presentation.

[The #269 verification report](https://github.com/haggaikaunda/kami-split/issues/269) records the
LAN browser matrix, exact baseline preservation comparison, screenshots and
physical-device/server limitations.
