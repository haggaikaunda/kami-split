# Private banking enrollment

The authenticated GraphQL API delivers owner-bound start, finish, cancellation,
operation status, and connection/selected-account reads. It uses the private
[storage](banking-storage.md), the existing [worker and verified ingress](banking-worker.md),
and the [Personal banking contract](personal-banking.md). There is no browser Link
consumer, transaction ingestion, replacement activation or live enrollment authority.
New enrollment is disabled by default. An active connection returns
`AWAITING_INITIAL_IMPORT`; this establishes neither transactions nor freshness,
complete history, a zero-spending result or provider retention.

## Attempt and account authority

The caller supplies an attempt UUID before start and explicitly chooses
`DIFFERENT` or `EXISTING` intent. A keyed canonical-input digest binds owner,
environment and intent; finish additionally freezes the one-use public token and
sorted explicit selection. Changed reuse conflicts, and every replay/status read
reauthorizes the current enabled actor. One unfinished new-Link attempt per
owner/environment blocks blind enrollment; healthy existing Items remain usable.
Provider users are idempotently identified by an opaque actor/environment key.
The exact attempt-specific HTTPS webhook URL is persisted before preparing Link.
The provider user is persisted before Link handoff creation, which is claimed once.

Finish claims one exchange before external I/O. Transport and adapter calls do
not automatically retry that one-use exchange. Before activation, provider user
Item discovery must positively match the exchanged Item and the exact persisted
attempt webhook URL. Callback-supplied Item IDs, names, masks and client selection
cannot substitute for that check. A swapped callback token cannot activate or
remove another attempt's Item.

Server-observed institution country must be unambiguously US. Every explicit
selected account must be USD checking, savings or credit card. Only those selected
streams acquire local account/binding metadata. Newly exposed or unsupported
accounts do not silently enter storage. Transactions is initialized with
`days_requested: 365`; this is a requested initial window, not actual coverage or
a rolling retention policy. Exact provider `persistent_account_id` evidence,
scoped to owner/environment/institution, rejects a known duplicate. Missing exact
evidence never causes a guessed match; independently authorized joint holders
remain private. Existing-account intent returns `REPLACEMENT_REQUIRED` and cleans
up the new Item rather than substituting a binding for prior history.

## Uncertainty and cleanup

Preparation, exchange and local commits are separate durable boundaries; local
idempotency cannot make a remote effect atomic. Lost responses or crashes retain
`EXCHANGE_UNKNOWN`, with no active connection or import permission. The same
worker polls restricted durable enrollment jobs, with random renewable two-minute
leases, bounded ten-attempt backoff and provider minimum delays. Known protected
credentials feed the existing lifecycle teardown; unknown exchanges use verified
user-scoped discovery and explicit Item removal. Positively correlated targets
are persisted before removal. Every targeted removal must be confirmed before
`RETRY_ALLOWED`; empty discovery alone never proves absence. A lost removal
response followed by absence remains uncertain and may require operator attention.
Unrelated same-user Items are never targeted. Broad product termination is unused.

Cancellation, expiration and disabled owners permit cleanup, never activation.
Late verified webhooks retain a digest receipt and wake old completed cleanup
without reopening activation or affecting a newer attempt. Duplicate receipts do
not reset retry budgets. Minimal correlation and unresolved intent survive token
expiry. Exhaustion or unsupported/unverified capabilities yields `NEEDS_ATTENTION`
and continues blocking a fresh enrollment. The bounded operator status includes
`enrollment_recovery`; the DDL/operator role can resume the same intent after
repair using `app.banking_enrollment_resume(attempt_uuid)`. API and worker roles
cannot self-reset exhaustion.

## Credentials and runtime

Access tokens stay in authenticated AES-256-GCM server storage. Link/public tokens
use separately bound encrypted operation records; Link reads enforce provider
expiry, public material is never used after the single exchange claim and has a
maximum 30-minute expiry, and worker transitions destroy temporary ciphertext.
Only start may return the temporary Link handoff. Status, queues, diagnostic
formatting and shared Activity contain no credentials or private bank payloads.
The browser must keep the Link handoff in memory and never persistent storage.

`BANKING_ENVIRONMENT`, provider credentials and the independent banking keyring
configure existing cleanup/ingress. New enrollment additionally requires
`BANKING_ENROLLMENT_ENABLED=true`, `BANKING_WEBHOOK_ORIGIN` containing the deployed
HTTPS API origin, and both `BANKING_USER_DISCOVERY_VERIFIED=true` and
`BANKING_USER_REMOVAL_VERIFIED=true`. Missing or malformed prerequisites fail
closed. These explicit flags record deployment configuration, not provider
entitlement attestation. #255 must separately establish restricted Users API
capabilities and demonstrate the actual lost-response path and unrelated-Item
survival in the intended environment before live enrollment. No provisioning or
production credentials are supplied by this implementation.

Provider contracts: [Users](https://plaid.com/docs/api/users/),
[Link initialization](https://plaid.com/docs/api/link/), and
[Item exchange and removal](https://plaid.com/docs/api/items/).
