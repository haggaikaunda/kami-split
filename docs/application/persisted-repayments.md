# Group repayment persistence

The application operation and authenticated GraphQL API implement the [approved #110 contract](proposals/repayments/README.md).
Any currently authorized active group member can record an actual transfer between
distinct active, enabled, linked same-group memberships. The server derives creator
separately from sender/recipient. Partial repayments, overpayments and transfers
without a current simplified edge are allowed. No payment processing occurs.

The API exposes `recordRepayment`, actor-scoped `repaymentOperation`, authorized
Repayment nodes and `Group.repayments` history. The seeded web preview was retired in #184. #171 connects the authenticated
Group/Trip workspace to a persisted repayment form with actor/group-scoped draft
and recovery storage. The #112 Household workspace links repayment entry to its explicit source group. Recording a repayment uses the same explicit
group regardless of future UI entry point.

## Exact balances and atomic history

Each record is 1–999999999 USD cents, with exact integers throughout. Complete
member net is paid − owed + sent − received. Expense totals remain expense-only.
Retained inactive history participates in the same existing simplifier. Both
expense and repayment writes check the complete candidate projection under the
group lock; intermediate arithmetic uses wide integers and rejects out-of-range
final aggregates/nets. Every individual's net must be zero to call a group settled.

The additive migration backfills `financial_records` from existing expenses.
Record insertion triggers register one shared group revision; a primary key
prevents cross-kind revision reuse. Repayment, registry, audit and successful
outcome commit together. Deferred constraints prevent incomplete records and
later attachments; successful recovery results require a matching financial row.
Runtime roles have no financial UPDATE/DELETE or direct registry INSERT grants.

The historically named `expense_operations` table now supports CREATE_EXPENSE and
RECORD_REPAYMENT. Existing expense canonical bytes and outcomes stay unchanged.
Both use the same application lookup/compare/transaction engine, with actor/group/
kind/key binding and lifetime-of-history retention. Current actor access is checked
before returning an original result, and historical lookup precedes counterparty
eligibility. New writes restart in user-before-group lock order. UNKNOWN and
NOT_OBSERVED require the same original key/input; neither authorizes a fresh key.

Complete authorized read snapshots include both kinds in the financial revision
and all sent/received history. Original results retain their own revision and
financial values; updated balances require a fresh read. Expense cursor anchors
still bound expense inclusion and do not acquire repayment edges.

## Verification

Pure ledger tests cover approved overpayments, D2–D4, canonical intent and checked
arithmetic. Restricted PostgreSQL tests cover atomic writes, current access,
concurrent retries, commit-response loss, membership/account races and rollback.
`make db-test` checks populated expense upgrade/backfill, fresh replay, schema and
grant consistency, integration behavior and full financial backup/restore. Required
root checks, sqlc/gqlgen drift and independent review remain delivery gates.

## API and history

`RecordRepaymentInput` carries explicit group/key/sender/recipient, canonical
string cents, USD, calendar date and preserved note. Creator is never an input.
Success returns only the original immutable transfer record. Same-key changed
payload returns OperationMismatch; missing recovery returns NOT_OBSERVED, never
proof of noncommit. Current actor access is required even for an old result.
Another authorized group member can read history but cannot read the creator's
private attempt outcome. Minimal member labels come from fresh authorized reads.

`Group.repayments(first: 20, after: ...)` accepts 1–100 entries and returns a
nullable Relay connection ordered by effectiveDate/createdAt/ID descending.
Only one distinct repayments selection per Group projection is supported;
aliasing multiple history requests returns INVALID_INPUT at those fields.
Cursors use existing persistent signing keys with a repayment-specific scope.
They pin financial inclusion to the initial revision; new or backdated entries
require a new traversal. Expense cursors remain compatible with their existing
encoding and are never accepted for repayment history. Invalid or unavailable
pagination returns a null field with a safe error, not an empty successful page.

The repayment page and its member labels share one statement snapshot after
current actor/group locking. A separately resolved balance/expense field can
observe another financial revision; the connection exposes its own anchor.
GroupBalances positions now expose exact sentMinor and receivedMinor as well as
paidMinor, owedMinor and netMinor. A balance refresh includes complete history,
independent of either page's inclusion anchor. Existing request body, complexity,
identity, deadline and diagnostic boundaries also apply to these operations.

## Authenticated workspace entry (#171)

Overview shows complete Total spend and one signed viewer balance, with no
settlement controls. Balances shows complete member positions and simplified
obligations. A specific eligible sender/recipient row opens
`/groups/:groupId/repayments/new` (ordinary), `/trips/:groupId/repayments/new` (Trip), or `/household/ledger?tab=balances&repayment=1` (original Household) with its suggested cents. The form preserves the
original group/participants and freezes its operation key/input before sending;
unknown outcomes can recover or retry only that original intent. Navigation and
reload retain tab storage, while logout/account replacement clears it. Current
server access remains required, including original-result recovery.

Partial/overpayment and unmatched actual transfers retain the implemented server
contract; no preview opposite-direction acknowledgment policy is imported. Success
requests fresh complete balances and recent recorded repayments without changing
expense totals. Records completing after navigation do not redirect that visit.
The Activity tab uses the complete authenticated feed from #172; recent repayment
history is separately labeled and does not claim to be the whole activity feed.
