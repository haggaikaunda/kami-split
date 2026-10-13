# Repayment persistence and API design

This is the concrete engineering contract for [#110](README.md), subject to design
PR adoption. Keep runtime fields absent until implemented and tested.

## Shared storage and revision

Add `app.repayments` with UUID id, group_id, creator_id, sender_id, recipient_id,
amount_minor, currency, effective_date, note, created_at, creation_tx and revision.
Constraints mirror expense bounds and same-group membership composite foreign
keys, plus sender_id != recipient_id. Add immutable `repayment_audit` with unique
repayment ID, group, verified actor, creator, RECORD_REPAYMENT event and the exact
record commit timestamp. No destructive migration or runtime UPDATE/DELETE grant.

Extend the existing `expense_operations` table to support both operation kinds,
keeping its name for compatibility with deployed expense queries and outcomes.
Add nullable repayment_id with unique/same-group FK. CREATE_EXPENSE requires
create-expense-v1 and no repayment_id; RECORD_REPAYMENT requires record-repayment-v1
and no expense_id. A successful outcome references exactly its record; definitive
rejections have neither. Preserve old canonical bytes and JSON results verbatim.
Queries explicitly bind operation kind; actor-scoped RLS continues to isolate
results. Extract common lookup/compare/retry/transaction flow in the application
service so repayment does not introduce a second uncertain-result engine.

Add append-only `financial_records(group_id, revision, kind, record_id)` with
primary key (group_id, revision), unique (kind, record_id), and positive revision.
Backfill existing expense rows without changing revision values. Record insertion
triggers register both expense and repayment IDs in the same transaction; registry
rows are not directly insertable by the runtime role. Narrow SECURITY DEFINER
trigger helpers use a fixed search_path and cannot be directly invoked to bypass
record insertion. Complete deferred constraints require the record, matching
registry entry, audit and operation result in the same creation transaction.
They also reject success outcomes referencing a different record or wrong actor.
Existing expense completeness checks continue to protect allocation reconciliation.

Under user-before-group write locks, new expense and repayment writes compute
max(registry.revision)+1 with checked exhaustion. The registry primary key prevents
cross-kind reuse even if a caller supplies the wrong revision. Fresh authorized
read snapshots derive revision from the registry and compute complete expenses,
allocations, repayments and retained members in one SQL statement. Expense
pagination still filters only expense rows at its original financial anchor;
a repayment may advance balances without inserting an expense edge.

RLS permits repayment/history reads only to currently authorized active members.
Record/audit inserts require server-bound creator/actor. Composite keys prevent
cross-group references. Eligibility checks run after user/group locks through the
existing membership profile projection. Generic INVALID_PARTICIPANT errors reveal
no foreign member IDs or labels. Member status changes and account disabling use
the existing compatible group/user locking protocol.

## Canonical payload and outcomes

Canonical fixed JSON array (strings, required JSON escaping only):
`["record-repayment-v1",groupId,senderId,recipientId,amountMinor,currency,effectiveDate,note]`.
Omitted note and empty note are equivalent; whitespace remains significant. The
key and actor are scope fields, not mutable payload. Changing amount, direction,
date or note with the same scoped key returns OperationMismatch. Currency remains
USD; invalid scalar/ID syntax fails before binding. Canonicalizable domain failures
are durable ValidationProblem results, including OUT_OF_RANGE, INVALID_INPUT,
INVALID_PARTICIPANT and AMOUNT_OVERFLOW. Use existing path/code/message shapes.

The shared transaction flow performs historical lookup before participant
eligibility, and repeats lookup after restarting in new-write lock order. It
stores either the immutable original success or definitive validation rejection.
Storage failure rolls back the entire transaction; connection loss around COMMIT
returns UNKNOWN and requires same-attempt lookup/retry. There is no committed
PENDING row. P2 retention and current actor authorization apply without expiry.

## Public operation shape

Reuse existing ID, OperationKey, MinorUnits, Currency, Date, DateTime, Revision,
Problem, ValidationProblem, OperationMismatch and uncertainty result types.
The following describes new fields; authoritative SDL is added only in the API PR.

```graphql
input RecordRepaymentInput {
  groupId: ID!
  key: OperationKey!
  senderId: ID!
  recipientId: ID!
  amountMinor: MinorUnits!
  currency: Currency!
  effectiveDate: Date!
  note: String! = ""
}

extend type Mutation {
  recordRepayment(input: RecordRepaymentInput!): RecordRepaymentResult!
}

extend type Query {
  repaymentOperation(
    groupId: ID!
    key: OperationKey!
  ): RepaymentOperationResult!
}
```

`RecordRepaymentResult` contains RepaymentCommitted, ValidationProblem,
OperationMismatch, OperationProgress and Problem. Recovery uses the same
union members. OperationProgress carries key and state UNKNOWN or NOT_OBSERVED
(and only safely established transient PENDING), following the existing
OperationState enum. No raw JSON outcome is returned to clients.

`RepaymentCommitted` contains key and an immutable record with repaymentId,
groupId, creatorMembershipId, senderMembershipId, recipientMembershipId,
amountMinor, currency, effectiveDate, note, committedAt and revision. Membership
IDs here are historical values, not nested authorization bypasses.

A Repayment Node exposes id, groupId, creator, sender, recipient, amountMinor,
currency, effectiveDate, note, createdAt and revision using freshly authorized
minimal Membership fields. Node lookup reauthorizes the containing group before
returning labels. Add `Group.repayments(first: Int = 20, after: String)` as a
nullable Relay connection with standard edges and PageInfo. Enforce first 1..100,
order effectiveDate/createdAt/UUID descending and pin financial inclusion to the
initial shared revision. No filters or totalCount initially. Signed cursors carry
an explicit repayment scope distinct from expense cursors; swapping them yields
INVALID_CURSOR. Same body/complexity/deadline budgets apply. Pagination errors
follow the existing nullable expense-connection error convention. No partial list
may claim to be complete after an infrastructure error.

Group positions expose sentMinor and receivedMinor alongside existing paidMinor,
owedMinor and netMinor. totalExpenseMinor stays unchanged by repayments. Success
and recovery do not return a current balance; callers refresh complete balances
and history separately under current authorization.

## Operation examples and acceptance trace

IDs below abbreviate canonical typed IDs; transport fixtures use real typed IDs.

- In G, B paid 2000 entirely allocated to A. Creator C records A→B 500 with key K:
  A becomes −1500, B +1500, C 0; original paid/owed totals remain 2000.
- Same starting history, A→B 2500 is valid: A +500 and B −500. No acknowledgment
  boolean is required. A further actual A→C 100 is valid even without a matching
  edge. No synthetic repayment is emitted when obligations are recomputed.
- In an empty/settled G, A→B 100 is valid: A +100, B −100; expense total remains 0.
- Concurrent same K/input returns the same repayment ID/revision with one audit.
  Reusing K with amount 501 returns mismatch, without additional financial effect.
- Record in G, lose the response, navigate to H: recover remains G/K. A new expense
  in G changes current revision; recovery still returns the original repayment
  revision. Current reads include both; H never gains a copy.
- Another active member can read G's repayment history, but cannot recover C's
  actor-scoped K. After C loses access, C's lookup is denied even with K.

Implement the full [acceptance matrix](README.md#behavioral-regression-scenarios)
with restricted PostgreSQL roles and real transactions, including actual commit
response loss, both serialization orders for membership/account races, rejected
attempt durability, mixed expense/repayment revisions, old expense cursor anchors,
foreign cursors, rollback at every component, and candidate overflow in both write
paths. No prose-only assertion substitutes for these runtime probes.
