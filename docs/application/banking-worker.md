# Banking lifecycle worker

The private banking foundation has one actual Go `cmd/worker` consumer backed by
Supabase Queues (`pgmq`). It executes narrow known-Item teardown, bounded private
history purge and protected Item status reconciliation. The API optionally mounts
one signed Plaid ingress at `/banking/webhooks/{opaque correlation UUID}`. The
[enrollment API](banking-enrollment.md) adds restricted durable enrollment-recovery
jobs to the same worker, with renewable leases and narrow user-scoped discovery
and removal. Authenticated [lifecycle management](banking-enrollment.md#managing-an-existing-connection)
uses these same cleanup paths; transaction sync and replacement activation remain
separate work. Live enrollment stays disabled
under #255; synthetic checks establish no live entitlement or backup capability.

## Durable authority

`banking_fence` advances the terminal connection generation and commits opaque
cleanup operations and logged queue messages in the same transaction. Deletion
also fences logical accounts across current and replacement bindings. A rollback
leaves no executable orphan message. Upgrades and reconciliation prepare logical-account
scope for earlier pending connection barriers before accepting purge work. Queue payloads contain only operation UUIDs
and generations; lifecycle work/receipt storage contains no tokens or financial payloads. Enrollment
handoffs use separate protected, expiring operation storage.

The queue visibility window is two minutes. An independent random lease token,
current lifecycle generation and unexpired lease authorize each local commit.
The consumer renews every 45 seconds. Provider requests run outside database
transactions with a 30-second deadline. Cancellation joins renewal and consumer
work before pool close; interrupted intent becomes claimable after lease expiry.
External effects can repeat after response loss; exactly-once provider removal is
not promised. Missing credentials alone never prove removal.

Automatic attempts, including crashed claims, stop after ten. Retry uses
exponential delays from one minute to one hour with jitter, respecting a longer
provider minimum. Permanent rejection, missing/corrupt credentials or guidance
longer than the supported seven-day automatic delay requires operator attention.
No retry is sent earlier to fit a local scheduling target. Due work is polled each
minute. Reconciliation repairs missing transport messages from durable intent,
fences disabled owners into cleanup and schedules protected Item observations at
least daily for eligible bindings. Only a matching provider response advances the
binding observation. A matching `item/get` OAuth-revocation reason immediately
fences collection and enqueues the existing teardown, recovering missed webhook
notifications without deleting history. Other observation failures set actionable
repair status; their retry and attention budgets remain bounded. Neither a healthy observation nor an absent notification
enables a stopped binding or grants collection permission.

## Private cleanup and ingress

Purge commits bounded batches (at most 100 rows per dependency table per batch),
including current/staged source revisions, annotation versions, captures, plans,
archives, binding cursors and account payloads. Barriers hide all affected logical
accounts immediately. Sibling accounts and independently authorized holders remain
private and intact. Purge and provider teardown have separate outcomes; a provider
outage cannot prevent local erasure. Only opaque barrier/operation metadata remains,
and confirmed teardown destroys the credential. Backup expiration and provider
retention are distinct; barriers have no invented expiry. Restore only in isolation
with the independent complete deletion journal, before exposing data or workers.

The verifier requires ES256, bounded kid/JWK metadata and cache lifetime, a signed
iat within five minutes, and constant-time SHA-256 comparison of the exact raw
body. It checks the configured environment and required Item metadata. Positive and
negative signing-key caches are separately bounded to 16 entries each. A rejected unknown key is cached for
one minute or its longer Retry-After without blocking unrelated key refreshes.
Only genuine provider unavailability/rate guidance sets a shared cooldown; key
requests are serialized. Unexpected key infrastructure failures produce one safe
static diagnostic at the HTTP boundary, while invalid deliveries stay quiet.
The durable acceptor separately locks the opaque correlation and compares its expected Item,
environment and generation. Invalid/mismatched events write nothing. Success means
a committed digest and safe event-routing receipt, including durable duplicates;
terminal receipts cannot reactivate a generation. Unavailable keys or persistence
return retryable 503. Enrollment correlations accept durable digest hints and trigger only verified
narrow recovery, never activation; Item/account revocations dispatch local fences and durable cleanup in the receipt
transaction. Temporary errors produce repair status; healthy/new-account hints
grant no consent or selection. Other routing awaits sync; receipt acceptance is
not completed provider cleanup.

## Runtime and privileges

`kami_migrator` owns application DDL and the security-definer wrappers. The
extension owns pgmq objects; only the DDL wrapper owner receives queue access.
`kami_worker` is a separate non-inheriting, non-administrative login with wrapper
execution only. It cannot select tables, enqueue arbitrary jobs, resume exhausted
operations, mutate sources or impersonate an owner. API/browser/service roles have
no direct queue or credential access. Worker deployment credentials must be separate
from API credentials and migration/operator credentials.

Configure the explicit banking environment, provider client/secret and a separate
versioned AES-256 keyring using the runtime variables described in the API README.
Keep previous key versions until retained ciphertext has migrated. Do not reuse
invitation keys. Enrollment has additional explicit, default-disabled capability gates described
in the [enrollment guide](banking-enrollment.md). The same production image contains
`server` and `worker`; the optional Compose banking profile uses the latter. Local
synthetic smoke runs the actual binary against a disposable restricted-role database
and checks readiness, safe bounded status and SIGTERM completion without live calls.

Operational status shows a bounded oldest-100 projection that prioritizes incomplete work, queue age, attempts,
needs-attention and cleanup progress. It must not be represented as an exhaustive
queue count. Logs use static failure events without request bodies, URLs, Item IDs,
credentials or raw provider/database errors. Operators inspect `app.banking_work`
under their authorized role, repair the cause, then resume the same operation:

```sql
SET ROLE kami_migrator;
SELECT app.banking_resume('operation-uuid'::uuid);
```

Resume rechecks current lifecycle authority, preserves the operation identity and
barriers, and starts a new bounded attempt budget. It cannot resurrect consent or
erased data. An invalid/superseded target returns false. No runtime role can resume
itself or reset a generation.

Provider contracts: [Item removal/status](https://plaid.com/docs/api/items/),
[webhook verification](https://plaid.com/docs/api/webhooks/webhook-verification/),
[delivery guidance](https://plaid.com/docs/api/webhooks/), and
[Supabase Queues](https://supabase.com/docs/guides/queues).
