# Group repayment contract — #110

Status: finalized contract for review; implementation follows adoption of this
PR. This document does not expose a running API. Prerequisites #82 and #86 are
complete. [Issue #110](https://github.com/haggaikaunda/kami-split/issues/110) requires
a reviewed design before persistence/API work. [ADR-007](../../decisions/007-household-dashboard.md)
supplies the group boundary and D2–D4 probes; dashboard queries are not a dependency.

## Approved owner decisions

[Owner approval](https://github.com/haggaikaunda/kami-split/pull/127#issuecomment-5906321888)
resolves R1–R3:

- **R1:** Any currently authorized active group member may record a repayment.
  Preserve server-derived creator/audit identity separately from sender/recipient.
- **R2:** Allow partial repayments and overpayments, including transfers outside
  current simplified edges or in a previously settled group. They record actual
  transfers and may create or reverse positions. No obligation cap, required
  matching edge, balance-version precondition or acknowledgment boolean is added.
  The explicit named-group/people/amount submission records the caller's intent.
- **R3:** New repayments require distinct active, enabled, linked members of the
  target group as sender and recipient. Historical outcomes remain recoverable
  after later counterparty inactivity when the actor still has current access.

No departure, correction, edit or reversal policy is implied. Simplification
never writes synthetic repayments. The numeric per-record ceiling is independent
of an obligation: 1..999999999 cents, matching the existing financial record limit.

## Operation and validation

Use one explicit-group `recordRepayment` and corresponding actor-scoped
`repaymentOperation` lookup. Input contains groupId, key, senderId, recipientId,
amountMinor, currency, effectiveDate and note. The server derives creator and
actor from verified identity. IDs use the existing canonical Group/Membership
encoding. Sender and recipient must be distinct and belong to that group.

Record bounds are 1..999999999 cents, USD only. Reuse the implemented MinorUnits, OperationKey, Date and Revision
coercion. Note defaults to empty and preserves whitespace, permits 0..2000
Unicode scalar values, and rejects NUL/unpaired surrogates. Reuse the existing
Gregorian date range 0001–9999 without inventing a future-date ban. Scalars and
IDs never pass through binary floating point. R1–R3 determine the remaining
semantic validation. Group/profile disclosure follows ADR-005; unavailable or
unauthorized IDs must not disclose another group's members.

Success contains an immutable original record: repayment ID, explicit group,
creator/sender/recipient membership IDs, exact amount/currency/date/note,
commit timestamp and produced financial revision. No current labels or current
balances belong in a durable outcome. Current authorized reads resolve labels
and complete balances separately. Add authorized repayment-by-ID/history reads
as part of the API slice so users can inspect actual records after losing a
client key. History is append-only, bounded and paginated using the existing
signed forward cursor approach with a repayment-specific cursor scope;
Its contract is specified in [technical design](technical.md). No dashboard fields are required.

## Financial projection and shared revision

For each retained membership, compute exact net = paid − owed + sent − received.
Paid/owed and totalExpense retain their existing expense-only meanings. Add
separate nonnegative sent/received aggregates; repayment never increases
spending. Retain inactive history and use the existing deterministic canonical-ID
simplifier. No synthetic intermediary payment or Household copy is written.

All nonnegative aggregates and net magnitude remain bounded by int64 maximum.
Use SQL numeric and Go wide intermediate arithmetic: paid + sent can exceed
int64 even when the final net is valid. Check each exposed aggregate and final
net, plus sum(sent) = sum(received), sum(paid) = sum(owed) = totalExpense, and
sum(net) = 0. Every individual zero is the only settled condition. A failed
complete read is unavailable/overflow, never zero.

Both expense creation and repayment must validate the complete candidate
projection under the group write lock before committing. The current expense
check based on totalExpense alone no longer proves net bounds after repayments.
Overflow stores a definitive AMOUNT_OVERFLOW rejection without financial, audit
or revision changes; it must not create a ledger that later reads cannot display.

The current revision is max(expense.revision). Repayment requires one financial
sequence shared by both kinds: under the existing group write lock, take the
maximum across expenses and repayments, reject exhaustion, allocate exactly
next +1, and include both in complete read revisions. Expense creation must use
this same rule. Preserve existing expense revision values and cursor anchors;
repayment does not add an expense edge. Test interleaved writes and old cursors.
A shared financial-record registry enforces cross-kind revision uniqueness as
specified in [technical design](technical.md).

## Transaction, authorization and durable recovery

Reuse the existing user-before-group lock protocol and two-phase attempt lookup:
first authorize actor/group and look for the original outcome; if absent,
restart with actor and affected users locked in canonical order before the group
write lock. Recheck the attempt, access and new-write eligibility after locks.
Never take participant user locks after the group lock. Membership changes and
account disabling must serialize with this protocol.

Canonical input is versioned `record-repayment-v1`, a fixed-position JSON array
of group, sender, recipient, amount string, currency, date and exact defaulted
note. The operation is bound to actor/group/RECORD_REPAYMENT/key. Compare both
canonical bytes and SHA-256. IDs/scalars must be normalized before this binding.
Do not repurpose CREATE_EXPENSE outcomes or reinterpret their canonical bytes.
The current expense operation table is expense-specific; the persistence slice
must extend the shared infrastructure without a second retry engine or changing
existing expense results. Preserve the existing lifetime-of-history P2 policy,
including definitive rejected attempts; no expiry, pruning or tombstones.

One database transaction commits repayment, audit, shared revision and successful
outcome. Use same-group composite foreign keys, forced group RLS, actor-scoped
operation RLS and restricted SELECT/INSERT grants. Audit records server actor,
creator, event and commit time. Database completion constraints must prevent a
record without audit/outcome, or attaching them to history in a later transaction.
No UPDATE/DELETE grants. Failure at any write stage rolls back all financial
state; a definitive semantic rejection retains only its durable attempt result.

Reuse existing committed/validation/mismatch/NOT_OBSERVED/UNKNOWN/NOT_FOUND
semantics. Current actor authorization precedes recovery, even for old records.
Same-key retry returns the original result before revalidating counterparties. Different keys are different actual transfer claims;
idempotency does not deduplicate by date/people/amount. Timeout around commit
never proves failure. Retry only the original key/input, including after restart
or navigation to another group. Successful recovery then refreshes complete
balances; failed refresh does not turn a committed repayment into a failed save.

## Behavioral regression scenarios

| Probe                | Expected evidence                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D2                   | H A→B 2000 and T B→A 2000 remain separate; paying H changes H alone                                                                                                    |
| D3                   | Same-group three-member cycle has each net zero, no obligations; a new actual payment is allowed and creates equal/opposite positions                                  |
| D4                   | A owes B 2000, B owes C 2000; one A→C payment clears all positions with no B payment                                                                                   |
| Exact validation     | Zero, negative, excessive, malformed amounts; foreign/self counterparties; USD/date/note bounds; R1–R3 policy cases                                                    |
| Authorization        | Absent/forged identity, disabled actor, inactive actor, cross-group node/history/operation access denied under restricted role                                         |
| Duplicate safety     | Concurrent identical keys and restart yield one effect; changed canonical input mismatches; operation kind/group/actor remain separate                                 |
| Recovery             | Lost response before/after commit, long-lived recovery, original outcome versus newer balances; inactive counterparty replay and actor access loss                     |
| Races                | Membership removal/account disable against write; expense versus repayment and distinct repayment attempts serialize; changed obligations do not cap an actual payment |
| Atomicity            | Inject failure at record, audit, revision and outcome stages; no partial effect or orphan success; constraints reject later attachments                                |
| Arithmetic           | Wide intermediate cancellation, aggregate/net/revision overflow, retained inactive history and conservation; no partial settled result                                 |
| Migration/regression | Fresh replay, populated upgrade, desired-schema agreement, expense recovery/cursors unchanged, generation and required CI                                              |
