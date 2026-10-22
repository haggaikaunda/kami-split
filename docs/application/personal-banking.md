# Personal banking: planned M1 contract

This approved domain contract describes private **connect and see**.
The [application guide](README.md) identifies the implemented backend subset and
the remaining browser/provider/live-release work.
Product decisions are approved in [C1](https://github.com/haggaikaunda/kami-split/issues/222#issuecomment-6230836850),
[C2](https://github.com/haggaikaunda/kami-split/issues/222#issuecomment-6230848166),
[C3](https://github.com/haggaikaunda/kami-split/issues/222#issuecomment-6230994616) and
[C4](https://github.com/haggaikaunda/kami-split/issues/222#issuecomment-6231114646) and
[C5-v2](https://github.com/haggaikaunda/kami-split/issues/222#issuecomment-6231452324).
The [visual handoff](../design/personal-banking.md) maps the approved R2 design to
production components. [#249](https://github.com/haggaikaunda/kami-split/issues/249)
owns the C5-v2 amendment and independent design acceptance. Scope revision
**plaid-contract-v2 / C5-v2** supersedes C5-v1 whole-dataset replacement; C1–C4
and R2 remain approved. Earlier replacement captures do not verify this amendment.
No speculative runtime SDL, bank connection or live release is created by this
document; implementation and live gates remain with the owning children.

## Product boundary

Support explicitly selected US checking, savings and credit-card accounts with
USD activity through Transactions. A joint-account holder sees the full account
activity privately; do not halve amounts, disclose other connectors or infer a
shared payer. Household/group access never grants banking access.

Request 365 days at initialization. Retain accumulating history; this request is
neither an expiry policy nor proof of full coverage. Disconnect, deselection and
observed external revocation stop affected imports while preserving private
history. Only explicit history deletion erases affected current and archived
history and annotations.
Temporary errors and expired credentials do not delete data.

M1 provides Overview, Transactions, Connections, private single-transaction
editing, background collection and in-app notices. Bulk editing, email/push,
charts, budgets, search, receipts, private manual expenses, account-balance
dashboards and bank-transaction sharing are deferred. Existing shared manual
expense entry, Profile, appearance, groups/trips and ledger invariants remain.

## Spending and classification

**Spending from your accounts** sums posted purchases, bank fees and debit
interest, less identified refunds, in the selected accounts and inclusive period.
It is bank activity, not the eventual allocation-aware cost of a person. Do not
add shared expenses, allocated shares, repayments or reimbursements to it.

Keep provider processing state, activity type, category, exclusion and reviewed
status separate. Pending, removed, excluded, unsupported and unresolved records
do not contribute. Income, transfers, card repayments and cash withdrawals stay
visible separately. A reviewed flag alone does not resolve classification.

Decode the provider's JSON decimal exactly into checked integer USD minor units.
Do not round through an SDK float, take an absolute value to manufacture a
purchase, or convert currency. GraphQL money uses canonical signed minor-unit
strings and existing exact-money bounds. Invalid precision/overflow is an
explicit data error, never a partial successful total.

### Deterministic initial mapping

Pin the provider category request and mapping to PFC v2; retain the original
category, confidence, transaction code and mapping version. The
[official taxonomy](https://plaid.com/documents/pfc-taxonomy-all.csv) supplies
category identifiers, not Kami's spending policy. Use its primary groups as the
initial category choices plus Uncategorized; retain detailed provider categories
in detail. An owner's category choice changes grouping, not activity type or
spending eligibility by itself.

Apply this order:

1. Validate source status, exact amount/currency and account eligibility.
2. Apply a valid owner activity override reviewed against the current material
   source revision. It must satisfy the sign rules below.
3. Otherwise use a recognized, consistent provider transaction code. Refund,
   purchase, bank charge/late fee/returned-item fee, signed interest, cash/ATM
   withdrawal and transfer have explicit meanings. Generic payment, adjustment,
   bill payment, cheque and direct debit alone are insufficient.
4. Otherwise use only HIGH/VERY_HIGH PFC classifications with compatible sign.
   Missing/LOW/MEDIUM/UNKNOWN confidence, unknown taxonomy and conflicting facts
   remain unresolved. A merchant name, description keyword or matched amount
   never proves a refund, repayment or duplicate.

| Provider grouping and compatible sign                                                                                                                               | Default activity / spending                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Positive Entertainment, Food and drink, General merchandise, Home improvement, Medical, Personal care, General services, Transportation, Travel, Rent and utilities | Purchase; include                                                                             |
| Positive Bank fees; interest-charge detail                                                                                                                          | Bank fee or debit interest; include                                                           |
| Negative Income, including tax refunds and interest earned                                                                                                          | Income; exclude                                                                               |
| Transfer in/out, either direction; withdrawal detail distinguished                                                                                                  | Transfer or cash withdrawal; exclude                                                          |
| Loan payments, including credit-card payments; loan disbursements                                                                                                   | Repayment or loan proceeds; exclude; do not estimate an embedded interest component           |
| Government/non-profit, Other, inconsistent or unrecognized cases                                                                                                    | Unresolved unless a consistent explicit code or valid owner override establishes the activity |

A negative amount with a purchase category is not sufficient evidence of a
refund. Require the provider refund code or the owner's explicit refund
classification. Refunds reduce their posting period, even if negative net spending
results. A tax refund is income, not a merchant purchase refund. Uncertain
government/non-profit payments can be classified privately; do not silently
broaden the purchase formula.

Positive values can be Purchase, Bank fee, Debit interest, Cash withdrawal,
Transfer, Repayment or Unresolved. Negative values can be Refund, Income,
Loan proceeds, Transfer, Repayment or Unresolved. Reject incompatible overrides;
zero-valued activity contributes zero and remains separately explainable. A
cashback/purchase mixture or loan payment with embedded interest is not split
without source evidence; unresolved amounts remain reviewable.

A $100 purchase and $40 refund in one month yield $60. If the refund posts next
month, the two months show $100 and -$40. A $100 card purchase plus both entries
of its $100 repayment yields $100, not $200. Both sides of a $500 transfer
contribute zero, even when only one account is selected. A pending $25 purchase
later posted as $27 contributes $27 once. Corrections/removals revise the actual
source period within the binding's reporting ownership. Retired-period and
cross-boundary corrections follow the transition rules below; they are not
synthetic refunds or shared-debt changes.

## Dates, saved preferences and navigation

Personal opens Overview with This month initially. Keep applied period,
account/activity/category filters and origin state across Overview, Transactions
and detail. Connect actions live in Connections; first entry without accounts
shows setup and a route there, not a fabricated zero.

Use the posted bank calendar date for posted rows and period membership. Preserve
optional authorization date in detail. Pending rows use their provider provisional
date, visibly marked Pending; never treat it as a posted spending contribution.
Do not reinterpret date-only values through UTC.

The [reporting-timezone API](reporting-timezone.md) implements the preference
persistence and recovery boundary below; the [private reporting API](banking-reporting.md)
uses that saved zone for preset dates. Account timezone controls and Personal
navigation are implemented; transaction/reporting browser content remains a
separate delivery.

Save a validated IANA reporting timezone once from the initial device setting,
using UTC if unavailable. Account can change it through a dedicated versioned
preference operation, independent of name and appearance saves. Travel does not
change it automatically. It determines today, not a bank date's timezone.

Let T be today's date in that saved zone. Bounds are inclusive:

| Selection    | Start                       | End                        |
| ------------ | --------------------------- | -------------------------- |
| This month   | First day of T's month      | T                          |
| Last month   | First day of previous month | Last day of previous month |
| Last 60 days | T minus 59 calendar days    | T                          |
| Last 90 days | T minus 89 calendar days    | T                          |
| Year to date | January 1 of T's year       | T                          |
| Custom       | Explicit start              | Explicit end               |

Custom input must be real ISO calendar dates in years 0001–9999, start <= end,
and end <= T. Reject missing, reversed, malformed or future bounds with field
errors. There is no arbitrary rolling retention cutoff or maximum span that
makes older retained history inaccessible; bound query resources through indexes,
pagination and request limits. Never clamp a selection to available history.

For T = 2026-10-17, Last 60 days is August 19–October 17 and Last 90 days is
July 20–October 17. For T = 2024-03-01, Last month includes February 29; Last
60 days begins January 2. For T = 2027-01-01, Last month is December 2026.
An October 31 authorization posted November 2 belongs to November regardless
of a later timezone change.

Store preset kind or custom bounds in actor-scoped navigation state. Resolve
concrete bounds and an as-of date once for each read snapshot, echo them from the
server, and reuse them for list/count/summary/pagination. On a new day or explicit
timezone change, resolve presets together and restart pagination; custom dates
stay fixed. Custom drafts change nothing until Apply; Cancel preserves the
applied selection. Logout clears private navigation/drafts and late responses.

## Private model and API boundaries

Keep a narrow banking domain behind authenticated Go operations, restricted
database access and the authoritative GraphQL schema. No browser direct access
to private tables/queues. Do not reuse group authorization for bank data.

| Concept                  | Ownership and purpose                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Banking connection       | Owner, provider environment/user/Item, encrypted credential reference, consent/permission state and lifecycle generation                |
| Internal bank account    | Owner identity and explicit selection; multiple historical provider bindings without fuzzy identity assumptions                         |
| Provider account binding | Connection/account identifiers, selection generation, reporting eligibility and independent sync checkpoint                             |
| Reporting plan           | Versioned disjoint posted-date intervals, owning bindings and captured source revisions; saved predecessor for recovery                 |
| Recovery archive         | Prior reporting-plan/source/annotation provenance and noncontributing retained history; immutable historical snapshot versions          |
| Private transaction      | Binding-scoped provider ID, stable internal ID, exact signed amount/currency, dates, processing state and source revisions              |
| Private annotation       | Owner category/activity/note/exclusion/review values, override provenance, annotation version and material source revision acknowledged |
| Sync checkpoint          | Exact stream identity/cursor, staged batch, observed progress and freshness; never borrowed between bindings                            |
| Banking operation        | Actor/operation/attempt, canonical input digest, state/result and durable recovery/cleanup intent                                       |
| Personal preferences     | Saved reporting timezone and its independent version                                                                                    |
| Deletion barrier         | Minimal owner/opaque target identifiers, generation, time and cleanup state; no retained transaction payload                            |

One private source can later retain a $40 personal portion and fund a $60 shared
expense paid by its importer and owed $20 each by three participants. M1 does not
create portions, shared expenses or financial obligations. A required expense FK,
one-expense-per-source constraint or authoritative isShared flag would block this
future model and is prohibited.

The interface design includes owner-only connection/account/operation-status
reads; start/finish Link and repair; explicit account selection; disconnect;
delete history; Personal preference read/update; paginated transactions/detail;
complete spending/count/coverage reads; and single-annotation update/reset.
These are operation responsibilities, not final runtime field names. New SDL is
introduced with each implemented slice, documented and generated normally.

Every write binds server-derived actor, operation kind and a client-known attempt
ID before the first effect. Same attempt and canonical input returns the original
authorized outcome; changed-input reuse fails. Receipt/status reads reauthorize.
Persist safe original outcomes, then fetch current data. Never infer failure from
a missing browser response or blindly retry with a new key.

Private edits supply expected annotation version and material source revision.
A stale revision returns a conflict with fresh authorized facts while preserving
the user's draft; no last-writer-wins overwrite. Notes are plain text, at most
2,000 Unicode code points; reject control characters except line breaks/tabs.
Category/activity choices are enumerated. Reset clears only the selected override.
Reviewed records the current material source revision, not a permanent boolean
that survives every bank correction.

Provider updates preserve annotations. A changed amount, date, currency, status
or effective classification invalidates reviewed status and any activity override
whose sign/status is no longer valid. Preserve the override visibly but exclude
unresolved material conflicts until confirmed. Notes remain attached to their
source, not a guessed similar transaction. Pending-to-posted linkage is followed
only when the provider explicitly identifies it; keep the old revision and
annotation provenance, recompute eligibility, and require review after material
changes. Unmatched rows are not merged heuristically. Removed sources are
readable as removed history but contribute nothing.

## Complete reads and coverage

Use a shared normalized account/date/category/activity filter for list, total
count, summary and coverage. Queries operate over all matching authorized rows,
not the browser's loaded page. Return positive purchase/fee/interest subtotal,
refund magnitude, signed net, relevant status/review counts, applied bounds,
reporting timezone, data revision and coverage reasons. An activity-only
pending/review view displays its count/context rather than a spending headline.

Use bounded keyset pagination (default 50, maximum 100) over display date and
stable internal ID, both descending. Opaque cursors bind actor, filters,
preference version, reporting-plan version and data revision. A transition,
recovery, annotation, sync or selection change makes
the continuation stale: return an explicit restart result, preserve filters and
refetch coherently. Do not combine pages or totals from incompatible revisions.
Reads use a consistent database snapshot and current authorization. Resolve
each posted row through its plan interval owner; archive references never add a
second contribution. Coverage is composed over those same intervals, including
retired-source freshness and known/unknown gaps.

Coverage has independent dimensions: initial/history import progress, known
requested bounds versus provider availability, selected-account coverage,
classification completeness, last successful local commit, available provider
freshness, and disconnected/revoked gaps. An earliest transaction does not prove
that every earlier day was searched or that a quiet range is complete. Never
label initial history complete solely because a webhook arrived or one page
returned; expose provider historical-update completion separately from verified
coverage. Where the provider cannot establish an exact earliest covered date,
say availability is unknown/limited.

Show known eligible spending with nearby partial/review context when usable
data exists. No accounts, unreadable data, failed aggregates or missing initial
data produce unavailable/setup states, not zero. A fully processed known range
with no eligible contributions can show zero with separate activity counts.
Unknown history and unresolved amounts keep their warnings even when the
eligible subtotal is zero. Overflow fails the aggregate explicitly.

## Lifecycle, jobs and credentials

Reuse the established versioned AES-256-GCM pattern with a separate banking
keyring and authenticated owner/record/environment/purpose context. Runtime
Secret Manager grants are narrow; old keys remain until retained ciphertext is
migrated. Do not reuse invitation keys. Access tokens never reach browsers,
Activity, queue messages or logs. Short-lived Link/public tokens exist only in
the necessary Link/client handoff and encrypted operation storage, with expiry
and cleanup; never browser persistent storage.

Persist intent and queue work atomically. A queue message contains only opaque
operation/binding IDs and versions. Separate API and worker restricted roles
from table ownership/migration access. A worker rechecks enabled owner, consent,
selection and generation before every commit. Disconnect/deletion/deselection
changes the relevant generation before success is acknowledged, so delayed work
cannot resurrect data. Provider calls run outside database transactions.

The lifecycle foundation owns its actual Go queue consumer, verified webhook
ingress, reconciliation and cleanup. The sync slice extends that foundation.
An awaiting-first-import connection is honest before sync exists; durable teardown
cannot depend on the later sync implementation. Do not replace existing invitation
or financial recovery protocols with a new generic framework.

Webhooks require the current Plaid signature/body verification, expected algorithm,
bounded key cache and timestamp validation. Unverified bodies, unknown environments
or mismatched Items cannot write. Acknowledge only durable acceptance; duplicates
and out-of-order notifications cannot undo a terminal generation. Initial worker defaults are a two-minute claim lease with renewal, provider
request timeout of 30 seconds, and at most ten automatic attempts with exponential
backoff from one minute to one hour plus jitter. Respect provider retry guidance;
never exceed its allowed rate to meet a local target. Exhaustion produces a
visible needs-attention state with durable intent retained; an authorized
operator can resume a repaired operation without changing its identity. Poll
due work at one-minute intervals and reconcile healthy bindings at least daily
for missed notifications; these are local scheduling defaults, not bank freshness
promises. A reconciliation sweep
finds due operations/missed notifications without enabling stopped bindings.
Operational retry must recheck lifecycle; poison-message replay is not permission.

Use account-filtered transaction streams from initialization and separate cursors
per binding. Stage all pages under one batch, then atomically apply added,
modified and removed rows and the final cursor after checking its starting cursor
and lifecycle generation. A provider pagination-mutation error restarts from the
original cursor; never expose a half-applied batch. Serialize competing batches
per stream. Pending replacement may span pages. Redelivery has one source effect;
it never implies exactly-once external calls.

Disconnect stops local updates and durably removes the provider Item while
retaining history. Account deselection fences only that account; do not remove
an Item still serving selected siblings. Observed Item/account revocation stops
affected work; absence of a webhook is not proof of continuing consent. Disabled
application identities lose all reads/writes and trigger durable teardown; this
does not add a whole-application account-deletion UI or erase shared ledgers.
Reenabling an identity does not silently restore revoked banking permission.

## Unknown exchange recovery

The provider documents one-use public-token exchange, not a universal exactly-once
replay guarantee. Persisted local intent cannot make a remote success followed by
response loss atomic. Disable transport/SDK automatic exchange retries. Permit one unfinished new-Link
attempt per actor/environment; healthy existing Items remain usable. Expire
unconsumed temporary-token material with the provider lifetime, while retaining
minimal unresolved operation/correlation metadata until verified cleanup.

| Operation state  | Recovery boundary                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Prepared         | Persist actor, attempt, canonical input, provider user identity and unique opaque callback correlation before external effects |
| Exchanging       | One claimed execution; competing callbacks read status                                                                         |
| Ready            | Encrypted access token, Item identity and result durably committed before acknowledging success                                |
| Exchange unknown | Timeout/crash may have consumed the token; no active connection, import or automatic second enrollment                         |
| Cleanup pending  | Positively correlate the affected Item(s), persist their IDs and retry only narrow cleanup                                     |
| Retry allowed    | Confirm identified cleanup and close the old attempt before offering new Link                                                  |
| Needs attention  | Ambiguous/unverifiable result or exhausted recovery remains visible, monitored and non-active                                  |

A supported candidate cleanup adapter creates an idempotently identified provider
user, initializes Link with that user and an opaque attempt-specific webhook URL,
lists its associated Items, and removes only positively correlated Item IDs.
Plaid's [Users API](https://plaid.com/docs/api/users/) documents tokenless Item
removal as restricted early availability. This is a **capability gate**, not a
claim of account entitlement or a token-recovery endpoint.

Before live enrollment, demonstrate the entire lost-response discovery/removal
path in the intended environment, including survival of an unrelated same-user
Item. Verify correlation, eventual removal and delayed callbacks. If unavailable,
a provider-supported alternative must be documented and tested; live enrollment
stays disabled meanwhile. Code can implement the explicit adapter/state contract
and deterministic failure tests without pretending a fixture proves entitlement.

An empty lookup is not proof that no Item was created. Keep abandoned intent for
delayed success; a late token/result enters cleanup, never reactivates a cancelled
or deleted connection. Retry permission must not forget unresolved prior effects.
Do not use broad user-product termination to clean a single uncertain Item.
Unexpected recovery states need safe owning diagnostics without raw bank payloads.

## History-preserving transitions and recovery archives

Prefer repair/update mode on the existing connection. A new Item or changed
account binding can have new identifiers. Names/masks and amount/date/merchant
similarity cannot establish continuity. Require per-account Replace existing,
Different account, or Cancel; only show the actor's own accounts. Distinct logins
at one bank remain possible. Known exact duplicate binding evidence rejects
duplicate enrollment; do not claim universal duplicate detection.

### One versioned reporting plan

For an explicitly confirmed posted-bank date **D inclusive**, preserve the entire
prior canonical reporting plan through D and use the new binding strictly after
D. A plan consists of disjoint date intervals with one reporting owner each,
not a union of all available bindings. Original retained source IDs and their
notes, category/activity overrides, exclusions and review state remain effective
and editable under the existing revision/material-change rules. Never map them
onto guessed replacement rows. History earlier than the new bank's returned
window remains current.

D must be a real ISO bank-calendar date in years 0001–9999, no later than today
in the saved reporting timezone. The latest old posted date may be suggested,
but needs explicit confirmation and proves neither coverage nor a safe boundary.
For a later transition D2, require D2 > D: preserve every earlier interval and
retain the current binding's interval (D, D2], assigning only dates > D2 to the
next binding. Per-account reporting ownership does not change sibling accounts
or independently connected joint holders.

### Stage, preview and publish

Stage a usable import without contributing to standard reads. Keep the prior
plan visible, with truthful stale/repair and coverage context, until confirmation.
Preview D, retained/new/archived row counts and periods, current/proposed totals,
effective versus archive-only annotations, old rows after D, pending activity,
ordinary overlap and known/unknown gaps. Overlap is not proof of duplicate
identity. Neither a successful Link nor the latest transaction date establishes
complete history. An unavailable, failed or unknown import cannot activate.

Confirm with compare-and-swap against the preview's reporting-plan, import,
data, annotation and lifecycle revisions. A changed revision requires a fresh
preview and confirmation; publish the new plan, captured source revisions and
recovery manifest atomically. Freeze the retired binding's captured facts and
fence its account generation so delayed jobs cannot alter canonical preserved
history. Do not stop or remove an Item still serving selected siblings. Invalidate
list/count/summary cursors together. Cancel or a conflict leaves the prior plan
intact; cancellation cannot promise the bank left old OAuth permission unchanged.
Lost responses use durable operation status, not blind replay or fake completion.

### Pending, overlap and historical corrections

Only the active binding supplies current pending rows. Retired pending rows are
archive-only. Existing explicit provider pending-to-posted links apply within
their source identity/provenance rules; no cross-binding heuristic links are
introduced. Posted rows still follow their posted-date interval owner.

Ordinary older overlap in the initial replacement import is excluded by the
ownership rule, not treated as an import error. Later new, modified or removed
replacement records dated in preserved periods remain noncontributing and are
recorded with a historical-discrepancy notice. They do not automatically correct
old canonical rows. Retired-source corrections likewise cannot mutate captured
facts. A fact whose changed posted date crosses a boundary invalidates affected
reads and warns of a possible gap or duplicate; do not silently move ownership,
copy annotations or claim universal deduplication. General record reconciliation
remains deferred. Available amounts keep known/unknown coverage warnings.

### Recovery and annotation ownership

Keep a separate recovery archive manifest with the preceding plan, captured
source revisions, annotation provenance and transition boundary. Its historical
snapshot versions are immutable and contribute nothing a second time. Archive
navigation distinguishes retained rows still canonical today from archive-only
rows. A source row that is both current and archive-referenced has one editable
annotation identity: show snapshot provenance and link to the current row for
edits, rather than creating an independently editable duplicate. Archive-only
rows can retain approved private edits; those edits affect no current totals
until an explicit restoration makes that source current.

Recovery creates a new plan revision after the same usable-data, impact-preview,
confirmation and compare-and-swap checks. Offer changing the latest D (still
after the preceding transition, when present) or restoring the immediately
preceding saved plan. Preview every new-period row and annotation leaving
current reporting, and retain them in the archive; never discard them on recovery.
Restored sources use preserved facts plus their latest valid annotations, not
an old snapshot overwriting newer edits. Missing purged source data blocks exact
restoration. Recovery does not automatically restore provider permission,
selection, credentials, workers or deleted data. Disconnected, stale or partial
status remains truthful. Explicit history deletion covers affected current and
archived private history and annotations, with existing deletion barriers and
sibling/joint-holder isolation; shared ledgers remain separate.

### Worked boundaries and failure cases

| Case                                                                                                                                            | Current reporting and recovery outcome                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D = September 30; original September 20 $100 purchase is excluded and noted; new import has another September representation plus October 2 $50 | Keep the original exclusion/note; exclude the replacement September row. Combined spending is $50. Archive adds nothing.                                                             |
| Posted September 30 versus October 1 with D = September 30                                                                                      | Prior plan owns September 30; new binding owns October 1, regardless of authorization dates.                                                                                         |
| Old June history; replacement only returns September onward                                                                                     | June remains in normal reports under the prior plan, with its annotations and truthful captured-source freshness.                                                                    |
| D = September 30; replacement coverage starts October 3, or its start is unknown                                                                | October 1–2 are a known gap only if coverage establishes that gap; otherwise availability is unknown. Never claim a complete period from visible rows.                               |
| New binding's October 2 row later changes to September 29, resembling an old row                                                                | Do not infer identity or repair either source automatically. Record the discrepancy, invalidate reads and warn of a possible gap/duplicate.                                          |
| Retired pending September 30 later appears posted October 1 on the active binding                                                               | Retired pending stays archive-only; the active posted source can contribute under its own explicit identity/link rules. No heuristic annotation transfer.                            |
| A → B at September 30, then B → C at October 10                                                                                                 | A owns dates through September 30, B owns October 1–10, C owns October 11 onward. Keep earlier intervals intact.                                                                     |
| Change latest D from October 10 to October 12, or restore the preceding A/B plan                                                                | Preview affected B/C rows and annotations; publish a new revision and archive everything leaving current. Retain latest valid edits; do not restart B's provider work automatically. |
| Import fails, user cancels, or annotation/lifecycle changes after preview                                                                       | No partial plan switch. Preserve prior history; refresh a conflicted preview before confirmation. A purged predecessor blocks exact restoration.                                     |

[#250](https://github.com/haggaikaunda/kami-split/issues/250) owns persisted plans,
archives, activation/recovery and lifecycle fences, verifiable with controlled
stored import fixtures before [#251](https://github.com/haggaikaunda/kami-split/issues/251)
adds real ingestion/correction fencing. [#252](https://github.com/haggaikaunda/kami-split/issues/252)
owns coherent timeline/annotation reads; [#258](https://github.com/haggaikaunda/kami-split/issues/258)
owns management preview/recovery; #254/#259/#260 own display and #255 integrated
verification. This contract does not start those implementation slices.

## Deletion, backup and live rollout

Explicit deletion immediately hides affected private content and increments a
durable barrier. Bounded resumable work purges source history, revisions and
annotations; provider teardown may remain pending and is shown separately.
Retain credentials only as long as required for teardown, then destroy them.
Preserve only opaque operation/deletion metadata needed to prevent resurrection.
An operation receipt cannot retain deleted financial payloads as an exception.

Retained private data has no automatic 365-day expiry. Deletion-barrier retention
must cover every backup capable of restoring that data and unresolved provider
cleanup. Configure a verified backup maximum age before enabling live enrollment;
do not choose an invented expiry. Restore into isolation, replay the independent
deletion journal and validate lifecycle barriers before exposing data or enabling
workers. If journal completeness cannot be established, restoration remains
unavailable. Provider retention and backup expiry are distinct from deleting
Kami's active copy; promise neither instant all-copy erasure nor unverified
recovery objectives.

Use Sandbox and synthetic evidence first. Live rollout requires explicitly
approved participants, provider/institution eligibility, Transactions-only
configuration, cost/connection limits (new enrollment stays disabled if unset),
consent/privacy text compatible with
retention after revocation, verified backup/restore and unknown-exchange cleanup,
environment/secret isolation, monitoring ownership and disable procedures.
New-enrollment disable and sync stop controls are separate from retained-history
reads; rollback cannot undo deletion fences. Do not purchase paid refresh,
extra products, PITR or resources under design authority.

The worker exposes safe queue age, retry/needs-attention counts, import lag and
cleanup progress. UI reload reads stored data and never promises immediate bank
refresh. Final live operational targets depend on verified provider behavior and
the approved pilot; passing local/Sandbox tests does not establish them.

## Provider references

Provider facts must be rechecked during adapter implementation. Kami's product
rules above govern where a provider's presentation recommendation differs.

- [Transactions API](https://plaid.com/docs/api/products/transactions/): history,
  dates, amount direction, categories and account-specific cursors.
- [Transaction states](https://plaid.com/docs/transactions/transactions-data/):
  pending/posted and source revisions.
- [Duplicate connections](https://plaid.com/docs/link/duplicate-items/) and
  [update mode](https://plaid.com/docs/link/update-mode/): repair and relinking.
- [Items](https://plaid.com/docs/api/items/) and
  [Users](https://plaid.com/docs/api/users/): teardown and capability-gated recovery.
- [Webhook verification](https://plaid.com/docs/api/webhooks/webhook-verification/)
  and [delivery](https://plaid.com/docs/api/webhooks/): authenticated durable ingress.
