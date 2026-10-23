# GraphQL contract

`schema.graphql`, `expenses.graphql`, `repayments.graphql`, `groups.graphql`, `group-directory.graphql`, `household.graphql`, `financial-activity.graphql`, `structured-expenses.graphql`, `onboarding.graphql` and `profile.graphql` are the authoritative SDL for the Go + gqlgen backend. They expose authenticated self-profile editing, [targeted onboarding](../../docs/application/onboarding.md), public health, authorized group/member reads, expenses and complete balances, actual group repayments and history, ordinary/trip group creation, financial activity, and structured cross-space spending reads. Financial and group-creation operations support same-attempt recovery. See [persisted expenses](../../docs/application/persisted-expenses.md) and [persisted repayments](../../docs/application/persisted-repayments.md) for money, access, recovery and pagination semantics.

Run `make api-generate` from root to regenerate committed API execution/model code using the pinned gqlgen tool. CI rejects generation drift. Pinned Relay tooling consumes the same authoritative SDL through `pnpm relay:generate`; `pnpm relay:check` verifies committed web artifact drift. The generator resolves server SDL extensions into a complete schema before compilation, so Relay emits executable server operations rather than client-only extension fields. Wire-operation tests validate compiled requests against the authoritative SDL.

Web operation documents are authored beside their owning feature under
`apps/web/src/components`; generated artifacts remain in
`apps/web/src/lib/relay/__generated__`. The compiler discovers all `apps/web/src`
documents, including normalization fixtures, and application code imports only the
compiled artifacts. See [frontend ownership](../../docs/application/frontend.md).

Schema additions require approved acceptance criteria and compatibility review. Existing TypeScript exact-money presentation and draft validation remain in `apps/web`; Go application operations own persisted financial rules. Language-neutral test fixtures may be shared when implemented.

## Reporting timezone

`reporting-timezone.graphql` defines the self-only saved preference, independent
positive string version and actor/operation/attempt-bound initialization/update
recovery. See [the operation contract](../../docs/application/reporting-timezone.md)
for validation, concurrency and lost-response behavior. Account consumes this
independent preference for explicit timezone changes, and Personal initializes it
once from the device. The [private reporting API](../../docs/application/banking-reporting.md)
uses it for preset dates; the preference does not enable banking.

## Public contract documentation

Use GraphQL descriptions (`"""..."""`) for every handwritten public schema type, field, argument, input field, enum and enum value, interface, union, and scalar, including query and mutation fields and their arguments. Generated schema is exempt where applicable; update its source and regenerate instead of editing generated output. Descriptions are part of the introspectable contract; `#` comments do not replace them.

Explain caller-visible semantics rather than repeating names or syntax. Where relevant, describe authorization and visibility, nullability and distinct states, money units and representation, pagination behavior, lifecycle semantics, and other non-obvious behavior. Keep descriptions proportional to the contract; do not invent guarantees or add irrelevant boilerplate.

## Group creation and discovery

`createGroup` accepts only `operationKey`, `name`, `kind` and optional `trip`.
The verified designated creator is the sole initial owner; currency is USD.
A trip requires Gregorian dates and optional destination (absent/null means empty).
An ordinary group accepts absent/null trip metadata. Names trim only ASCII
space/tab/CR/LF; Unicode scalar limits are 120 for names and 200 for destinations.
Destination whitespace and Unicode normalization are preserved.

`GroupCreationCompleted` identifies the original group, creator membership and
creation timestamp. Fetch `group(id)` separately for fresh labels, metadata and
balances. `GroupCreationRejected` retains domain field errors;
`GroupCreationConflict` means `OPERATION_CONFLICT` and preserves the original
intent. `groupCreationOperation(operationKey)` is self-only and also returns
`GroupCreationNotStarted`: no committed attempt is visible, but an in-flight
request may still commit. Preserve the same key and frozen input after transport
loss or `UNAVAILABLE`; never infer rollback from either state.

Every create/replay/recovery checks current linked, enabled creator authority.
Enabled nondesignated callers receive `FORBIDDEN`; disabled/unprovisioned callers
and inaccessible completed groups receive safe `NOT_FOUND`. Missing verified
credentials and unavailable verification use existing HTTP 401/503 conventions.
Malformed scalars fail before execution and reserve no operation key. Domain
rejections are durable and corrections need a new key. Receipts do not expire.

Viewer groups remain ordered by canonical group ID and filtered by current active
access. `kind` derives from nullable `trip`; `isHousehold` reveals designation
only for an already accessible group. No installation ID or other users' group
directory is exposed. `Viewer.today` is sampled once per response in UTC, including aliases and
node lookups. Clients derive trip status from inclusive dates and this value;
trip dates never restrict expense history or writes. Metadata editing and
classification conversion have no public endpoint.

## Compact group directory and financial summaries

`groupDirectory` is an additive self-only read of every currently accessible
ordinary group and trip except the designated Household. Existing `Viewer.groups`
remains unchanged. Each entry returns `GroupSummary` metadata, an
`activeMemberCount` based on active memberships (including an active membership
whose account cannot currently participate), and `financialSummary`. Pending
invitations and inactive memberships never contribute to that labeled count;
inactive members' financial history remains in the totals.

`GroupFinancialSummary.totalSpendMinor` is the complete current expense face-value
total, independent of ledger pages, filters and trip dates. Repayments are excluded.
`viewerNetMinor` is paid minus owed plus repayments sent minus received, for only
the authenticated viewer's source membership. Positive means being owed, negative
means owing, and zero says nothing about peers being settled. Both values use
exact `MinorUnits` strings; `GroupSummary.currency` supplies their source currency.
`Group.financialSummary` uses the same calculation over its existing coherent
current snapshot, including when an expense connection selects an empty page.

Financial overflow returns a per-source `Problem(AMOUNT_OVERFLOW)` with no money
fields. An authorized empty ledger returns explicit zero amounts. Authentication,
discovery, database or decoding failures return a whole-directory `Problem`, never
a successful empty or partial directory. Requests always recheck account and group
access; clients must continue clearing protected data on access loss/account
replacement and ignore responses from an abandoned session.

The read uses one aggregate SQL statement after the existing transaction-local
identity check, with a five-second application deadline. Eligibility, group/trip
metadata, active counts and current financial aggregates share that statement's
snapshot under unchanged runtime RLS. Separate grouped expense, allocation,
repayment and membership projections avoid join multiplication. The result grows
with accessible groups; financial history stays in PostgreSQL, with no expense
pages or per-member positions transferred and no query per card. Database work
still grows with relevant history: this is a bounded query/deadline strategy, not
a constant-time claim or a silently truncated directory. Repeated reads after
expense creation/editing reflect current projections; repayments change net only.

Deploy this additive API before any web operation selects these fields. This API
foundation does not change existing browser invalidation/freshness policies;
consumers must refresh the affected directory and workspace summaries under the
account-scoped Relay policy when financial mutations commit or refresh is requested.

## Activity

`groupActivity` and `householdActivity` traverse persisted immutable expense-created, expense-updated and repayment-recorded events, ordered by event timestamp, kind and stable event UUID. Exact amounts and financial effective dates remain distinct from event time. Authenticated cursors bind current actor/workspace, exact filters, eligible sources and source revisions; every page reauthorizes. Household activity uses the same current membership scope as `householdDashboard`, never client group filtering. Its signed workspace binding includes membership/account generations, and scope is sampled with the events; leave/rejoin invalidates prior Household continuations even when financial anchors and source IDs are unchanged. See [Activity](../../docs/application/activity.md) for browser, detail and failure semantics.

## Household overview

`householdDashboard` discovers the complete currently eligible common-member set independently of expense pagination. Source space rows preserve exact complete balances, revision, members, current labels and trip metadata. `COMPLETE` includes checked informational totals; `INCOMPLETE` includes freshly authorized rows and an `AMOUNT_OVERFLOW` totals problem; `UNAVAILABLE` exposes only the authorized Household ledger without totals for a legacy service fallback. Every enabled, Auth-linked active Household member is authorized under [ADR-010](../../docs/application/decisions/010-household-membership-sharing.md); a missing designation is never a permission failure. Whole-discovery failure returns `UNAVAILABLE` without rows. Counts use exact canonical `MinorUnits` strings. Zero informational net does not settle independent groups; no aggregate repayment target exists.

Complete Household dashboards and expense views expose `contextVersion`, an
opaque equality token sampled with each result. It binds the actor, membership/account eligibility generations,
complete eligible source set, and current group/member metadata (including roles
and participation eligibility), independently of filters, page size and financial
revisions. Concurrent context and expense reads may be combined only when their
nonempty tokens match. Dashboard tokens are null unless the dashboard is
`COMPLETE`; tokens neither grant access nor replace fresh authorization or signed
financial traversal cursors.

## Structured expense views

`householdExpenses` and `groupExpenses(groupId)` return one complete structured-filtered spending dataset and a bounded global page. `StructuredExpenseFilter` accepts source `groupId`, `categories`, Involving `memberIds`, payer-only `paidByIds`, inclusive calendar dates `from`/`to`, and `sort`. Fields combine with AND and alternatives within one field with OR. Legacy `category` and `memberId` remain additive alternatives. Involving matches payer **or** a saved split allocation, including zero shares; Paid by matches only payer. Every selected ID must belong to the authorized scope and selected source. A membership belongs to one original group: selecting it in Household filters only that group's expenses; it is not a global person identifier. `ExpenseFilter.participantId` on legacy `Group.expenses` retains participant-only semantics. No `search` field, substring/FTS/trigram query or search platform is introduced; #177 owns future production search.

`totalExpenseMinor`, `expenseCount` and every `months` subtotal/count derive from the whole matching dataset, never the loaded page. Expenses count once in their original group; repayments are excluded. `GroupBalances.totalExpenseMinor` remains unfiltered. Default order is effective date descending. `DATE_ASC`, `DATE_DESC`, `AMOUNT_ASC` and `AMOUNT_DESC` order the complete matching set. Amount ties use effective date; all orders then use creation timestamp, raw source-group UUID and raw expense UUID in the selected direction. Every edge preserves the original expense and freshly authorized source label/kind/trip metadata. Select `snapshot` for version-qualified financial identity; its `expenseId` still navigates to the current authorized Expense. The deprecated `node` field is a compatibility-only anchored projection that must not be mixed into reactive normalized reads.

Version-2 signed cursors freeze the complete sorted per-group financial revision vector and the selected order boundary (including exact amount for amount sorting). Equivalent duplicate/reordered alternatives and legacy aliases canonicalize to the same filter binding. All continuation rows, totals and months use that same anchored dataset; new and backdated expenses appear after restarting without `after`. Repayments do not affect anchored spending. Current membership/account access and eligible groups are rechecked every call before any data or cursor error is serialized. An opaque digest binds the viewer, Household membership/account generations and eligible set (or original group/viewer membership for group reads). Changing scope, structured filters or sort, viewer, eligibility generation or current eligible set rejects traversal. There is no claim that a financial revision proves authorization. Membership readmission uses current authorization and complete lifetime history; an identical restored ordinary-group scope may resume its old anchored history, while Household/source membership leave/rejoin advances eligibility generations and invalidates old Household traversal without requiring another sharing confirmation.

The complete traversal token is bounded to 64 KiB; an over-budget token returns `UNAVAILABLE`, never a truncated anchor/set or partial response. Reads use the dashboard's canonical user→scope guard→group locks or ordinary group read protocol, a five-second deadline and at most three fresh discovery attempts. Invalid structured syntax is `INVALID_INPUT`; inaccessible source/member IDs are masked as `NOT_FOUND`; bad signatures/scope/filter/eligibility/future anchors are `INVALID_CURSOR`; unavailable reads and exact int64 overflow return safe Problems without rows, months or apparently successful zero totals.

## Self profile

[`profile.graphql`](profile.graphql) exposes `currentProfile` independently of
group discovery and `updateMyProfile` with an exact expected display name. Both
operate only on the enabled, provisioned authenticated caller. The application
name is separate from Auth metadata; only current authorized name projections
refresh, while financial records and recovery snapshots remain unchanged. See
the [profile contract](../../docs/application/profile.md) for validation,
concurrency and safe retry outcomes.

## Expense corrections and historical Activity (#212)

`expense-editing.graphql` defines complete versioned replacement intents and
structured committed/no-op, conflict, whole-expense lock and same-key recovery
outcomes. The original source, creator, creation timestamp and currency remain
immutable. Current access always takes precedence over capability hints. See the
[editing contract](../../docs/application/expense-editing.md) for lock order,
immutable snapshots, anchored reads and repayment semantics.

`ActivityEvent.before`/`after` contain recorded expense values with currently
authorized minimal labels. `activityEvent` rechecks the requested group or
Household aggregate scope. Neither event detail nor original operation results
substitute for a current expense read.

Anchored `ExpenseSnapshot`, `ExpenseView` and `ExpenseConnection` expose opaque
non-Node cache IDs. Snapshot IDs isolate saved financial versions and nested
allocations; view/connection IDs isolate exact anchored pages and prevent partial
selections at the same query arguments from retaining stale unselected fields.
These IDs are not cursors or access capabilities. Read through the original
currently authorized query, using its signed continuation cursor where needed.
See [client financial identity](../../docs/application/expense-editing.md#client-financial-identity)
for metadata ownership and API-before-client deployment compatibility.

## Private banking enrollment and lifecycle

`banking.graphql` exposes owner-bound enrollment and existing-Item repair, explicit
selection, revision-checked disconnect/private-history deletion, operation status
and retained connection/account reads. Deselected streams retain history; deleted
connections expose only opaque lifecycle/cleanup status. Exact generations are
decimal strings; local completion, provider teardown and active-copy purge remain
separate outcomes. The [enrollment contract](../../docs/application/banking-enrollment.md)
describes canonical attempts, explicit server-verified US/USD selection, the
365-day requested history window and non-active uncertainty/cleanup states. Only
start returns the short-lived Link handoff; tokens must never enter persistent
browser storage. `AWAITING_INITIAL_IMPORT` supplies no transaction or freshness
claim. New enrollment is disabled by default. The [sync adapter and restricted persistence](../../docs/application/banking-sync.md) validate provider pages and atomically commit complete batches/checkpoints. The same worker executes durable initial and incremental imports for explicitly selected accounts, verified Transactions dispatch and daily reconciliation. The [private reporting API](../../docs/application/banking-reporting.md) exposes owner-only canonical transaction/detail/archive reads, complete exact summaries and guarded single-field annotation edits/resets with durable recovery. Personal consumes initial browser Link selection/recovery, private connection inventory/status and canonical/archive/discrepancy transaction browsing. Connections provides explicit account selection, repair, disconnect/private-history deletion, staged replacement previews and reporting-plan recovery. Reusable private transaction detail provides explicit category/activity/note/exclusion/review edits, resets, guarded version conflicts and original-attempt recovery. Overview presentation remains a separate delivery; live rollout stays subject to the separately authorized [#255 gates](https://github.com/haggaikaunda/kami-split/issues/255). The [replacement backend](../../docs/application/banking-replacement.md) supplies explicit staging, activation and recovery.

## Private banking replacement

`banking-replacement.graphql` supplies explicit owner-targeted staging through the
existing enrollment finish, complete persisted impact previews, five revision
guards, durable confirmation/cancellation and opaque operation recovery. Dates
partition reporting by posted-bank date; archive references add no contribution.
See [replacement semantics](../../docs/application/banking-replacement.md) for
usable-data versus coverage, exact totals, recovery and collection fences.
The [sync adapter](../../docs/application/banking-sync.md) supplies provider ingestion, and the [private reporting API](../../docs/application/banking-reporting.md) supplies canonical reads and guarded annotation edits. Personal Connections consumes these staging, preview, confirmation and recovery operations through authenticated Relay UI. Reporting-plan recovery does not restore provider permission or collection, and live rollout remains separately gated by [#255](https://github.com/haggaikaunda/kami-split/issues/255).

## Private banking import status

`banking-status.graphql` extends the existing owner-only connection/account read
with separate operation, usability, recovery, collection, reporting, availability
and freshness dimensions. See [the status contract](../../docs/application/banking-status.md)
for unknown/null meanings, requested-bound provenance, snapshot/cache invalidation
and remaining producers. Logical account IDs repeat across replacement streams;
Relay consumers select `streamId` for the existing actor-scoped cache identity.

## Private bank reporting

`banking-reporting.graphql` defines actor-only canonical transaction/detail/archive reads, complete filtered counts and exact account spending, saved-zone presets, coverage and signed snapshot pagination. It also defines private single-row annotation edits/reset with durable attempt recovery. See [the reporting operation contract](../../docs/application/banking-reporting.md) for unavailable versus partial/empty/activity-only states, taxonomy choices, query limits, concurrency and archive ownership.
