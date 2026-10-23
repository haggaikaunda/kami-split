# Private banking enrollment and lifecycle

The authenticated GraphQL API delivers owner-bound start, finish, cancellation,
operation status, connection/retained-account reads, explicit selection, existing-Item
repair, disconnect and private-history deletion. It uses the private
[storage](banking-storage.md), the existing [worker and verified ingress](banking-worker.md),
and the [Personal banking contract](personal-banking.md). Personal Connections
consumes initial Link enrollment with explicit account selection and same-attempt
recovery. Connections also consumes existing-connection management; live
enrollment authority remains separately gated. The [initial import consumer](banking-sync.md) ingests selected streams; the [status API](banking-status.md) exposes their persisted progress, coverage and freshness. The [replacement backend](banking-replacement.md) supplies explicit staging, preview, activation and bounded recovery.
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
remove another attempt's Item. Multiple correlated Items keep the attempt
non-active until all affected targets are confirmed removed.

Server-observed institution country must be unambiguously US. Every explicit
selected account must be USD checking, savings or credit card. Only those selected
streams acquire local account/binding metadata. Newly exposed or unsupported
accounts do not silently enter storage. Transactions is initialized with
`days_requested: 365`; this is a requested initial window, not actual coverage or
a rolling retention policy. Exact provider `persistent_account_id` evidence,
scoped to owner/environment/institution, rejects a known duplicate. Missing exact
evidence never causes a guessed match; independently authorized joint holders
remain private. Generic existing-account intent without an explicit replacement target returns `REPLACEMENT_REQUIRED` and cleans
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
Late verified webhooks retain a digest receipt and Item hint and wake old completed
cleanup without reopening activation or affecting a newer attempt. Extra Items
after readiness are discovered and narrowly removed while preserving the original
active Item. Hints arriving during cleanup must be positively correlated and
confirmed removed before recovery completes; an uncorrelatable hint retains
actionable uncertainty. Duplicate receipts do
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

## Browser enrollment and authorized Sandbox checks

Personal opens Overview and directs initial setup to Connections. The compact
connection list shows selected accounts and their independent import, coverage and
freshness states. Connect account opens eligibility and privacy information in a
phone sheet or desktop side panel. Close and Escape dismiss the panel without
canceling its durable attempt or changing the explicit account selection; Resume
connection returns to the same attempt. Continue with Plaid creates a durable
`DIFFERENT` attempt. The native panel closes before the SDK opens its own interface,
then returns for account selection or an exit outcome. Existing-account intent
leads to the management boundary without silently replacing reporting history.
The hosted Plaid SDK returns an in-memory public token and candidate accounts;
only explicitly checked eligible accounts enter the finish request. Provider
metadata is a display hint, while the server remains the eligibility authority.

Duplicate callbacks cannot repeat exchange. A lost response recovers the original
attempt; cancellation keeps new enrollment blocked until durable cleanup allows
retry. Only the opaque actor-scoped attempt UUID may persist in session storage.
The shared session clears it on logout, actor change and access denial. Link and
public tokens and bank details never enter browser persistence. Full OAuth
redirect continuation is not implemented; institution flows requiring it need a
separate completion and verification before rollout.

Deterministic browser SDK fixtures and authenticated database tests cover client
state and server persistence. They do not establish real provider acceptance.
An authorized operator can perform the following Sandbox Link check with a
uniquely owned test user, isolated database and explicitly enabled Sandbox
configuration after confirming the required Users API capabilities:

1. Open Personal Connections in each supported browser appearance. Start a
   non-redirect Sandbox institution flow and confirm the US/USD eligibility,
   private full joint-account activity and requested 365-day availability copy.
2. Select one eligible checking, savings or credit-card account explicitly. Leave
   another unchecked; confirm only the selected account appears and the initial
   status does not promise complete history, current bank data or zero spending.
3. Cancel and expire separate owned attempts. Confirm no account activates and a
   new attempt stays blocked while provider cleanup is pending.
4. Reload an unfinished attempt and interrupt a finish response in the isolated
   environment. Recover by the same UUID; verify no second exchange or additional
   selected account. Reconcile an uncertain provider outcome before retrying.
5. Confirm a second test actor cannot discover accounts or resume the first
   actor's attempt; logout/access denial clears private UI and browser recovery
   storage. Confirm connection creates neither a shared expense nor a transfer.
6. Reconcile every owned Item and durable attempt through the existing teardown
   operations. Confirm exact provider removal and local cleanup before removing
   the disposable environment; an unknown result remains an operator obligation.

Record the actual environment, observed states and limits on the owning issue or
PR without credentials or bank payloads. This checklist grants no provisioning or
enrollment authority. Real institutions, redirect flows, restricted provider
capabilities, retention-compatible consent and production release remain #255
gates. The [adapter/consumer checks](banking-sync.md) exercise separate server
contracts and do not substitute for the browser Link journey.

## Managing an existing connection

Read `bankingConnection` for the exact decimal-string `generation`, retained
account IDs, provider account references and `selected` flags. Connection reads
reauthorize the enabled owner, including nested account data. Household/group
membership grants no banking authority. A deleted connection returns only opaque
lifecycle/cleanup status and no accounts. The internal history read still masks
deleted sources and connections as absent.

`changeBankingSelection` replaces the explicit local subset under the observed
generation. Removing selected accounts works without contacting the provider;
adding or reselecting requires current server-observed US institution and USD
checking/savings/credit-card authorization. An empty subset stops all streams
without deleting history. Selection fences old jobs and preserves original
binding/source IDs and annotations. It does not remove an Item that serves a
selected sibling. Never-selected provider accounts acquire no local metadata.

`startBankingRepair` creates an encrypted, expiring update-mode Link handoff for
the existing Item. It uses the existing access token, enables explicit account
authorization and requests no additional products or transaction window. Only
start returns the temporary Link token; `bankingRepair` returns safe status.
`finishBankingRepair` takes an explicit desired subset, never a public token,
and checks the current provider inventory and original lifecycle generation.
Successful repair preserves bindings and history. A changed Item, institution,
known persistent account identity or kind returns `REPLACEMENT_REQUIRED`.
Institution continuity is checked across the Item even for a subset of only new
accounts. Explicit replacement uses the [staged plan contract](banking-replacement.md). Reauthorization never selects new
accounts implicitly. Changed attempt input conflicts; replays reauthorize and
recover the original receipt. Only one unfinished repair per connection is
allowed until completion or expiry. Preparation uncertainty is visible and never
activates data; after expiry the owner may start a fresh repair.

`disconnectBanking` fences local collection before acknowledging success and
durably requests narrow Item removal while retaining private history.
`deleteBankingHistory` also immediately hides affected current/staged/archive
history and annotations, then drives the existing bounded purge. Recover a lost
management response with `bankingOperation`; use connection status to distinguish
local `state`, provider `cleanup` and active-copy `purge`. `READY` means the local
command committed. Remote cleanup can remain pending or need attention while
purge completes; neither status promises provider retention or backup erasure.
Credentials remain protected until confirmed narrow removal, then are destroyed.
Stopped/deleted generations cannot be reactivated by repair, enrollment, worker
completion or a healthy notification.

The sole signed ingress durably dispatches Item permission revocation and the
singular `USER_ACCOUNT_REVOKED.account_id`. Account revocation fences that stream
while retaining its history and selected siblings. Item-wide revocation (including
`ERROR` with `OAUTH_USER_REVOKED`) stops collection and requests teardown.
Temporary errors and impending expiration set `repair_required`; new-account
notifications advertise `accounts_available` but grant no selection.
`LOGIN_REPAIRED` grants neither selection nor consent. Duplicate receipts do not
repeat effects; out-of-order notifications cannot undo terminal generations.
Identity disable or loss of the live Auth identity immediately fences banking
and enqueues teardown in the identity transaction. Cleanup remains executable
without user access; retained history is distinct from explicit deletion.
Existing identity immutability policy does not allow silent reenablement.

Plaid's [update mode](https://plaid.com/docs/link/update-mode/) keeps the same
access token and Item; [removed Items](https://plaid.com/docs/errors/item/#item_not_found)
require a new Link/new Item rather than update mode. A delayed local completion
therefore remains terminal and cannot recreate consent after confirmed removal.
Unknown removal outcomes retain the credential and durable cleanup obligation;
missing tokens alone never establish success. Synthetic tests do not prove
provider-internal ordering of concurrent repair/removal in live institutions.
Plaid recommends deleting derived data after revocation; Kami's approved C1/C2
policy retains private history. Retention-compatible live consent, provider
capabilities, concurrent lifecycle behavior and backup erasure evidence remain
explicit #255 gates; new enrollment stays disabled by default.

### Browser management

Connections opens a fresh owner-authorized management baseline before changing
selection. The contextual desktop panel becomes a sheet on phones. Account choices
are explicit; repair uses update-mode Link without a public-token exchange and
newly authorized accounts remain unchecked. Closing or canceling the view never
attests a provider rollback. The original repair can be checked through its durable
status until completion or expiry.

Disconnect and private-history deletion have separate confirmations naming the
affected institution and accounts. Local commit, provider removal and active-copy
purge are distinct observations. Only opaque actor-scoped attempt IDs survive
navigation in session storage; permission failures, logout and actor departure clear
them through the financial session boundary. A missing receipt does not prove a
write failed or permit an automatic new attempt.

Institution names come from the existing server-observed institution lookup and
are saved with successful enrollment, repair or provider-authorized account
selection. Reads perform no provider lookup. Older connections without a known
name use an explicit unavailable label. Deleted connections erase and hide this
display metadata. Neither names nor opaque provider identifiers prove continuity.
The [replacement guide](banking-replacement.md) describes staged confirmation and
reporting-only recovery. These browser paths do not enable production enrollment
or establish live-provider acceptance.
