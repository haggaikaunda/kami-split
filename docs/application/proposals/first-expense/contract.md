# Proposed #76 expense contract

> References to keeping or isolating the seeded runtime record the original milestone scope. #184 subsequently retired that runtime and simulation-only tests; these references do not require executable preview retention.

Status: finalized design, not runtime implementation; [SDL](schema.graphql) and [operations](operations.graphql) are
not imported by running schema generation. #82 promotes only approved implemented
fields. [Shared S1–S4](shared.md) defines identities, disclosure, locks and complete
balances. [Owner decisions](https://github.com/haggaikaunda/kami-split/issues/76) are recorded; final-head delivery verification remains required.

## A1: Exact scalar and field rules

MinorUnits accepts only GraphQL String literals and JSON strings matching
`^(0|-[1-9][0-9]*|[1-9][0-9]*)$`, ASCII, maximum 20 characters, parsed with checked
int64 conversion. Range −9223372036854775808 through 9223372036854775807. No
numbers, `-0`, `+1`, leading zeros, whitespace, decimal/exponent notation, Unicode
digits, NaN or infinity. Serialize canonical decimal strings only.

| Field                    | Additional bounds                         |
| ------------------------ | ----------------------------------------- |
| expense total            | 1..999999999                              |
| exact allocation         | 0..expense total; sum equals total        |
| totalExpense, paid, owed | 0..9223372036854775807                    |
| net                      | −9223372036854775807..9223372036854775807 |
| obligation               | 1..9223372036854775807                    |

The scalar can parse int64 minimum, but no balance can reach it under bounded
nonnegative aggregates. PostgreSQL `sum(bigint)` returns numeric; calculate sums
and differences in exact numeric, range-check before Go int64 conversion.
Go uses checked addition/subtraction; simplification never negates int64 minimum.
A future write whose candidate complete projection exceeds any bound returns ValidationProblem with field code AMOUNT_OVERFLOW and writes no
expense/allocations/audit/success operation record. Store that definitive rejection in the
attempt row under the same accepted operation-record retention rule as other domain
validation rejections. Reads
with corrupt/out-of-range data return AMOUNT_OVERFLOW, never truncated totals or
partial zero positions. Sum all nets using exact/wider accumulation; arbitrary
iteration order must not overflow a valid zero conservation sum.

Relay custom scalars: MinorUnits, Revision, Date, DateTime, OperationKey map to
TypeScript `string` on the wire. Boundary parsing brands validated strings;
financial arithmetic converts to `bigint`, never `Number`/parseFloat. Entered USD
text permits ASCII digits with zero to two decimals (e.g. `12`, `12.3`, `12.34`),
no exponent/group separators/sign; exact allocation allows zero. Trim surrounding
ASCII spaces explicitly in the form, split dollars/cents, then BigInt arithmetic.
Wire output uses canonical cents. Format negative sign and absolute bigint
quotient/remainder by 100, grouping whole-dollar digits as strings; never feed
an unsafe cents Number to Intl. `9007199254740993` remains exact; USD display is
`$90,071,992,547,409.93`. `1000/3` gives 334/333/333 by S1.

Date accepts only valid Gregorian `YYYY-MM-DD`, years 0001–9999, no timezone.
No future-date ban is invented; this matches the form's date requirement.
DateTime output is UTC RFC3339 with six fractional digits and Z. Revision is a
nonnegative canonical decimal string bounded to int64 max, not GraphQL Int;
It tracks only the group financial projection per S4, not response metadata;
revision exhaustion rejects a financial write. OperationKey is lowercase canonical UUID v4
with valid variant, CSPRNG `crypto.randomUUID()` before first submission.

Description is trimmed of leading/trailing ASCII space/tab/CR/LF, 1–120 Unicode
scalar values after trim; note preserves content, 0–2000 scalar values (default
empty). Reject NUL and unpaired surrogates; do not silently NFC-normalize or alter
note whitespace. This clarifies the preview's UTF-16 length ambiguity; #83 must
count code points consistently. Seven category enum values map to existing labels
Dining, Groceries, Accommodation, Transport, Activities, Home, Other.

Single payer must be enabled, actively linked and a member of the explicit group;
payer need not be a participant or creator. Creator is the authenticated member.
Participant IDs must be nonempty, distinct, same-group, active and enabled. Equal
requires exactAllocations absent/null (not client-calculated amounts); exact
requires exactly one amount for every participant, including zero, no extras.
Zero-share members remain allocations/participants in reads and filters.
No multipayer, trip, settlement, edit/version/delete, transfer or setup input.
Request body/query-cost caps are operational #82/O15 work; reject over-budget
requests explicitly, never silently truncate the complete balance/member list.

## A2: Reads, pagination and consistency

Unauthenticated/expired/malformed credentials yield HTTP 401 plus safe GraphQL
error `UNAUTHENTICATED`, no financial data; verification infrastructure unavailable
is HTTP 503 `UNAVAILABLE`. A valid token may produce ViewerAccess DISABLED or
UNPROVISIONED, disclosing only the caller's state. Enabled user with no memberships
gets Viewer with `groups: []`, not a manufactured household/setup action. Groups
lists only active memberships, sorted canonical group ID. A group selection never
substitutes for explicit mutation/recovery groupId. Member field policy is S2.

Expenses ordered by effectiveDate DESC, immutable createdAt DESC, UUID DESC.
Forward-only `first` 1..100, default 20; reject 0/negative/>100, no unbounded or
backward request. Filters: inclusive from/to dates, one category, one participant
membership (includes zero share, not payer-only); AND together, from<=to. No
filters means all group expenses. Wrong-group participant filter is NOT_FOUND,
not an existence leak. No totalCount or filtered balances.

Proposed cursor: base64url (no padding) of versioned compact JSON plus HMAC-SHA256,
containing group UUID, canonical filter tuple, anchor revision, last effectiveDate,
createdAt and expense UUID. Key ID prefix selects a configured signing key;
compare MAC constant-time before interpreting fields, cap token at 2048 bytes.
No credentials in cursor. First page records current group financial revision R;
subsequent pages enforce expense creation revision <= R and strict tuple `< last`.
The anchor bounds financial inclusion only: it does not freeze profile labels,
membership/account state or authorization across pages. Each page reauthorizes
and can return updated non-financial fields at the same financial revision.
This is a bounded append-only traversal: an expense committed later, including a
backdated one, is omitted until restart. No open DB snapshot spans requests.
Only create exists initially; future edit/delete requires revisiting the cursor
contract before publication. Ties have the UUID tie-breaker. Query `first+1` for
hasNextPage; empty page startCursor/endCursor null. Nonempty startCursor is the first edge
cursor. hasPreviousPage is false for the first page; for an after cursor, use an
EXISTS probe for an eligible tuple at or above the cursor boundary under the
same filters/anchor. Only forward request arguments are supported. A no-longer-existing boundary row need not
be fetched because tuple is embedded. Bad MAC/shape/version/filter/group or
future revision yields INVALID_CURSOR after group authorization. Signing-key
retirement produces INVALID_CURSOR; restart list, never restart a financial write.
No time-based cursor expiry promised. Keep previous signing keys during planned
rotation; a server restart must preserve configured keys.

FirstPage reads balances and expense page in one complete SQL statement after locked, fresh authorization; balances
always include all committed financial records in that snapshot. On later pages,
connection revision R can be older than current balance revision. This difference
is explicit, not a snapshot guarantee across requests. Concurrent create committed
after the read is absent from both fresh projections until next read. Current
reads can change after any response. No mutation returns a supposedly current
balance; success/recovery causes #83 to refetch group balances and reset the
expense connection. Balance revision identifies the financial projection read;
it is not a cache validator for member labels, eligibility or access. After
recovery, even an equal revision requires the normal authorized refresh; never
skip it or retain private data because the revision matches. Non-financial
changes use ordinary refetch/session invalidation rather than a new global
version counter. A failed refresh shows unavailable/stale UI, never settled.

## A3: Errors and disclosure

GraphQL parse/validation/scalar coercion failures: HTTP 400, safe BAD_USER_INPUT,
no execution. Domain results use HTTP 200 unions so expected outcomes survive
selection-set changes, except the Relay connection boundary described below. Invalid semantic input yields ValidationProblem paths
such as `["input","exactAllocations","1","amountMinor"]`, stable code and safe
human message. Malformed public ID is INVALID_INPUT; well-formed nonexistent or
unauthorized ID is NOT_FOUND for both. No cross-group names, peer identities,
SQL, stack traces or credentials in messages. `node` returns null for unauthorized
or missing ID; malformed input uses BAD_USER_INPUT. Infrastructure node failures
use GraphQL UNAVAILABLE errors, never indistinguishable successful null.

Domain unavailable reads use Problem UNAVAILABLE. Post-execution financial
transport interruption means UNKNOWN regardless of a 503 or timeout; client must
recover. Domain rejection is definitive only when its union was received or
retrieved durably. Unsupported edit conflicts/deleted outcomes are not exposed
in this create-only SDL. OperationMismatch is the create-specific conflict;
unknown enum/scalar errors are not durable operation records because execution never began.
Permission loss on a operation record lookup returns NOT_FOUND without revealing whether
the key exists. Key possession never overrides current account/membership checks.

## A4: Attempt scope, canonical comparison and atomicity

Unique DB attempt key: `(actor_user_id, group_id, operation_kind, key_uuid)` with
kind CREATE_EXPENSE fixed by these operations. Actor is server-derived; same key
in another actor/group is a separate attempt and conveys no access. Canonical
payload is versioned `create-expense-v1` with group, USD, total, trimmed description,
date, category, exact note, payer, split, sorted participants and sorted exact
allocations. Absent/null exact allocations normalize identically for equal;
empty list is invalid. Note omitted/default empty compare identically. Equal and
exact remain different intent even if allocations match. Decode/validate IDs
before canonicalizing. Encode a fixed-position JSON array of primitives using
specified UTF-8 escaping (JSON controls/quote/backslash, no optional slash or
non-ASCII escaping), hash SHA256, and compare stored canonical bytes as well as
hash to avoid relying solely on collision resistance. Retain canonicalization
version with operation record; deployments must compare old versions correctly.

Acquire S3 user/group locks and recheck authorization; claim unique attempt row
in the same transaction. A concurrent same-key request waits on database lock
(deadline-bounded), then compares canonical input and returns original stored
outcome. If no row, validate state under locks; either store definitive validation
rejection, or insert expense, explicit allocation rows, audit actor/event and
immutable successful operation record atomically. No committed PENDING row in this design.
Conflict rollback/failed commit never leaves half an expense or an orphan success.
A database connection loss around COMMIT is UNKNOWN; repeat lookup/retry with the
same key/input after current authorization. Do not detach work from request
cancellation; durability comes from database commit, not background goroutines.
Same-key changed input returns OperationMismatch and never edits/replaces expense
or operation record, even if new input would now be valid. Corrected definitive validation
uses a new key. An unresolved original remains frozen; do not let a new key
silently abandon it. Malformed input rejected before a canonical attempt exists
can be corrected, but #83 should use a fresh key for the corrected intent.

Authorized retry checks for an existing operation record before rechecking historical
payer/participant eligibility: later participant inactivity must not invalidate
an original successful operation record. Actor must still have current enabled active
access. Helpers therefore need a operation-lookup phase with actor/group locks
before locking all new-write participants; release and restart in S3 lock order
when new work is required, then check operation record again. Never acquire participant
user locks after group lock. Operation record contains immutable original IDs, financial
values, description/date/category/note, audit commit timestamp and the financial revision produced by that operation; no
current profile objects or balance snapshot. Nested operation record IDs are values,
not an authorization shortcut. Operation record revision is immutable historical financial
provenance, never the latest response version. Current Expense and balances come from separately
authorized reads, and may differ after future authorized edits.

## A5: Recovery states and accepted retention

| Result/state      | Meaning and permitted client action                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| ExpenseCommitted  | Original expense/operation record committed; fetch current node and complete group balances                  |
| ValidationProblem | Definitive rejected attempt, no expense from it; corrections are a new key                                   |
| OperationMismatch | Key already bound to different canonical input; restore original input and recover, never overwrite          |
| NOT_OBSERVED      | No visible durable result at lookup snapshot; might be an in-flight transaction; same key/input retry only   |
| PENDING           | Request demonstrably waiting on another attempt/group lock in this server call; transient, not durable claim |
| UNKNOWN           | Infrastructure could not establish outcome; preserve key/input and retry lookup later                        |
| NOT_FOUND         | Missing group or no current authorization; hide operation record and block financial retry                   |

PENDING need not be emitted unless contention can be identified safely; ordinary
lookup while an uncommitted attempt is invisible reports NOT_OBSERVED. Server
restarts erase transient observations, not durable results. Missing is never
called “not started” as the preview currently does.

**Owner-approved P2:** retain financial operation recovery records and the
information needed to recognize/recover the original attempt for the lifetime
of the associated financial history. This includes canonical input/version,
actor/group/operation/key binding, original successful result and definitive
rejection outcomes. Keep rejected-attempt records with the target group's
history even when that attempt created no expense; there is no initial pruning.
No 90-day expiry, cleanup job, record-to-tombstone transition or EXPIRED outcome
is part of this protocol. Same-key recovery and mismatch protection do not expire
while that history remains. Test recovery well beyond 90 days and after restart.

[Owner authority](https://github.com/haggaikaunda/kami-split/pull/95#issuecomment-5901138197). Group/account deletion, archival and
pruning remain future lifecycle design. Before any such deletion could remove
uniqueness/canonical data, its reviewed protocol must preserve duplicate safety;
this contract does not authorize purging history or reuse of old keys. Missing
lookup remains NOT_OBSERVED, never proof of no commit or permission to mint a
replacement key. Authorization remains current even for old operation records.

These **operation recovery records/idempotency results** are not uploaded receipts.
Images/PDFs, file/object storage, attachment metadata, OCR, upload UI and attachment
retention are explicitly deferred and not part of #73/#76/#82.

**Client P3 owner-approved direction (2026-09-29):** sessionStorage holds versioned
actor/group/key/canonical payload/status for submitted unresolved attempts and
ordinary drafts, scoped to a tab and stable user. No time-based client expiry is
introduced by P2: submitted attempts remain available while that tab/session
retains them, with the server record retained with financial history. This does
not promise cross-device recovery or browser storage beyond the approved session
boundary. It survives reload in that tab, not tab close/device loss. Navigation preserves
it. Logout/account switch clears private state and replaces Relay per ADR-002;
late responses cannot repopulate a new epoch. Reauthentication of the same actor
within the live session can resume only after fresh authorization. Do not claim
recovery after logout or tab loss when key/input are gone. Warn before closing an
unresolved attempt and direct a returning user to inspect current history, never
automatically recreate based on matching date/amount. If owner wants cross-device
or post-logout recovery, design an authorized server attempt inbox separately.
No automatic resubmission on authentication refresh. Resume requires original
scope, frozen input and a user recovery action; repeated network recovery never
mints a fresh key. Existing local session-only preview remains unchanged.

## A6: Example inputs and observable outcomes

IDs below abbreviate S1 canonical IDs as G, A, B, C in prose; actual operation
variables must contain the full canonical strings.

Equal Save: G, random precreated key K, USD `"1000"`, description `"Dinner"`,
2026-09-29, DINING, note `""`, payer C, participantIds [B,A,C], EQUAL, no exact
allocations. Creator A is independent of payer C. Operation record allocation order is
[A:334,B:333,C:333]. Positions: A=-334,B=-333,C=667; obligations A→C334,B→C333.
Exact Save: total `"1000"`, payer C, participants A/B, allocations A `"1000"`,
B `"0"`; both remain participants. C need not owe a share. Negative share and
sum `"999"` produce field validation; EUR fails enum validation before execution.

Example domain response selections:

```json
{
  "createExpense": {
    "__typename": "ValidationProblem",
    "fields": [
      {
        "path": ["input", "totalMinor"],
        "code": "OUT_OF_RANGE",
        "message": "Use 1 to 999999999 cents."
      }
    ]
  }
}
```

```json
{
  "createExpense": {
    "__typename": "OperationMismatch",
    "key": "d72b513e-04ea-42db-9d80-1a048a26d905"
  }
}
```

Lost response after commit: Recover(G,K) returns ExpenseCommitted with original
expense ID, even after another expense changes group revision. RefreshAfterRecovery
queries that node and complete balances at current revision. Two same-key requests
and a process restart still find one expense/audit. Changed note with K mismatches.
A revoked member receives NOT_FOUND, even possessing K. Missing lookup is
NOT_OBSERVED and allows only same-key retry. After 90 days or later, the original
record still recovers under current authorization while financial history remains.

## A7: Field-to-UI trace and deliberate migration boundary

| Actual consumer                                                                                                                     | Contract projection/operation                                         | #83 adaptation                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `lib/data/port.ts` read Snapshot / household/actor                                                                                  | Viewer, groups, Group.viewerMembership                                | Replace whole-snapshot assumption with explicit authorized group state           |
| `components/data-provider.tsx` refresh/scope invalidation                                                                           | Entry, FirstPage, RefreshAfterRecovery                                | Preserve session epoch, scope and stale-response checks; no mixed real/demo data |
| `lib/expense-draft.ts` default payer/participants                                                                                   | viewerMembership, members.canParticipate                              | IDs are Membership IDs; eligibility is advisory, checked again on server         |
| `components/expense-create/form.tsx` amount/date/description/category/note                                                          | all corresponding CreateExpenseInput and Expense fields               | Exact bigint previews; code-point limits; local date default                     |
| form equal/exact/payer/zero participants                                                                                            | split, explicit participantIds, exactAllocations; Expense.allocations | Do not infer participation from nonzero shares; server computes equal remainder  |
| `lib/overview.ts`, `components/overview.tsx` net/obligations/spending                                                               | GroupBalances positions, obligations, totalExpenseMinor, settled      | Remove direct-debt inference; include inactive history; never compute from page  |
| expense cards/creator attribution                                                                                                   | Expense.payer/creator/allocations and description/date/category       | Current minimal labels, durable IDs                                              |
| create controller/session drafts and the [current recovery contract](../../persisted-expenses.md#transaction-and-recovery-boundary) | key before Save, Recover, operation record then refresh               | Replace mock not-started with NOT_OBSERVED; frozen attempt/provenance            |
| `lib/ledger.ts` exact/remainder                                                                                                     | MinorUnits bounds, S1 ordering                                        | Existing safe-number code cannot be reused for arbitrary aggregates              |

First real route slice is group selection, expense list/create and complete balance
panel with explicit recovery. Hide/label demo-only activity/revision history,
monthly reporting, trip controls, pending-member simulation, settlements,
edit/delete, setup and ownership controls; do not fabricate data for them.
This is owner-approved O14 scope decision P4 (2026-09-29), not a claim of full
preview parity.

## Technical references

[GraphQL scalars](https://spec.graphql.org/September2025/#sec-Scalars) require
custom coercion beyond SDL validation; [PostgreSQL aggregates](https://www.postgresql.org/docs/17/functions-aggregate.html)
define numeric output for bigint sum. Both checked 2026-09-29. SDL validation proves
schema/operation shape only; #82/#83 must implement and test all scalar and runtime
semantics above. No generator/runtime schema is altered to obtain validation.

## A8: Relay connection and pagination errors

`Group.expenses` returns nullable concrete ExpenseConnection with standard edges
and complete PageInfo, enabling Relay `@connection`/`usePaginationFragment` in
#83. Proposed operations omit Relay compiler directives so the server-side
validator can check them without installing Relay. #83 annotates the concrete
field, keeps filter arguments in the connection identity and resets it after a
new create/recovery; cursor/first are pagination arguments, not filter identities.
On invalid pagination input, cursor, unauthorized filter, aggregate revision
failure or unavailable infrastructure, return expenses:null plus a safe GraphQL
error at that field path with INVALID_INPUT, INVALID_CURSOR, NOT_FOUND,
AMOUNT_OVERFLOW or UNAVAILABLE code. #83's network adapter must preserve partial
data and these errors and show a failed page, never an empty list or page-complete
state. A successful empty connection has edges:[] and valid PageInfo, no error.
This narrow transport exception avoids a union where Relay requires a connection
object. Complete balances retain their explicit union and independent semantics.
See [Relay connection specification](https://relay.dev/graphql/connections.htm)
and [pagination](https://relay.dev/docs/guided-tour/list-data/pagination/).
