# Banking lifecycle worker

The private banking foundation has one actual Go `cmd/worker` consumer backed by
Supabase Queues (`pgmq`). It executes narrow known-Item teardown, bounded private
history purge and protected Item status reconciliation. The API optionally mounts
one signed Plaid ingress at `/banking/webhooks/{opaque correlation UUID}`. The
[enrollment API](banking-enrollment.md) adds restricted durable enrollment-recovery
jobs to the same worker, with renewable leases and narrow user-scoped discovery
and removal. Authenticated [lifecycle management](banking-enrollment.md#managing-an-existing-connection)
uses these same cleanup paths. The [replacement backend](banking-replacement.md) extends complete purge across staged and historical bindings; transaction sync remains separate work. Live enrollment stays disabled
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

### Retry clocks and operational limits

Integer `Retry-After` seconds are a duration from response receipt. An HTTP-date
is converted to a remaining duration using the worker host's UTC clock at receipt.
The worker takes the greater of that duration and its backoff, rounds upward to
whole seconds, and passes the duration to PostgreSQL. Response-body processing,
network and scheduling latency before persistence add waiting time; they do not
subtract it. PostgreSQL adds the duration to `clock_timestamp()` for both durable
due time and queue visibility. A claim requires both visible transport and an
elapsed durable due time before any provider request.

A stable database clock offset from the worker host cancels between scheduling
and claiming. For example, a database 73 seconds behind still waits the full
duration on its own clock. Comparing its persisted timestamp directly with a
host/provider deadline cannot establish an early retry. Verification must compare
elapsed durations in one clock domain or translate using measured clock brackets.

This contract assumes the database clock measures elapsed time without a forward
step or an appreciably faster rate while work is pending. A forward adjustment
can make both queue visibility and due time elapse early; a backward adjustment
delays eligibility. HTTP-date guidance additionally requires an accurate host UTC
clock relative to the provider date: a host ahead at parsing can understate the
remaining duration. Constant database offset is supported; arbitrary clock jumps
and arbitrary host/provider skew are not. Whole-second rounding and scheduling
latency are not clock-error budgets and must not be relied on to absorb drift.

Operators must maintain and monitor host/provider UTC agreement and database
clock continuity/rate, including VM suspend/resume and time synchronization
corrections. No application clock monitor or cross-clock deadline repair is
implemented. Before a planned discontinuous correction, pause consumers; after
an unexpected discontinuity, stop further processing and validate pending retry
deadlines against independently available provider guidance before restarting.
The work record stores the database deadline, not the original header and host
receipt time; if those references are unavailable, keep affected work paused until
the operator can establish safe rescheduling. Simply restarting the worker retains
the original database deadlines and cannot repair them. The
same database wall clock governs leases, so changing it is an operational action,
not a retry-test setup technique.

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
transaction. Exact verified-JWS fingerprints make retries of the same signed
revocation idempotent. Body equality is not a provider event ID: a newly signed
identical revocation conservatively fences again, including when its account has
no local binding. This invalidates pending selections/repairs without saving
never-selected account metadata. Fingerprints remain private, survive disconnect,
and are removed in bounded batches on explicit history deletion; terminal
callbacks for the confirmed removed original Item are acknowledged using a private,
correlation-scoped one-way identity digest captured before Item redaction. That
opaque terminal identity follows existing correlation retention and contains no
raw Item, credential or financial payload; it prevents reopening completed
enrollment cleanup after history purge. Positive removals of distinct discovered Items also retain only scoped digests
in private enrollment metadata. These proofs survive later cleanup cycles that
reset transient job arrays, so a callback for a removed secondary Item cannot
reopen completed cleanup or pollute another pending removal. A genuinely new
late Item still requires existing positively correlated discovery and narrow removal. Known
original-Item callbacks neither recreate delivery fingerprints nor restart cleanup.
The proof is captured at removal; older records whose Item was already redacted
without this proof continue through conservative discovery, rather than inferring
identity or provider absence. Temporary errors produce repair status; healthy/new-account hints
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
