# Private transaction reporting

`bankingReport`, `bankingTransaction`, `editBankingAnnotation` and
`bankingAnnotationOperation` expose authenticated private bank activity from
stored data. Group access grants no bank access. Reads work independently of
new-enrollment enablement and never request a bank refresh. The authoritative
wire contract is [banking-reporting.graphql](../../packages/schema/banking-reporting.graphql).
Personal Overview and Transactions consume these stored-data reads with actor-scoped
Relay ownership. Its reusable detail panel keeps provider facts read-only and
exposes explicit private category/activity/note/exclusion/review editing and
resets. Overview shows one exact spending summary with purchases/charges and refunds, plus three recent rows. View all and classification review preserve applied date/filter context; a confirmed detail edit refreshes the complete report. Live enrollment retains its separate delivery boundary.

The reporting service resolves each posted source against one current,
non-overlapping interval plan. Retired history keeps its original source identity
and captured facts. Only the active binding supplies pending rows; removed rows
remain inspectable and noncontributing. Recovery manifests are discoverable on
each account. Supply `archiveId` to page their immutable captured facts and
annotation provenance and original immutable captured values; archive queries return activity counts without a spending
summary. Detail links a source that is also current to its sole current edit owner.
Archives contribute nothing to ordinary reports. `sourceDiscrepancies` exposes the latest noncontributing corrections in a separate paged context; detail can inspect their source facts without merging identities, changing interval ownership or granting reconciliation writes.

Spending is posted purchases, bank fees and debit interest minus identified
refunds in their posting period. Shared expenses, allocations, repayments,
transfers, income, loan proceeds and cash withdrawals do not contribute. Pending,
removed, excluded and unresolved activity remains separate. Signed USD minor-unit
strings and aggregates use exact arithmetic and the existing safe-money bound;
invalid data or overflow fails the whole result. Source amounts and bank dates
cannot be privately edited. The provider adapter requests PFC v2 and preserves
primary/detail/confidence/code facts. The pinned official identifier mapping
rejects unknown or inconsistent taxonomy; conflicting high-confidence activity evidence, low-confidence or ambiguous credits
remain unresolved. `activityChoices` and `categoryChoices` expose approved values.
A category override affects grouping alone.

One owner-authorized statement reads lifecycle, plans, facts, annotations and
saved timezone together. List rows, complete counts, activity/category totals and
spending use the same normalized account/date/category/activity/status filters,
independently of loaded pages. Presets use the saved timezone to resolve today;
posted bank calendar dates are never reinterpreted as UTC instants. Custom ranges
accept real inclusive dates in years 0001–9999, ordered and no later than today.
No history window is silently clamped. Default pages contain 50 rows, maximum
100, ordered by descending bank date and stable source ID. Signed cursors bind
actor, normalized filters, resolved day/bounds, preference and the observed
reporting revision. Any relevant sync, annotation, lifecycle, selection, plan or
preference change requires restarting pagination. A new preset day also restarts.

Coverage is composed over those same reporting intervals. Requested initial
history (365 days), observed historical-update completion, known coverage bounds,
local commit/provider freshness and stopped collection remain distinct facts.
An earliest transaction never proves earlier coverage. A usable subtotal can
coexist with unknown/partial history and unresolved counts. Missing initial data,
no accounts, invalid aggregates and query-resource failures have no spending
summary. A fully covered empty period can return zero. Pending-only and review
views return complete counts with `ACTIVITY_CONTEXT` and no spending headline.
The current snapshot implementation fails explicitly with `QUERY_LIMIT` above
100,000 matching current/archive facts after account/date/archive filtering; it never returns a truncated
successful total. This resource ceiling does not delete or expire history.

Private annotation operations change/reset exactly one category, activity, note,
exclusion or reviewed field. Notes allow at most 2,000 Unicode code points and
reject controls except line breaks/tabs. Expected annotation and material-source
versions prevent lost updates. Activity sign must agree with source money.
Explicit activity/reset and review intent is recorded separately from automatic source projections. Review has its own material acknowledgement, so a review edit never validates stale activity. Source changes preserve visible intent and notes; stale activity remains
unresolved until confirmed/reset, and a reviewed flag alone cannot resolve it.
Retried identical attempts return the original safe outcome, changed-input reuse
conflicts, and operation recovery reauthorizes before fetching current facts.
Archive-only edits affect no current totals until explicit restoration. Restored facts use latest source-wide category/note/exclusion and explicit activity/reset intent; incompatible activity remains unresolved, and an explicit reset cannot resurrect an older override. Recovery manifests capture the exact canonical facts leaving reporting and reconstruct immutable effective annotation values at their saved revision cutoff. Replacement impact previews use the same classification and exact aggregation rules as reports. Deletion
barriers immediately hide all affected current/archive facts; receipts retain
only safe codes and opaque IDs. Provider cleanup remains independent.

`BankingReport.id` identifies the complete filtered report and exact page, while
`BankingTransaction.id` and `BankingReportAccount.id` identify complete fact,
annotation/provenance and period-coverage snapshots. These opaque cache keys are
computed before GraphQL field selection. Partial refreshes therefore replace the
report projection without retaining older unselected totals, rows or coverage.
Use `sourceId` for transaction detail/annotation writes and `accountId` for account
filters; `currentId` remains the current source edit owner. Immutable manifest
`BankingReportArchive.id` remains its archive navigation key. None of these
reporting types implements Node, and cache identities grant no access or cursor
authority. `BankingTransactionDetail.id` isolates the complete outcome/current-edit-owner
context, and `BankingAnnotationResult.id` isolates the complete receipt outcome and
freshly authorized detail. Partial responses cannot retain a previous edit-owner
link or an earlier missing-receipt outcome alongside newly returned detail. Clients continue to use the existing actor-scoped Relay environment.

## Browser annotation ownership

The detail editor retains an actor/source-scoped tab draft and exact opened
source, material and annotation versions. Save sends only changed fields in a
serial sequence of independently durable operations, with a distinct attempt
per field. The interface explains partial completion: an earlier confirmed field
is not rolled back when another fails. Source changes stop remaining writes for
explicit review. Reset clears only its named override. A retained conflicted
activity can be explicitly confirmed against fresh material facts; marking a
record reviewed alone does not resolve classification.

Receipt recovery precedes retry after a lost response. A missing receipt permits
only the original frozen command and attempt, since the first request may still
be in flight. Confirmed receipts and current detail remain separate facts.
Archive-only outcomes may have no canonical detail; the editor freshly reads the
selected archive before adopting current private annotation versions. Immutable
capture provenance remains distinct from the latest editable annotation.

The native contextual dialog contains focus, makes other navigation inert and
uses explicit Back/Close/Cancel discard protection. Dirty browser traversal is
held at the detail until the user keeps editing or discards; reload warns and
restores the actor-owned draft. Tab storage failure blocks new effects. Each confirmed field triggers a complete server report refresh while the
independent editor retains any remaining draft. After a confirmed edit the navigator replays the originating extent from a fresh
signed anchor, capped by the complete matching count when records leave a filter.
A revision change or denied continuation during that traversal requires a restart.
