# Private bank import status

`bankingConnection(connectionId:)` exposes one enabled owner's persisted lifecycle,
retained stream identities and `BankingAccount.importStatus`. It extends the
[enrollment contract](banking-enrollment.md), [selected-account sync consumer](banking-sync.md)
and [C5-v2 reporting plans](banking-replacement.md). It performs no Plaid request.
The authoritative contract is [banking-status.graphql](../../packages/schema/banking-status.graphql).

The known-ID operation requires a connection UUID; `bankingConnections` discovers
retained connections after a fresh login (see below). Existing fields retain their meanings:
`BankingConnection.id`, lifecycle `state`, `generation`, `health`, `cleanup` and
`purge`; `BankingAccount.id` is the logical account, `streamId` is its immutable
provider binding, and `selected` describes future collection. Name, kind, currency,
provider account reference and requested history depth remain enrollment metadata.
Several streams can share one logical account ID across replacement connections.

## Authorization and snapshot lifetime

Every request checks verified authentication and current enabled ownership. Shared
Household/group membership grants no banking access. Missing and other-owner
connection IDs both return `NOT_FOUND` with no connection. Disabled/unprovisioned
actors receive `FORBIDDEN`; unexpected storage failures return `UNAVAILABLE` with
no partial status and one safe `banking.storage` diagnostic. Missing authentication
uses the existing HTTP/GraphQL authentication boundary. Banking UUIDs are not Node
identities and expose no alternate node or nested account lookup.

The service locks the enabled owner against concurrent identity disable, then
reads connection, account, operation and reporting facts in one SQL statement.
The snapshot can precede or follow a competing commit, selection, disconnect or
deletion; it cannot combine their revisions. Disable waits for an already
authorized read, while later requests fail current authorization. A connection
with deleted history exposes only opaque lifecycle/cleanup state and no accounts.
Logical-account deletion barriers also hide that account across replacement Items.
Disconnected or revoked streams retain history and status until explicit deletion.

`connection.snapshotRevision` is an opaque digest of the complete persisted
projection, including operation/retry changes. It is stable for unchanged facts.
Per stream, `importRevision` and `dataRevision` describe committed data, while
`bindingGeneration`, `accountGeneration`, connection `generation` and
`deletionGeneration` fence lifecycle. `reportingRevision` invalidates the logical
account's reporting consumers together. Nullable `planRevision` identifies the
latest published plan; null means the original implicit plan. None grants access
or substitutes for the replacement preview's five confirmation guards.

Poll with a fresh authenticated network read while queued, running, history-pending
or retrying. Honor `retryAt` as the worker's due time; polling never executes a
retry. Stop polling or use a bounded foreground refresh policy after commit or an
attention outcome. Refetch after explicit selection, repair, disconnect, deletion,
replacement publication/recovery, actor changes and foreground invalidation.
Consumers choose their polling interval; this API prescribes no provider polling
or paid refresh. Invalidate all dimensions when the snapshot revision changes.
Request all fields needed for one rendered decision together; cached subsets from
different requests are not a coherent current status or proof of access.

The existing actor-scoped Relay environment keys `BankingAccount` by `streamId`,
so old and staged bindings cannot overwrite one another through their shared
logical `id`. Always select `streamId`. An operation omitting it remains
parent-scoped rather than falling back to a colliding logical ID. Actor disposal
clears the whole store. The compiled
[consumer operation](../../apps/web/src/lib/relay/bankingStatusContract.ts) is a
contract fixture. Mounted Personal inventory and management use their own
feature-owned operations beside the components.

## Independent state dimensions

| Consumer decision        | Fields and meaning                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Initial data absent      | `usable: false`, `importState: UNKNOWN` or `LOADING`; never display zero spending from this fact.                                                                  |
| Waiting/importing        | `operation: QUEUED`, `RUNNING` or `HISTORY_PENDING`; `recovery: WAIT` or `RETRY_SCHEDULED`. Staged pages are private until the entire batch commits.               |
| Durable retry            | `RETRY_WAIT`, `attempts` and nullable `retryAt`; the worker retains its bounded budget and original committed cursor.                                              |
| Operational attention    | `NEEDS_ATTENTION` with `CONTACT_SUPPORT`; no blind new enrollment or attempt-budget reset.                                                                         |
| Reconnect                | `recovery: RECONNECT` from current repair health or an import permission failure; use explicit existing-Item repair.                                               |
| Usable local data        | `usable: true` with `importState: USABLE`; a successful empty batch is usable but says nothing about completeness.                                                 |
| Unknown/limited history  | `coverage: UNKNOWN` or `LIMITED`; inspect independent availability/bounds and historical phase. Neither means a complete reporting range.                          |
| Retained stale history   | `freshness: STALE` with stopped collection, repair/attention or a later provider-failure observation. It remains usable if established; deletion instead hides it. |
| Replacement staging      | `reportingState: STAGED`; usable imports remain noncontributing until explicit plan publication.                                                                   |
| Prior source or recovery | `RETIRED` remains stopped even if its dates reenter the current plan. `intervals` assigns dates once, without extra archive contribution.                          |
| Historical correction    | `discrepancyCount` retains historical/cross-boundary notices; it never silently reconciles them or exposes transaction facts.                                      |

Lifecycle, operation, usability, collection, recovery, freshness and coverage are
separate fields. `operation` describes the current fenced selected-account work, retaining the
`initial_sync` intent identity for both first and incremental passes. Background
notifications and daily reconciliation can return a previously committed stream
to `QUEUED`, `RUNNING` or retry states while `usable` remains true. These operation
changes do not erase committed data or establish fresh bank coverage.
Old-generation work is absent rather than advertised as executable. A stopped
stream reports `STOPPED`; its committed usability, timestamps and coverage bounds
remain visible. `freshness: OBSERVED` means a local timestamp exists, without an
invented age threshold or a promise that the bank is current. `UNKNOWN` preserves
an absent local commit time. A provider failure newer than its last known success
marks usable retained data stale. A successful webhook receipt never establishes
an import commit, usable data, selection or renewed consent.

## History and time provenance

Enrollment's `requestedHistoryDays: 365` is the requested initialization depth,
not retention. `requestedAfter` and `requestedThrough` come from the earliest
persisted initial-import intent for that binding. They are the exclusive/inclusive
UTC calendar dates recorded from enrollment/connection creation, independent of
the owner's reporting timezone and provider availability. They remain null for a
stream with no durable request. Later work does not move this initial window.

`coverageAfter` and `coverageThrough` are separately established actual bounds;
null means unknown. They never come from row extrema. `historyAvailability`
preserves the stored `unknown` or `provider_reported` observation. Known bounds or
provider-reported availability yield `LIMITED`, with no full-range guarantee.
Disconnected, revoked or deselected collection yields `KNOWN_GAP` and preserves any
stored bounds. These are source facts; complete filtered spending/classification
and reporting-range coverage composition belong to the transaction/reporting API.
The status does not invent a historical gap duration or infer a later repaired
stream's continuous coverage from a healthy connection.

`historicalUpdate` distinguishes initial availability from later provider
historical-update completion. `providerUpdateStatus` retains unknown future
provider strings. `historicalUpdateAt` is the local time at which completion was
first committed, independently from actual coverage. `lastLocalCommit` is local
atomic storage time. `providerSuccessAt` and `providerFailedAt` are optional
Item-level observations preceding provider fetch, independently nullable and not
per-account coverage. Timestamps use RFC3339; dates use ISO YYYY-MM-DD. A provider
historical-complete phase, no transactions, or an old observed transaction cannot
prove the requested history is available.

## Synthetic operation and states

This abbreviated operation uses a known synthetic connection identity; select
additional fields from the complete compiled contract when needed:

```graphql
query BankImportStatus($connectionId: ID!) {
  bankingConnection(connectionId: $connectionId) {
    code
    connection {
      id
      state
      generation
      snapshotRevision
      accounts {
        id
        streamId
        selected
        requestedHistoryDays
        importStatus {
          operation
          importState
          usable
          recovery
          coverage
          requestedAfter
          requestedThrough
          historicalUpdate
          lastLocalCommit
          reportingState
          reportingRevision
        }
      }
    }
  }
}
```

For example, `connectionId = "11111111-1111-4111-8111-111111111111"` can initially
return `QUEUED / UNKNOWN / usable:false / WAIT`. During the real worker attempt it
returns `RUNNING`; a not-ready provider response becomes
`HISTORY_PENDING / RETRY_SCHEDULED` with a durable due time. A final empty batch
with a valid checkpoint becomes `COMMITTED / USABLE / usable:true`, while coverage
can stay `UNKNOWN`, coverage bounds and provider timestamps null. A committed
`HISTORICAL_UPDATE_COMPLETE` changes the history phase, independently of coverage.
After disconnect the same stream becomes `STOPPED / usable:true / STALE /
KNOWN_GAP`. After deletion the connection's account list is empty.

## Delivered producers and remaining consumers

The durable first and incremental selected-account imports produce queued/running/not-ready,
retry, reconnect/attention and atomic local-commit facts through the actual
worker. Enrollment/management and verified lifecycle ingress produce selection,
repair health, disconnect/revocation and deletion fences. Restricted sync storage
produces import/data revisions, local/provider observations, discrepancy signals
and historical-update observations. Replacement publication/recovery produces
current/staged/retired contexts and disjoint reporting intervals.

Verified Transactions notifications durably coalesce incremental work, and daily
reconciliation recovers missed notifications through the same consumer. The
one-minute worker poll and daily eligibility interval are operational defaults,
not bank-freshness guarantees. Existing retries and needs-attention work retain
their bounded budgets; status reads themselves never schedule or resume them.
Provider failures and discrepancy outcomes can follow later committed passes.
Exact available-history determination remains separate: current imports leave
actual availability unknown. Limited-availability fixtures demonstrate preserved
status semantics without claiming that exact-coverage producers have shipped. Personal presents the retained connection inventory and these status facts through authenticated Relay reads. The [private reporting API](banking-reporting.md) provides canonical transaction/reporting reads and guarded annotations; Personal Transactions consumes those reads for current/archive browsing and complete server result context; the reusable private detail/editor adds explicit guarded annotations and recovery, while Overview presentation remains separately owned. Retained connection discovery is described below. Enrollment stays
disabled by default; fixtures do not authorize live Plaid work or release.

## Fresh-session connection discovery

`bankingConnections(first: Int = 20, after: String)` discovers the enabled owner's
retained connections without a prior browser connection ID. Pages contain at most
50 connections, ordered by UUID, and reuse the existing `BankingConnection` and
per-account import status contract. Stopped connections retain their history and
status; deleted connections are absent. The default-disabled new-enrollment switch
does not hide existing private connections.

Each page reauthorizes the actor and reads one coherent persisted snapshot without
provider I/O. `endCursor` is an opaque ordering position, not an access token.
Continuation rechecks current visibility, so deletion/access loss takes effect on
the next request; concurrent additions can appear on subsequent pages or a fresh
first page. `READY` with an empty list is a successful empty inventory. Invalid
page sizes/cursors return `INVALID_INPUT`; storage failure returns `UNAVAILABLE`
with no partial rows, cursor or continuation claim. The nullable `institutionName` comes from the existing authenticated provider lookup and is stored within the connection owner/deletion boundary. Legacy rows can lack it; clients must label that absence without guessing. Deletion clears the stored name, and deleted connections are omitted from discovery. Account masks are not part of this stored projection.

Connections keeps selected account scope and attention states visible in compact institution cards. Local-save and provider-success observations are distinct, and the card’s latest observations may belong to different accounts. The Import details disclosure retains each account’s complete import, coverage, requested-history and timestamp facts; a local save or provider observation does not establish complete bank freshness or coverage. Cards use two columns on larger desktop layouts and remain a single flowing column on narrow screens.
