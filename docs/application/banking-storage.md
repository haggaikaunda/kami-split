# Private banking storage

The internal Go `banking` package provides owner-private connection and source
storage, protected credential reads, durable operation recovery, and stop/history
hiding fences. The [lifecycle worker](banking-worker.md) adds durable cleanup,
protected Item observations and verified webhook ingress. The [enrollment API](banking-enrollment.md) adds actor-bound Link operations and
selected stream reads. Transaction import, annotation editing and replacement
activation remain deferred. Live enrollment remains disabled by default;
the [Personal contract](personal-banking.md) describes the planned product.

## Ownership and privileges

Operations use verified request evidence through `auth.WithActor`, the restricted
`kami_api` pool and a transaction-local identity. Banking ownership never follows
household/group membership. Enabled identity is locked during application
operations so disabling an identity serializes with access. Owner-only RLS covers
connection, account, binding, source, revision, annotation, reporting-plan and
archive reads. Other-owner and absent identifiers have the same result.

`kami_migrator` owns DDL and historical fixture construction. Browser roles,
including `anon`, `authenticated` and `service_role`, receive no banking access.
The API has read access and narrowly granted mutation functions; credentials
cannot be selected directly. The separate `kami_worker` login has only lifecycle wrapper execution, with no
direct banking/queue table access, source writes or user impersonation. Cleanup
can finish for a disabled owner; provider observation requires an enabled owner,
granted permission, selected account and current generation.
No banking table references expenses or contributes events to shared Activity.

## Source and historical provenance

Stable source IDs are unique within a provider binding, independently of another
holder's private connection. Source revisions preserve signed int64 USD minor
units, a bank calendar date, processing state and mapping provenance. The write
primitive accepts canonical integer strings, rejecting fractional values and
overflow; provider decimal decoding remains an ingestion responsibility. Date-only
values are stored as PostgreSQL dates, without a timezone conversion.

Annotations have their own immutable revision and acknowledged material source
revision. Plans retain disjoint `(after date, through date]` binding intervals and
captured source revisions. Archives retain a predecessor plan, boundary and
source/annotation snapshot references. Updates cannot rewrite these historical
snapshots. Fixture construction validates account/binding ownership and interval
non-overlap; it is not an activation/recovery API. Current/staged source facts,
plan captures and archive captures remain separately addressable. Archive
references never create another source or annotation identity.

Deletion fences the affected logical accounts across all their bindings, including
replacement bindings on another Item. Permanent account barriers immediately hide
source facts, annotations, plans and archives. The worker's dependency-ordered
batches remove captures, immutable revisions, annotations, intervals, archives,
plans, bindings and account payloads while preserving unrelated siblings. A hidden
source may temporarily have no current revision during bounded purge; the database
requires a permanent barrier for such a shell. Credentials remain only until
confirmed narrow teardown; provider and backup retention are separate.

## Durable attempts and lifecycle fences

Each concrete write commits an owner/attempt/kind and keyed canonical-input digest
before its effects. A second transaction locks that receipt and commits the
single effect with its opaque result. Lost responses recover the original result;
a failed effect leaves a pending attempt for the same-input retry. Reusing an
attempt with changed input conflicts. Status reads reauthorize ownership.
Receipts contain only keyed digests, status and opaque identifiers, never bank
facts, notes, tokens or ciphertext.

Source writes lock the connection, refresh the binding and compare connection,
binding and source revisions. Stop advances lifecycle generations while retaining
history. History deletion advances generations, writes a durable opaque deletion
barrier and immediately hides affected facts, annotation versions and captures.
A delayed write cannot cross that fence. Credentials remain protected and hidden
from ordinary reads, pending durable teardown; deletion does not claim erasure from
provider systems or backups. Barriers have no invented retention expiry.

## Banking protection keys

Construct a separate banking `Protector` with banking-only secret material. Never
supply invitation keys or reuse their configuration. The explicit `LoadRuntime` boundary reads opt-in environment configuration;
storage constructors alone do not load secrets or enable provider operations. The AES-256-GCM nonce and
key version are stored with each ciphertext. Authenticated context binds the
banking namespace, access-token purpose, owner, connection and provider
environment. Missing keys, changed context and tampering fail closed with safe
errors. Ordinary diagnostic formatting redacts keyrings and credentials.

Rotation adds a new current key while retaining old keys for unmigrated
ciphertext and canonical-input digests. Removing an old version prematurely
makes both credential recovery and affected operation retries unavailable.
The runtime loads only explicit banking key configuration and the protected
adapter consumes credentials for narrow cleanup/status calls. Deployment owns
secret provisioning and credential migration; no invitation secret or public operation result carries a bank token.
