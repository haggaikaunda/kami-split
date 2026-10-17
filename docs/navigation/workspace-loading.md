# Authorized workspace navigation

Issue #193 keeps the sole root `FinancialSession` and its actor-scoped Relay
store across client navigation. `WorkspaceTabs` uses Next Link, real hrefs,
`aria-current`, native modified clicks, and `scroll={false}`. `useLinkStatus`
shows a reserved decorative route-pending cue without shifting labels; the
destination ContentLoading separately owns the single data-loading announcement.
See the [shared loading presentations](../application/ui.md#loading-presentations)
for anti-flash/slow timing, skeleton variants and caller responsibilities. Route prefetch only warms Next code/RSC payloads, not client-effect
Relay queries.

The signed-in Group navigation remains outside the financial destination reader.
Household's signed-in header/navigation live in a shared layout across Overview,
Expenses, Balances, Activity and Members. The [shared auth boundary](../application/web-auth-routing.md) verifies every page request before rendering and suppresses the entire shell during browser session resolution or logout; only `/sign-in` is public. Private Group names/member fields are
removed with the private reader on tab changes or invalidation; a generic public
Group/Trip banner preserves the header area while the read is pending. Before
removing the authorized header, its layout cleanup stores only measured heights
in the stable header host. This preserves enlarged/wrapped header geometry and
tab position through pending/error states, and releases the reservation when an
authorized header mounts again. Private
fields are never used as public loading placeholders. Tabs retain the committed route's current
state while Next is pending. A destination never displays the previous tab's
financial content.

## Request ownership and matrix

Eligible read-only workspace destinations use the account Relay store with
`store-or-network`. These counts describe a cold, incomplete, expired or invalidated
activation; a complete recent repeat of the same operation and variables needs no
financial request. Next code/RSC and session requests, later filters, details and
pages are separate:

| Destination        | Before #193                             | Current activation                   | Requested data                                                                                                                        |
| ------------------ | --------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Group Overview     | viewer discovery → broad group          | one workspace operation              | minimal viewer date, authorized group/header/members, complete expense-only financial summary, balances for metrics, four recent rows |
| Group Expenses     | viewer discovery → broad group → ledger | one workspace operation              | authorized group/member context, complete position, structured first page/months/totals                                               |
| Group Balances     | viewer discovery → broad group          | one workspace operation              | authorized group context, complete positions/obligations, five repayments                                                             |
| Group Members      | viewer discovery → broad group          | one workspace operation              | authorized identity/header and membership; no expense, repayment or balance fields                                                    |
| Group Activity     | viewer discovery → broad group → feed   | one workspace operation              | authorized identity/header plus dedicated feed; no expense page or balances                                                           |
| Household Overview | dashboard + recent rows                 | one operation                        | complete dashboard metrics plus four recent rows, without obligation detail                                                           |
| Household Balances | dashboard                               | one operation                        | complete source balances/obligations and dashboard totals                                                                             |
| Household Members  | broad dashboard → members               | minimal Household identity → members | authorized Household identifier, then actual membership; no financial fields                                                          |
| Household Activity | dashboard → feed                        | one feed operation                   | dedicated authorized feed                                                                                                             |
| Household Expenses | context → first page                    | one composed initial operation       | independent context and first-page fields, joined only after context-version validation                                               |

The schema's existing resolver implementations may still calculate fields beyond
those selected; this change reduces client payloads and request dependencies, not
all server computation. Household Members retains a genuine identifier dependency.
No partial page is used to calculate an aggregate. Overview reductions change
only recent rows; complete money still comes from server projections. Under #227,
Group/Trip and Household Overview request four recent expenses. Structured
Expenses operations request six rows initially and on each Load more; their
complete totals and signed cursor/anchor semantics remain unchanged. The signed-in
shell presents Household → Groups → Trips → Account through the shared desktop
app bar/rail and phone bottom navigation; its layout does not change private read
ownership. See the [persistent navigation contract](../application/relay-expenses.md#persistent-navigation-and-content-widths-238) and the historical [visual implementation note](https://github.com/haggaikaunda/kami-split/issues/227).

The composed Group operation supplies the initial ledger/feed reference directly
to the child reader; it does not start the same first page again after mounting.
A ledger accepts an initial reference only for its original filter identity.
Later filters and pages use their dedicated operations. Explicit group/account,
source-return, destination, filter and traversal boundaries reject late responses.
Panel-only parameters preserve the ledger traversal and original draft recovery.

## Household consistency

A GraphQL document with two root fields does not create one database transaction.
`expensesHouseholdInitialQuery` starts context and first-page work together, but
reveals neither until both succeed, the dashboard is `COMPLETE`, and both carry
an identical nonempty `contextVersion`. Mismatch or one-sided failure gives a
recoverable access error without rows, totals, member choices or fabricated zero.
Explicit refresh starts a new generation; there is no automatic retry loop.

The API computes each context version in that projection's final SQL statement
snapshot. It hashes the existing actor/designation/eligible-source binding plus
all authorized current group/member metadata, independently of page and filters.
It is a compatibility check, never an authorization grant or a financial revision.
Each request still authorizes normally; signed cursors retain their existing
financial anchors and scope/filter binding. Later Household ledger reads must
also match their owning context version or invalidate the whole context. A change
to a source outside the visible page is therefore detected. Financial writes do
not change this version; mutation success separately refreshes context and totals.

Deploy the additive API fields before deploying the web operations that request
them. There is no database migration or shared/private HTTP caching change.

## Navigation, disposal and freshness

Hovering or focusing a workspace tab does not start a financial GraphQL read.
Next Link may prefetch route code/RSC payloads; that prefetch does not authorize
private data. Tab navigation owns no speculative financial intent request.

Read-only Group/Trip tabs, Household summary/membership/access, the initial
Household expense traversal and first Activity pages may reuse complete Relay data
for **30 seconds from its server fetch**. Relay owns the only private store and its
native operation fetch timestamps; its release buffer retains at most 30 released
operations. Memory pressure/collection, missing fields, expiry or explicit store
invalidation can require another read sooner. Reuse does not extend the fetch time.
Expiry is checked when a destination consumes a query, not by a polling timer. An
already displayed screen does not discover remote revocation immediately at expiry.
Reload creates a new account store. No private data is persisted for offline use.

A cached display never grants authorization to read or mutate on the server. Every
actual API request independently enforces authentication and resource authorization.
Current details, edit/member baselines, repayment forms, discovery and all mutation
recovery reads retain their network-only safety contract. Continuation pages retain
their signed traversal and anchor; reuse never merges a new traversal into old pages
or derives authoritative totals from loaded rows.

Foreground focus, visibility and pageshow events invalidate all reusable operations;
private owners hide and coalesce their fresh read after the event burst. Manual
refresh also invalidates before reading. Mutation responses conservatively invalidate
the account store, including expenses, activity, balances and Household aggregates.
Pre-invalidation in-flight query responses are rejected before normalization. Mutation
success remains distinct from a failed subsequent refresh and is never optimistic.

HTTP 401/403/404, GraphQL authentication/access codes and typed domain access Problems
(including access-masked NOT_FOUND) dispose the entire financial account scope. This
conservative reset removes dependent aggregates and retained query records together,
aborts requests, hides protected UI and guards late responses. Reload rechecks access
in a new scope. Logout, account switch and session expiry likewise dispose the scope.
Recovery-query NOT_FOUND remains an operation outcome; transport failures, unavailable
projections and legitimate empty lists do not become access denial. There is no cached
fallback after denial. Retained references are released on owner unmount; normal
navigation cancellation does not dispose an otherwise valid account.

## Verification

The independent `workspace-lifecycle`, `household-lifecycle` and
`foreground` tests exercise actual Relay operations/network ownership and held
responses. Existing ledger/session/recovery tests preserve exact totals, drafts,
source restoration, denial and operation recovery. Real database context-version
tests cover empty pages, sources outside the first page, metadata/designation
changes, actor isolation, financial-write stability and incomplete/denied results.
Production-browser evidence and its synthetic-service limitations are recorded
with the delivery PR; jsdom and synthetic responses do not prove server authorization.

To repeat the production frontend profile, build with the pinned Node/pnpm versions,
start `ONBOARDING_PUBLIC_SUPABASE_URL=http://localhost:3196 ONBOARDING_PUBLIC_SUPABASE_KEY=synthetic-public pnpm --filter @kami-split/web exec next start -p 3193`, then run the committed
harness with an installed Playwright module and Chromium/Chrome executable:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROME_PATH=/absolute/path/to/chrome \
PORT=3193 FIXTURE_DELAY_MS=250 WIDTH=320 SCALE=2 \
OUTPUT_DIR=/tmp/kami-navigation-evidence \
TESTED_COMMIT="$(git rev-parse HEAD)" node scripts/navigation-browser.cjs
```

Repeat at 320, 390 and 1280 CSS pixels with `SCALE=1` and `SCALE=2`. The harness
sets reduced motion, seeds supported cookie sessions, starts a loopback Auth fixture on port 3196 for both the server and browser, and routes synthetic GraphQL fixtures in the browser;
no production credentials or financial data are used. It records requests,
feedback/content timing, exact shell retention and document loads, and asserts
keyboard detail closure/focus, URL filter/Back/Forward restoration, local filters,
native modified-click entry and denial after focusing a destination tab.

Set `LAYOUT_TESTS=1` for the #238/#267 layout regression matrix instead of the request
profile. It uses a long synthetic expense list and checks top/bottom edge anchoring
after wheel scrolling and unfocused viewport resizing, both scroll extremes,
compact working headers, desktop widths, short viewports, keyboard focus, date
filter bounds, account navigation and Back. Run at 320/390/1440 CSS pixels and
200% text; native iPhone keyboard and date-picker checks remain separate.

## Canonical workspace routes (#201)

Groups is the unified authorized directory with All / Groups / Trips selection,
excluding the designated Household. The existing Household and Trips shell entries
remain; `/trips` redirects to the directory's Trips selection. Canonical workspace
route families remain unchanged. The shared Household overview is `/household`; its original
ledger is `/household/ledger` with the same single Household frame/tabs. Expenses
and repayments there keep the original Household Group ID and operation/recovery
scope. Shared source navigation never creates an aggregate repayment target.

Trips use `/trips/<Group ID>` with expense-detail and repayment subroutes. Legacy
`/groups/<ID>` entries are replaced only after fresh server-authorized metadata
identifies their actual Household/Trip kind. Ordinary groups named Household are
not inferred as the Household. Source/tab/detail/repayment context is preserved;
access failure hides private data rather than guessing a redirect.

The exact compiled workspace query counts conditional selections towards gqlgen
complexity. The API uses a finite 200 budget and retains parser/body/auth limits.
Regression tests execute the checked-in Relay wire operation, not a simplified
GraphQL approximation, for Household and Trip roles across all tabs.

## Refresh and loading continuity (#243)

Under #269, routine in-app Refresh buttons are removed from financial workspaces
and invitations. Each network owner retains its custom pull gesture and live
progress, completion and failure feedback; embedded Expenses and Activity readers
do not register another gesture. Repeated pulls coalesce while that owner is pending.
Desktop and keyboard users can use the browser’s reload command (Cmd/Ctrl+R or
its native menu); this performs a fresh document load with actor-scoped draft recovery. Foreground events still invalidate
synchronously and coalesce their new read on an animation frame; a foreground
boundary cancels an older in-flight read rather than accepting pre-event access.

Chromium and Gecko browsers with CSS overscroll control use custom downward pulls
that begin at the document top. The gesture requires 80 CSS pixels, excludes
interactive controls, dialogs and nested scrollers, and cancels on horizontal,
upward, multitouch or canceled input. Progress, completion and retry feedback
remain visible without a refresh button. WebKit, including Safari and iOS
browser wrappers, retains its native gesture, as do browsers without overscroll
support. No custom gesture listener or overscroll override is installed there;
the browser’s reload command remains available. CSS feature support
alone is insufficient to establish suppression of Safari's native reload (see
[WebKit #275947](https://bugs.webkit.org/show_bug.cgi?id=275947)).

Private readers still disappear immediately at authorization boundaries. Only
public skeletons and previously measured layout height remain while new data is
pending; names, rows and totals are not retained as placeholders. Errors remain
distinct from empty lists or zero balances. Workspace/tab and expense filters are
URL-owned; Activity's event-type selection is also URL-owned (`activityKind`), so
revalidation and native reload retain the selection. Existing actor-scoped draft
and original-attempt recovery storage survives reader remounts. Account changes
continue to dispose the old scope and clear financial storage. Storage-write
failures remain explicit form errors; this change adds no background sync or new
financial persistence.

Run the browser refresh matrix with `REFRESH_TESTS=1` in the existing harness,
using the actual LAN `BROWSER_ORIGIN`, `FIXTURE_DELAY_MS=700`, widths 320/390/1440,
`SCALE=1`/`2`, and Light/Dark appearances. It exercises browser-dispatched touch
input, ordinary scrolling, native document reload, repeated gestures, URL continuity,
offline/retry, unsaved expense drafts and revoked reads. Its synthetic services
and desktop Chromium touch emulation do not prove physical iOS/Android native
browser gestures; record those device limits with delivery evidence.
