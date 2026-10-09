# Authorized workspace navigation

Issue #193 keeps the sole root `FinancialSession` and its actor-scoped Relay
store across client navigation. `WorkspaceTabs` uses Next Link, real hrefs,
`aria-current`, native modified clicks, and `scroll={false}`. `useLinkStatus`
shows route-pending feedback; client query skeletons separately describe data
loading. Route prefetch only warms Next code/RSC payloads, not client-effect
Relay queries.

The public Group navigation remains outside the private destination boundary.
Household's public header/navigation live in a shared layout across Overview,
Expenses, Balances, Activity and Members. Private Group names/member fields are
removed with the private reader on tab changes or invalidation; they are never
used as public loading placeholders. Tabs retain the committed route's current
state while Next is pending. A destination never displays the previous tab's
financial content.

## Request ownership and matrix

All visible private data comes from `network-only` reads. These counts describe
cold/ordinary activation **without intent warming**, excluding Next code/RSC
prefetch and later filters, details or pages:

| Destination        | Before #193                             | Current activation                   | Requested data                                                                                        |
| ------------------ | --------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Group Overview     | viewer discovery → broad group          | one workspace operation              | minimal viewer date, authorized group/header/members, complete balances for metrics, four recent rows |
| Group Expenses     | viewer discovery → broad group → ledger | one workspace operation              | authorized group/member context, complete position, structured first page/months/totals               |
| Group Balances     | viewer discovery → broad group          | one workspace operation              | authorized group context, complete positions/obligations, five repayments                             |
| Group Members      | viewer discovery → broad group          | one workspace operation              | authorized identity/header and membership; no expense, repayment or balance fields                    |
| Group Activity     | viewer discovery → broad group → feed   | one workspace operation              | authorized identity/header plus dedicated feed; no expense page or balances                           |
| Household Overview | dashboard + recent rows                 | one operation                        | complete dashboard metrics plus four recent rows, without obligation detail                           |
| Household Balances | dashboard                               | one operation                        | complete source balances/obligations and dashboard totals                                             |
| Household Members  | broad dashboard → members               | minimal Household identity → members | authorized Household identifier, then actual membership; no financial fields                          |
| Household Activity | dashboard → feed                        | one feed operation                   | dedicated authorized feed                                                                             |
| Household Expenses | context → first page                    | one composed initial operation       | independent context and first-page fields, joined only after context-version validation               |

The schema's existing resolver implementations may still calculate fields beyond
those selected; this change reduces client payloads and request dependencies, not
all server computation. Household Members retains a genuine identifier dependency.
No partial page is used to calculate an aggregate. Overview reductions change
only recent rows; complete money still comes from server projections. Under #227,
Group/Trip and Household Overview request four recent expenses. Structured
Expenses operations request six rows initially and on each Load more; their
complete totals and signed cursor/anchor semantics remain unchanged. The public
shell presents Household → Groups → Trips → Account through the shared desktop
app bar/rail and phone bottom navigation; its layout does not change private read
ownership. See the [current visual implementation note](../design/issue-227-implementation.md).

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

## Intent, disposal and freshness

Pointer intent (excluding touch) and keyboard focus warm **at most one** destination
per mounted workspace and account. Repeated focus/hover for that candidate share
one subscription. Moving to another candidate cancels the first; blur/leave only
cancel their own candidate, not a more recent hover. This is not an eager fetch of
all tabs or expenses, and no query reference is retained for rendering.

A completed or in-flight intent result cannot prove authorization at activation.
Navigation cancels intent and performs a fresh network-only visit read. Thus
pointer/focus navigation can add one speculative request to the matrix; touch or
no-intent activation uses only the visit read. This deliberate trade-off preserves
revocation safety instead of treating a TTL or matching Auth identity as permission.
No private result transfers between environments and no second store/provider exists.
Route commits (including Back/Forward), foreground events, superseded candidates,
unmount and account disposal release intent work. Relay network subscriptions own
AbortControllers; cancellation before session lookup completes suppresses transport,
and cancellation/disposal prevents late normalization.

The parent Group or Household context owns foreground invalidation for embedded
ledgers/feeds. Every focus/visibility/pageshow event synchronously clears private
content and cancels obsolete work; reads start once after the event burst on an
animation frame. Standalone Activity owns the same lifecycle. No pre-event read
is reused as authorization. Manual refresh and successful financial mutations
invalidate the owning context; financial success is never reported optimistically.

## Verification

The independent `intent`, `workspace-lifecycle`, `household-lifecycle` and
`foreground` tests exercise actual Relay operations/network ownership and held
responses. Existing ledger/session/recovery tests preserve exact totals, drafts,
source restoration, denial and operation recovery. Real database context-version
tests cover empty pages, sources outside the first page, metadata/designation
changes, actor isolation, financial-write stability and incomplete/denied results.
Production-browser evidence and its synthetic-service limitations are recorded
with the delivery PR; jsdom and synthetic responses do not prove server authorization.

To repeat the production frontend profile, build with the pinned Node/pnpm versions,
start `pnpm --filter @kami-split/web exec next start -p 3193`, then run the committed
harness with an installed Playwright module and Chromium/Chrome executable:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROME_PATH=/absolute/path/to/chrome \
PORT=3193 FIXTURE_DELAY_MS=250 WIDTH=320 SCALE=2 \
OUTPUT_DIR=/tmp/kami-navigation-evidence \
TESTED_COMMIT="$(git rev-parse HEAD)" node scripts/navigation-browser.cjs
```

Repeat at 320, 390 and 1280 CSS pixels with `SCALE=1` and `SCALE=2`. The harness
sets reduced motion and routes synthetic Auth/GraphQL fixtures in the browser;
no production credentials or financial data are used. It records requests,
feedback/content timing, exact shell retention and document loads, and asserts
keyboard detail closure/focus, URL filter/Back/Forward restoration, local filters,
native modified-click entry and denial after completed intent warming.

## Canonical workspace routes (#201)

Groups lists ordinary groups only. Household and Trips each use their own primary
navigation. The shared Household overview remains `/household`; its original
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
