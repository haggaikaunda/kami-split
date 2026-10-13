# Production Expenses workspaces

The Household ledger at `/household/expenses`, ordinary Group Expenses at
`/groups/{groupId}?tab=expenses` and Trip Expenses at
`/trips/{groupId}?tab=expenses` use structured expense views. All render the same `ExpenseLedger`; the authenticated Household Overview/Balances/Members tabs remain at `/household`
and the retired preview financial routes return not-found responses.

Household initial context and first-page work run in one composed operation. The independent results require `COMPLETE` eligibility and matching nonempty server `contextVersion` values before any private content is revealed. Later pages/filters must match that owning context or fail closed. See [workspace loading](../navigation/workspace-loading.md).
Only its spaces and retained same-group memberships appear in filter and create
choices. Group views have fixed source scope. Household spending and space count
come from complete server projections; the signed viewer position is informational
and never a cross-group repayment target. Balance metrics are explicitly
unfiltered. A zero viewer position does not assert that every member is settled.

Structured space (Household only), categories, Paid by, Involving and inclusive date filters
are edited in a combined filter dialog on desktop and phone, live in the URL and are sent to `householdExpenses`/`groupExpenses`. Involving membership IDs
are scoped to the original group, matching payer **or** explicit participant,
including zero shares. No search control or client filtering is provided. A
filter change starts a new traversal. Initial requests and subsequent pages request six
rows; approaching the list end automatically appends the next ordered server page,
with a manual Load more fallback;
headline count/total and month subtotals always use server aggregates rather
than sums of loaded rows. Under #239, each displayed month header immediately
shows its complete filtered total and count. Desktop records align description,
category/source/date, payer and right-aligned amounts. Under #269, ordinary
320/390/440px phone rows show the payer beneath description/source/date on the
left, with amount and Your share alongside on the right. Category identity remains
accessible through the icon; redundant category text is hidden in compact rows.
Enlarged text can use a readable stacked fallback. Complete counts sit directly
beneath month/year, with only the monthly amount on the right. Long labels wrap without truncating the accessible link.
Money formatting uses canonical strings and `bigint`.

An expense selection adds `expense` and `expenseGroup` to the originating URL.
The native dialog is a contextual desktop panel and full-screen phone detail.
The list retains its query and session-owned row/position metadata across detail
Back/Forward and edit-triggered parent remounts. Returning rebuilds the previously
loaded extent from freshly authorized pages and restores trigger focus and viewport
offset. If a row moved outside that extent or disappeared, the nearest surviving
row by prior ordinal is used; direct URLs fall back to the list summary. Every detail first rechecks source eligibility, then reads the stable
expense node and verifies both expense and group identity. Refresh/foreground
invalidates prior rows and detail before reauthorization; failed, stale, denied
and unavailable reads never manufacture empty success or settled data. Account
replacement disposes the entire financial scope and cancels pending requests.

**Add expense** in the persistent workspace banner opens the existing persisted `ExpenseForm` in a centered desktop
dialog or an inset phone dialog, including original-key recovery, draft storage
and duplicate suppression. The same form remains mounted across responsive
changes. Detail and in-place editing retain the desktop panel/full-screen phone
presentation. Household selects an original
authorized source; success returns to the originating URL and refreshes spending
and context. No receipt, category expansion, edit/delete or repayment command is
added here. Free-text search remains deferred to #177.

Verification: `ledger.independent.test.tsx` covers exact large totals, complete
month subtotals, paging, zero shares, filter/history traversal, refresh races,
disposed accounts, stale details, denied direct sources and mismatched nodes.
The delivery PR records actual Chrome layout/navigation tests at 320/390/768/1280px
and 100%/200% root text. Synthetic browser service responses demonstrate browser
behavior; server authorization remains covered by #169 and real database checks.

The filter dialog uses a single column with expandable Categories, Paid by, Involving and Dates sections. Collapsed sections summarize the current draft; member options are grouped under their source-space name. Only the body scrolls, keeping the close control and Reset/Apply footer reachable. Closing or pressing Escape discards unapplied edits; Reset clears the draft, including the date preset and sort.

Presentation follows the [current UI guide](ui.md). Category identity and structured filter behavior remain: Reset changes the draft; Apply updates the URL. Search, saved filters and unsupported status controls remain absent.

The prior [screen adoption evidence](https://github.com/haggaikaunda/kami-split/issues/189) records
contract-preserving changes to expense detail and creation: category identity, exact total,
payer and allocation rows, retained note/audit fields, and the existing explicit
payer/split/participant controls. The boards do not remove required contract fields.

## Edited expenses (#212)

Anchored traversals select one immutable expense revision and its matching
allocations at each source anchor before filtering or computing month totals.
A date/category/payer/participant correction appears on a fresh traversal;
continuing an existing traversal retains its original coherent rows and totals.
Current detail and complete balances use the current projection. Household detail
edits always target the original source expense and recheck its membership; no
aggregate writes or duplicated expenses are introduced. See
[expense editing](expense-editing.md).

## Category breakdown and viewer spending (#223)

Expenses has URL-backed List and Breakdown views using the same active structured
filters and traversal. Category aggregates, counts, viewer allocations and viewer
payer totals describe every authorized matching expense at the traversal anchor,
independently of loaded pages. Repayments are excluded. The category legend gives
exact amounts and matching-expense counts even where viewer allocation is zero;
percentages are rounded to one decimal place and may not sum to exactly 100%.
Chart geometry converts only bounded integer ratios to numbers. Selecting a
category and View expenses retains the other filters. A fresh traversal after an
edit refreshes category/share aggregates along with list/month totals.

Run `LEDGER_TESTS=1` with `scripts/navigation-browser.cjs` (using the browser
configuration in [workspace loading](../navigation/workspace-loading.md)) for
the #239 regression at 320/390/1440px and 100%/200% text. It exercises long
labels, complete month totals beyond the first six rows, multiple months, aligned
amounts and keyboard detail/focus restoration in Group and Household workspaces.

## Combined filters and ordering (#242)

Categories, Paid by and Involving accept multiple selections, combined with OR
within each field and AND across fields. Involving matches the payer or a saved
participant, including a zero share; Paid by only matches the payer. Membership
choices retain their source-space names. The URL uses repeated `categories`,
`paidByIds` and `memberIds` keys; legacy `category` and `memberId` links join the
respective selection. Every chip removes only its own value. Clear all restores
the default newest-first view. Breakdown category actions add to existing
category selections and preserve the other fields.

Date presets use the server calendar date and produce visible inclusive From/To
bounds: Today, Last 7 days (today plus six preceding dates), This month to date,
and Previous month. Custom dates use the same inclusive calendar contract.
Ordering offers date newest/oldest and amount highest/lowest over the complete
matching set. Date views retain month sections in server order; amount views
render the server order as one list, with visible authoritative monthly totals
above it. Neither ordering nor totals are computed from loaded rows. Any change
to a selected value or order resets the full traversal and ignores old results.

## Scroll loading and authorized restoration (#244)

An intersection observer requests a page within 240 pixels of the list end.
A synchronous in-flight guard absorbs repeated callbacks and manual activations;
one automatic page is allowed per scroll gesture, so a sentinel that stays visible
cannot drain the traversal. Load more remains keyboard accessible, including a
stable inactive button at exhaustion so insertion does not discard its focus.
Loading, retryable transport failure, and all-results-loaded messages are distinct.
Transport failures preserve the already authorized rows and require an explicit
retry; authentication/session failures and domain denials hide private content.
Duplicate IDs are coalesced, and nonprogressing or malformed cursors require a
fresh traversal rather than a retry loop. Complete query aggregates remain server-owned.

Detail return restarts the anchored query so edits, sort movement and loss of access
cannot leave an old selected row in the visible list. Replay is bounded by the
previous loaded page count, stops on failure/exhaustion, and never scans indefinitely
for a moved record. Only row identity, ordinal, loaded count and geometry live in
the financial session; no private row payload is cached for restoration. Scope,
URL filters and ordering identify each visit. A completed return retains its anchor
for a later browser Forward entry that remounts the ledger; each return still
replays freshly authorized pages. Account disposal clears this metadata,
and explicit Refresh discards it and all incompatible cursors. Restoring reserves
the prior list height while reauthorization is pending and focuses only after the
fresh extent is available; ordinary page insertion does not move focus.

`ledger-pagination.independent.test.tsx` exercises observer/retry races, stale query
and account responses, remount replay, moved/removed rows and focus. The opt-in
`LEDGER_TESTS=1` browser harness additionally checks automatic loading, transport
retry and late-row Back/Forward scroll/focus at desktop/mobile widths and doubled
text. Its synthetic Auth/GraphQL responses establish browser behavior, not server
authorization; the unchanged server authorization/database suites own that boundary.

## Shared workspace shell (#269)

The identity banner and its existing background art remain above the tabs on every
workspace tab. Add expense appears only in that banner, retaining the original
source creation form and source selection. Expenses has List/Breakdown and Filters
on one toolbar row at ordinary phone widths; its balance disclosure is removed.
Balance and share explanations live behind labeled rich help on summary surfaces,
and the Household scope explanation appears once in its banner. By group or trip
and optional balance explanations retain access to source balances and member detail.
Spending by category and Overview Recent expenses are unchanged. Routine Refresh
controls are removed while pull gestures, foreground reauthorization and browser
reload remain available; see [refresh continuity](../navigation/workspace-loading.md#refresh-and-loading-continuity-243).
