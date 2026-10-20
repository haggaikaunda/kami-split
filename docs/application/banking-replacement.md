# Private banking replacement and recovery

The owner-only backend in `internal/banking` implements explicit staging,
complete impact preview and guarded publication of disjoint posted-date plans.
It extends [enrollment](banking-enrollment.md), [private storage](banking-storage.md)
and the [lifecycle worker](banking-worker.md). It does not implement provider
transaction ingestion, general transaction/annotation reads or edits, browser
management, or the separately required live-provider release gates.

## Entry and collection authority

Prefer existing-Item repair. `startBankingReplacement` requires a client-known
attempt UUID and the enabled owner's explicitly selected logical account UUID.
It uses the same protected Link reservation, single exchange claim, positive
actor/attempt-scoped Item discovery and uncertainty/cleanup path as ordinary
enrollment. Finish with `finishBankingEnrollment`, selecting exactly one
server-authorized compatible USD account. Its binding belongs directly to the
chosen logical account and starts `staged`; successful Link does not publish
reporting or assert usable data. Generic `EXISTING` enrollment without an explicit
target continues to return `REPLACEMENT_REQUIRED` and clean up.

Exact provider identities are registered once per owner/environment/institution
and logical account. Explicit replacement can preserve that identity across
several bindings of the designated account; a different account cannot claim it.
The registry is private even from API/worker table reads and is deleted with its
logical account. Display names, masks and transaction similarity grant no
continuity. Target lifecycle fences are captured at start and rechecked at finish;
a late finish cannot cross deletion, stop or revocation.

A retained deselected account can be chosen explicitly. Positive new provider
selection permits the staged binding to collect; old deselected streams remain
stopped. Publication retires the former reporting binding, advances its generation
and permanently blocks source writes through that binding. Existing-Item repair
and selection cannot reactivate a retired binding. The old Item can continue
serving selected siblings. Empty or subset selection stops each omitted current
or staged binding on the managed Item. A different Item's current or staged
binding can retain the logical account's selection and history. Offline removal
uses only effectively selected, nonstopped current/staged bindings; reselecting a
stopped or revoked binding requires positive server-observed provider inventory
and the existing lifecycle generation check. Cancellation fences the staged binding and queues
narrow teardown when its Item serves no collecting sibling; it never attests
unchanged OAuth permission or completed removal.

## Preview, confirmation and status

`bankingReplacementPreview` accepts `ACTIVATE`, `CHANGE_BOUNDARY` or
`RESTORE_PREDECESSOR`. It reads one coherent persisted snapshot and returns all
five opaque revision digests (plan, import, data, annotation and lifecycle), the
shared reporting revision, proposed date intervals and complete prior/proposed,
retained/new/archive-only/overlap/old-after-D impacts. Each impact includes counts,
observed date span, exact signed USD minor-unit spending, effective annotation,
pending and unresolved counts. Observed rows never establish provider coverage.

Dates are strict ISO posted-bank dates in years 0001–9999, at most today in the
saved reporting timezone. The minimal production image uses IANA timezone data
embedded from the pinned Go toolchain; updating that toolchain refreshes this
fallback database. Development hosts can use their system timezone data first.
D is inclusive for the complete prior plan; the staged
binding owns dates strictly after D. Later transitions preserve every preceding
interval and require an increasing boundary. Boundary recovery changes only the
last boundary and cannot cross the preceding transition. Restoration selects only
the immediately preceding saved plan. Authorized non-ready previews still return their revision guards so an unusable
stage can be cancelled. Denied, missing and unavailable account responses expose
no guards or impacts. Unknown coverage remains distinct from
unknown, failed, loading or unavailable import usability; only usable persisted
imports can publish. Known coverage remains partial or explicitly gapped.

The preview uses source IDs and latest annotations acknowledging the relevant
material revision. Explicit valid purchase, bank-fee and debit-interest amounts
contribute positively; refunds contribute negatively. Other activity, excluded,
pending and unresolved rows contribute no spending. Ingestion/classification is
separate; controlled persisted import facts and annotation revisions exercise this
contract without adding production banking seed data. Unclassified source facts
are exposed as unresolved counts, never silently treated as known zero activity.

`confirmBankingReplacement` submits the exact request, five digests and a
client-known attempt UUID. The application derives the proposal again; the database
locks lifecycle resources, compares the complete persisted state and atomically
publishes immutable intervals, source captures, archive provenance and retirement
fences. Any changed dimension requires a fresh preview/confirmation. Each
publication increments the account's shared reporting revision for downstream
list/count/summary cursor invalidation. Source, annotation and lifecycle changes
also advance that revision.

`bankingReplacementOperation` reauthorizes and returns only the original durable
opaque plan/binding outcome. Identical confirmation retries recover that outcome;
changed-input attempt reuse conflicts. Missing status does not prove failure.
There is no provider I/O inside publication. Unexpected failures are consumed once
through the existing safe `banking.storage` diagnostic boundary.

## Recovery, discrepancy and deletion

Captures freeze source revisions, while annotations retain their original source
identity. Archive references add no second contribution or independent edit copy.
Recovery reads preserved facts and latest valid edits; it never overwrites newer
annotations with snapshot annotations. Every source leaving current reporting is
retained by immutable plan/archive provenance. Retired pending is archive-only.
Stored historical/cross-boundary discrepancy states remain visible in preview;
when a captured source has such a notice, a new revision cannot silently replace
its captured fact. The future importer must persist these states and extend these
fences for real provider corrections.

Recovery only publishes reporting ownership. It does not restore credentials,
consent, selection, collection, deleted history or stopped provider work. Required
missing captures prevent exact predecessor restoration. Permanent account barriers
hide all current/staged/archived records immediately. The existing bounded worker
purges captures, annotations, facts, plans, bindings, account payloads and exact
identity registrations across replacement Items; opaque receipts retain no facts
or notes. Shared ledgers, other logical accounts and independently connected joint
holders keep their existing boundaries. Provider retention and backups remain
separate from active-copy purge.
