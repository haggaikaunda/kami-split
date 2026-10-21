# Private banking transaction sync adapter

`banking.PlaidProvider.SyncTransactions` supplies validated private changes for
one explicitly selected account binding. It is an internal provider boundary;
restricted atomic batch persistence is implemented below. Scheduling, public
status and the browser transaction journey remain separate work. The existing worker does not
call this adapter. Enrollment remains disabled by default.

The adapter uses the existing protected HTTP client and `Plaid-Version:
2020-09-14`, official Sandbox/Production HTTPS hosts, no redirects, a 64-KiB
response limit and one shared 30-second deadline. It performs an exact `/item/get`
identity check before `/transactions/sync`, since sync does not return an Item.
This extra read also supplies optional Item-level last-successful/failed update
timestamps. These observations precede the page; they do not establish committed
import freshness, per-account coverage or an institution's current balance.

## Authority and checkpoints

The caller obtains the credential through the existing protected ownership and
environment boundary and supplies a server-derived `SyncBinding` containing the
local binding, environment, Item and selected provider account. The adapter checks
environment, credential Item identity and exact response account identities. It
does not grant consent or selection. The persistence boundary rechecks lifecycle generation and selection at commit,
after network calls outside database transactions.

Every sync request uses `options.account_id` and count 20. The small page size
leaves headroom within the existing body limit; a large provider payload can still
exceed it and fails without returning changes. `NewSyncCursor` requires the exact
binding. Empty initializes a stream; a nonempty value may only be restored from
trusted storage containing a cursor previously returned for that account-filtered
binding. The zero value is invalid. The adapter rejects `now`, which skips history,
and never converts an Item-wide or sibling cursor into an account cursor. The
provider does not expose cursor provenance for independent inspection; trusted
storage must preserve that provenance. Changing account filtering requires a new
empty stream, never reusing an Item-wide checkpoint.

Enrollment requests 365 days through `transactions.days_requested` in Link. Sync
does not repeat or change this initialization request. It neither guarantees 365
days of available history nor imposes a 365-day retention limit.

## Facts and complete batches

Pages preserve separate added, modified and removed changes, exact case-sensitive
identities, pending state, optional pending transaction linkage, bank calendar
dates, optional authorized dates, names, merchant names and provider transaction
codes. Missing/null optional values remain nil; unknown optional status and code
strings remain unchanged. No original purchase identity is invented. Negative
amounts include deposits, payments and refunds; the adapter does not classify all
credits as refunds or match transactions by amount, date or name.

USD amounts pass from the JSON numeric lexeme through bounded exact integer
arithmetic to signed int64 minor units. Positive means money leaves the account;
negative means money enters it, including credit card payments. Exact exponent
notation and trailing decimal zeros are accepted. Fractional cents, overflow,
quoted/malformed numbers, non-USD or unofficial currencies and invalid date-only
values reject the whole page. No binary float, rounding, timezone conversion or
FX participates. Account eligibility remains the enrollment/selection contract:
USD checking, savings and credit card accounts.

A removal may contain only `transaction_id`; its enclosing page supplies the
authorized binding. Consumers must key deletion by binding plus transaction ID.
An explicitly supplied sibling account ID rejects the entire page. Page data is
newly decoded and caller-owned; changing it does not mutate retained provider or
cursor state.

Keep the batch's original cursor until `HasMore` is false. Only the restricted atomic
commit may persist the complete changes and final cursor together. On pagination
mutation, discard every uncommitted page and restart from that original cursor.
Never retry just the page that failed. An initial response with no changes and an
empty next cursor is not-ready, not a successful empty import or cursor advance.
A continuation with an empty next cursor is malformed. Update status is optional
provider evidence, including unknown values, not proof of import completion.

## Failures and privacy

Every error returns a zero unusable page, with no cursor advance. `SyncError.Kind`
distinguishes invalid request/provenance, invalid response/facts, pagination
mutation, not-ready, rate limit, temporary failure, reconnect/permission repair and
permanent/unknown rejection. Known Item-limit errors require attention and never
authorize an empty-cursor reset. `RetryAfter` is the minimum provider delay;
callers combine it with bounded retry policy only for an appropriate error kind.
No automatic retry, provider refresh, re-enrollment or persistence occurs here.

Configuration, credentials, binding, cursor, page, transaction, removal and
freshness types redact ordinary and Go-syntax diagnostics. Errors contain only
allowlisted categories and duration guidance, never transport errors, URLs,
provider text or raw responses. The adapter logs nothing; its eventual owning
worker boundary reports unexpected failures once using safe static diagnostics.
Callers must never log fields individually or place credentials, checkpoints or
financial facts in queues. Queue payloads remain opaque local IDs and generations.

## Executable Sandbox check

Fixture tests under `internal/banking/sync_test.go` run without credentials. The
opt-in `TestSyncSandboxContract` needs an authorized Plaid client ID and **Sandbox**
secret in the subprocess environment as `PLAID_CLIENT_ID` and
`PLAID_SANDBOX_SECRET`. Do not use production secrets or paste values into chat,
commands, reports or tracked files. Load them through the operator's secret
environment; any local file must be owner-readable and Git-ignored. The test does
not load application runtime config or enable enrollment gates.

From `apps/api`, with those protected variables already loaded:

```sh
PLAID_SYNC_SANDBOX_CHECK=1 go test ./internal/banking -run '^TestSyncSandboxContract$' -count=1 -v -timeout=5m
```

This explicit opt-in creates one synthetic `ins_109508` Sandbox Item through
`/sandbox/public_token/create`, requesting Transactions and 365 days through
`options.transactions.days_requested`, then exchanges its one-use token once.
It explicitly chooses one available USD checking, savings and credit card fixture
account, reads each as a separate filtered stream, completes bounded pagination
and continues using its resulting cursor. A final `/sandbox/item/reset_login`
on that owned Item checks the reconnect outcome. Cleanup removes only that test
Item with its known credential and reports confirmation. No live Link, institution
login, paid refresh, webhook dispatch or database write occurs.

The check logs only stages, account kinds, counts and presence flags. Missing
account kinds are reported as unobserved. Readiness polling is bounded and honors
retry guidance. A failed/uncertain create or exchange may leave a test Item without
a recoverable credential, and a process kill may prevent cleanup; reconcile owned
Sandbox inventory through the authorized operator before retrying. Never replay an
uncertain exchange or delete unrelated Items. Cleanup failure is a test failure.

Passing fixtures alone does not establish Sandbox behavior. A Sandbox pass proves
only the observed synthetic request/response contract; real institution history,
365-day coverage, pending/removal timing, pagination mutation, rate limits,
production entitlement, consent and release gates require separate evidence.
Mutation/rate-limit/transport and malformed-fact outcomes remain fixture evidence
unless independently observed; no deterministic live failure is fabricated.

Official contracts: [Transactions API](https://plaid.com/docs/api/products/transactions/),
[sync migration](https://plaid.com/docs/transactions/sync-migration/),
[Transactions errors](https://plaid.com/docs/errors/transactions/),
[Transactions webhooks](https://plaid.com/docs/transactions/webhooks/),
[Item API](https://plaid.com/docs/api/items/) and
[Sandbox API](https://plaid.com/docs/api/sandbox/).

## Restricted atomic persistence

`BeginSyncBatch`, `StageSyncPage`, `CommitSyncBatch` and `CancelSyncBatch` extend
this adapter with private PostgreSQL persistence. They do not fetch pages or run
an import loop. Begin derives the exact provider binding and original checkpoint
from storage under an existing current `reconcile` lease. Provider requests occur
between these calls, outside the commit transaction. Queue messages retain opaque
work IDs; provider pages and checkpoints must never enter queue or log payloads.

Each private batch captures its owner, lease, binding, original checkpoint,
connection/deletion/binding/account generations and reporting revision. Staging
validates consecutive ordinals, exact input/output cursor continuity, supported
facts and account scope. Identical page replay is safe; changed replay invalidates
the sequence. Only a final page with `has_more = false` makes a batch committable.
A batch is limited to 1,000 pages, each at most 20 changes and 64 KiB, and expires
after one hour. Cancellation and provider pagination mutation require discarding
the whole sequence and beginning again from the trusted stored checkpoint.

Commit locks enabled identity, connection, binding and logical account, then
rechecks current lease, permission, selection, collection state, deletion barriers
and captured generations/reporting revision. Competing batches from the same
checkpoint cannot both win. Source revisions, annotation projections, removal
history, final checkpoint, import/data/reporting revisions and local commit facts
publish in one database transaction. An SQL failure rolls everything back; an
identical committed-batch retry returns the same receipt while its current lease
remains authorized. Provider timestamps and update status remain separate from
local commit time and do not establish complete history coverage.

Exact same-binding provider identity is the only source lookup. An explicit
pending-to-posted link can retain the pending source's stable internal ID across
pages; prior facts, original provider identity and immutable annotations remain.
Unlinked rows get independent IDs. A changed link cannot merge existing source
histories, a second posted identity cannot reuse an already-posted pending link, and a pending removal cannot remove its superseding posted identity.
Known removals append a removed revision; unknown removals retain identity-only
history without inventing amount/date facts. Imports remain unclassified unless
existing valid owner annotation provenance supplies activity; codes/names alone
are not automatically classified by this persistence slice.

Source revisions separately retain a material-revision anchor. Annotation
projections retain their original material acknowledgement and all notes,
category/activity choices and exclusions. Nonmaterial changes preserve a valid
review; material changes clear review and require fresh acknowledgement before an
activity override can contribute. Incompatible sign/status overrides remain
visibly conflicted. Already stale acknowledgements never become current merely
because a later provider update is nonmaterial. Public annotation editing remains
separate work.

Current and staged bindings can collect; retired/cancelled bindings cannot.
Existing reporting intervals remain authoritative, with D inclusive for prior
history and replacement ownership strictly after D. Initial replacement overlap
stays noncontributing. Later added, modified or removed pre-D facts retain
historical-discrepancy metadata; date corrections crossing an ownership boundary
retain a cross-boundary notice and invalidate dependent reads. Immutable captured
facts cannot be silently replaced by these corrections. Activation/recovery uses
the existing full revision agreement and never restores collection or erased data.

The worker role has only capability-checked wrapper execution and no direct
staging/source access, helper execution or user impersonation. Expired batch
cleanup removes at most ten batches per call, using `SKIP LOCKED`; it never expires
retained source history. Existing logical-account deletion barriers immediately
block collection and visibility. Before retained-data purge, each call drains at most ten batches, 100 identity
aliases and 100 removal records for the deleted logical accounts. Only after
these payloads are empty can the existing dependency-ordered purge remove source
history, bindings and checkpoints. Cascades remain a backstop. This includes
replacement bindings across Items and preserves unrelated sibling accounts. The additive migration extends the existing banking
store; desired state remains in `supabase/schemas`, with migration replay,
permissions and real-database checks owned by `make db-test`.
