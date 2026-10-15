# Collaborative expense editing (#212)

The approved contract allows any current active authorized member of the original
Group, Trip or Household ledger to correct an eligible expense. Creation identity,
creator, creation timestamp, source and USD currency are immutable. Household
aggregate visibility adds no write authority. Deletion, reversal, undo, automatic
readmission and expense moves remain excluded.

## History and current projections

The storage model retains one guarded current expense and its allocations, plus
immutable typed expense revisions and revision allocations. Existing records gain
version-one snapshots without changing creation receipts. A narrow database edit
function changes the current projection and appends history atomically; the runtime
role does not gain unrestricted UPDATE/DELETE access. Creation snapshots and edit
snapshots retain exact integer amounts, descriptive fields and percentage intent.

The expense version starts at one and advances only for a material edit. The group
financial revision remains a separate projection counter. Anchored expense reads
select the last version at or before each source anchor, including that version's
allocations, before applying filters and ordering. This preserves a coherent old
traversal even when edits change month, category, payer or participants. Current
complete balances/dashboard select only current projections; revisions never add
extra spending. Current membership/account scope authorization remains independent
of financial anchors.

## Authorization, locks and recovery

`updateExpense` receives complete replacement fields, the original `expenseId`,
`expectedVersion` and a client-generated operation key. The server checks current
actor/source access on every write, read and recovery. It recovers and compares a
committed same-key intent before consulting a subsequently changed expense version
or counterpart eligibility. Changed-input key reuse returns a mismatch.

New attempts coordinate saved and proposed affected users before the group write
lock, following the existing financial/lifecycle lock order. Saved payer and every
explicit saved participant, including zero shares, must remain active and eligible.
An inactive saved member locks **all fields**, even if the proposal removes them.
The original creator's departure alone does not lock an expense, and neither do
unrelated departed members. Owners cannot bypass this restriction. A new authorized
targeted invitation/readmission restores the same membership; eligibility is then
re-evaluated. An edit never readmits a member.

Conflicts and locked outcomes have no financial effect. A canonical unchanged save
returns success with `changed: false`, preserves the expense/financial versions and
creates no Activity event; its operation outcome remains recoverable. Meaningful
success atomically stores projection changes, immutable revision/event evidence
and the original `EDIT_EXPENSE` operation result. Unknown responses retain the same
key and frozen input. `NOT_OBSERVED` never proves rollback.

## Settlements and event facts

Actual repayments remain untouched. If A pays $100 shared equally with B and B
records a $50 repayment to A, correcting the expense to $80 produces $80 total
spending and A owing B $10. The edit is eligible while both remain active; B's
subsequent departure locks the saved expense. Existing departure/removal rules
still require exactly zero individual net in the original group.

Activity exposes real `EXPENSE_CREATED`, `EXPENSE_UPDATED` and
`REPAYMENT_RECORDED` events. Update detail supplies immutable before/after fields,
including saved allocations/percentage intent, with current authorized minimal
member labels. Creation detail reads version one; later edits cannot rewrite it.
Recorded event time drives chronology, independently of the expense effective
date. Event details recheck Group or Household source context. “View current
expense” is a separate fresh authorized read.

## Browser behavior and verification

Creation/editing reuse field controls and exact split validation. Saved fields
prefill the edit draft, including whitespace notes and explicit zero participants.
Unchanged Save remains disabled. Financial edits explain that balances may change
without moving money. The draft is isolated by actor/source/expense/operation;
uncertain attempts survive same-tab reload and clear on logout/account switch.
Conflicts retain the draft and require explicit latest-state review/reapplication.
Successful writes and subsequent refresh failures are different states.

The [visual interpretation](../design/references/activity-editing/README.md) records
the owner's original mockup and required responsive acceptance. Required automated
checks include real restricted-role database constraints, rollback, exact balances,
concurrency, recovery, permissions and anchored-history tests, plus production UI
behavior and independent requirements/final-diff review. The delivery PR records
executed commands, final commit and any limitations; this contract is not itself
verification evidence.

The database departure guard enforces exact numeric zero net in that source
ledger, including actual repayments. No cross-group netting or historical
pairwise-debt condition applies. Lifecycle callers retain ordered user-then-group
preparation. An unprepared raw membership update under conflicting locks fails
without waiting, requiring a full transaction retry; it cannot invert member
foreign-key and financial locks. This adds neither a membership write grant nor a
departure UI.

## Client financial identity

Current `Expense` remains a stable public `Node`; `node(expenseId)` always reads
current authorized values and edit capability. Anchored `Group.expenses`,
`groupExpenses` and `householdExpenses` expose `edge.snapshot: ExpenseSnapshot`.
Its distinct opaque `id` identifies one expense version, while `expenseId` is the
original current entity ID for navigation. Financial fields and allocations share
that saved version. Membership labels and eligibility remain current metadata.

`ExpenseView.id` identifies one complete financial/context projection and exact
bounded page: scope, canonical filters, source revision vector, current
eligibility/context, size and boundary. `ExpenseConnection.id` identifies its
original-group financial anchor, filters and page arguments. These separate
identities prevent a partial refresh from retaining older unselected rows, totals
or nested financial fields. Neither type implements Node; refetch through the
original authorized query and signed cursor. Cache IDs and `contextVersion` grant
no access, and contextVersion remains independent of financial revisions.

The account Relay environment also separates `GroupSummary` and
`ActivityIdentity` records from the Group/Membership Nodes whose public IDs they
carry. Current Profile IDs already use their distinct public namespace. Activity
before/after values and operation receipts remain historical values under their
own owners; neither substitutes for current expense detail.

Deploy the additive schema/API before clients select `snapshot`. The existing
deployment workflow orders affected web deployment after successful API deployment;
client rollback may retain the additive API so deployed old clients remain compatible. Deprecated
`edge.node` fields retain old anchored response semantics for deployed clients;
those fields must not back reactive normalized reads because their current
Expense IDs overlap across financial versions. Current production operations use
`snapshot`, with the response alias `node` and explicit `expenseId` navigation.

The financial ledger currently retains a request snapshot for each signed
traversal. A refresh clears all rows, complete aggregates and cursor state before
starting a new traversal; a continuation appends only within that same owner and
account/visit generation. This deliberate [snapshot reader exception](frontend.md#financial-identity-and-deliberate-snapshots)
prevents a new normalized first page from replacing one part of an active traversal. Cache identity alone
does not authorize combining separate traversals, infer complete aggregates from
loaded pages, replace Household context matching, or turn a failed post-mutation
refresh into a failed write.
