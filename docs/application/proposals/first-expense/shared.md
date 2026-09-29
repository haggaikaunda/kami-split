# Shared identity, authorization and financial decisions

Engineering choices below form the finalized design; implementation is separate.
Accepted policy sources and approval status are in the [index](README.md).
This is the shared mapping for both proposals; do not duplicate it in implementations.

## S1: Stable identity and public IDs

| Identity              | Internal representation                                                     | Public use                                                               |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Verified Auth subject | Supabase `auth.users.id`, UUID; configured issuer fixed by #78              | Never exposed                                                            |
| Application identity  | Random UUID v4 `app.users.id`, stable through disabled access/Auth deletion | `Viewer` ID for self only; no global directory                           |
| Group identity        | Random UUID v4                                                              | `Group` ID; explicit on every financial operation                        |
| Membership identity   | Random UUID v4, permanent unique `(group_id,user_id)`                       | `Membership` ID for payer, participant, creator, balance and attribution |
| Expense identity      | Random UUID v4, assigned server-side by #82                                 | `Expense` ID                                                             |
| Attempt identity      | Client CSPRNG UUID v4, generated before submit                              | `OperationKey`, bound to actor/group/CREATE_EXPENSE                      |

Public IDs are ASCII `ks1:<Type>:<lowercase canonical UUID>` with exact types
`Viewer`, `Group`, `Membership`, `Expense`. No base64: readable, unambiguous,
versioned, easy cross-language validation; opacity means callers cannot infer
rights, not secrecy. Reject wrong type/version/case/UUID and lengths over 64.
GraphQL ID numeric coercion is rejected by application ID validation. IDs do not
contain email or Auth subjects. Membership IDs prevent accidental cross-group
user references. Every lookup, including nested fields and `node`, authorizes
current enabled actor. Group-scoped nodes additionally require active membership.
`Viewer` is both the public ID type and GraphQL `__typename`: its UUID maps to
`app.users.id`, and `viewer.id` equals the ID returned by `node(id: viewer.id)`.
An enabled provisioned caller can resolve only their own Viewer node, including
when they have no groups. Another user's Viewer ID returns null, regardless of
shared membership; no peer user IDs or directory are exposed. Disabled or
unprovisioned callers receive their ViewerAccess state through `viewer` and no
Viewer node. The old `ks1:User:...` spelling is invalid, not an alias; this is an
unpublished proposal, so there is no deployed-ID migration.
Unknown and unauthorized valid IDs both yield safe NOT_FOUND/null-node outcomes.

Sort **full canonical Membership public IDs ascending ASCII code-unit order**
for equal-split remainder and simplification tie-breaks. All share the same
prefix; this equals lowercase UUID lexical/byte order. Go compares strings, JS
uses explicit `<`/`>` (never localeCompare), SQL uses UUID order or COLLATE "C"
on canonical text. Validate canonical form before sorting; never sort base64,
UI order, names or localized strings. For IDs ending 001, 002, 003, 1000 cents
allocates 334,333,333 regardless of selection order.

## S2: Disclosure and historical attribution

Owner-approved P1 discloses exactly these group-member fields: public membership ID, displayName,
ACTIVE/INACTIVE status, OWNER/MEMBER role, and `canParticipate` (active membership
and enabled linked account). No peer user ID, email, Auth ID, account status,
join/leave dates, avatar, phone or other-group membership. Viewer alone receives
its stable Viewer ID, displayName, and `canCreateGroups` (informational only).
Group provides ID/name/USD currency/viewerMembership and complete member list.
Members, including inactive historical members, are visible only to current
active enabled members; readmission restores full history. Financial records
refer to retained membership IDs, never a name as identity. Display names are
current minimal labels; an audit actor ID remains stable when a label changes.
No implied retention/anonymization decision or immutable name-snapshot promise.
The exact field set is owner-approved privacy decision P1 in [gates](gates.md).

## S3: Verified transaction and authorization ordering

#78 verifies ES256 signature, configured issuer/audience, expiry and required
subject per ADR-002, then opens a #74 pgx transaction. On that same transaction:

```sql
SELECT pg_catalog.set_config('app.verified_sub', $1, true);
```

Only the verified canonical Auth UUID is passed as `$1`; no GraphQL actor or
client metadata. Queries cannot use the pool outside this transaction. Missing,
empty or malformed context fails closed; commit/rollback/cancellation ends it.
Helpers map the subject to an enabled, still-linked stable user every time.
No authorization cache in JWKS. Custom GUCs are **not cryptographic proof**:
a compromised trusted Go process/SQL injection can set them. RLS protects
accidental scope errors; JWT verification plus restricted DB credentials is the
trust boundary. Browser roles cannot call helpers or acquire runtime credentials.

Use READ COMMITTED and explicit locks for mutations. Lock affected existing
application users in UUID order with FOR SHARE, then the group FOR UPDATE,
then invitation/attempt rows, then memberships/financial rows in UUID order.
User-status changes lock the user FOR UPDATE first, then affected groups in UUID
order. No group operation acquires a user lock after a group lock. Participant
IDs are resolved before locking, then revalidated after locks; identities/group
IDs never change. Reads use READ COMMITTED: lock actor user FOR SHARE, then group FOR SHARE,
then recheck authorization in a fresh statement after both locks are acquired.
Return all selected group projections through one subsequent SQL statement
(including its authorization predicate), so page/member/balance data share one
statement snapshot while locks prevent group or actor revocation. Do not establish
a REPEATABLE READ snapshot before waiting for the group lock: a concurrent
membership removal may change only the membership row, leaving that snapshot
stale without a serialization failure. #82 assembles the group projection before
GraphQL field mapping; resolvers must not independently fetch divergent snapshots. Group writes serialize so a future
zero-net departure check and membership transition cannot race financial writes.
Admission locks the existing user first (new-user uniqueness conflict is resolved
before group locking), then group, then invitation. Multi-group financial writes
are forbidden. Lock timeouts return safe unavailable/unknown outcomes as described
in the contract, not a claim of noncommit. Deadlock/serialization retries of
financial writes preserve the same key/input and are bounded by request deadline.

Account disabling blocks on concurrent user locks; new financial writes cannot
pass enabled checks after disabling commits. A read already holding locks may
finish before revocation commits; later requests deny. Disabled owner account
access is denied, but its membership remains the sole active owner until a
separately authorized lifecycle operation; do not auto-transfer or create an
ownerless group. No departure or transfer service is authorized here.

## S4: Complete money projections

For each retained membership: net = paid − owed + actual repayments sent −
received. #82's initial data has expenses only; it must not invent repayments.
Compute across the entire single group, including inactive contributions, with
no expense-list filters. Settled means every individual net is zero; net sum
zero is merely conservation. A failed/incomplete aggregate returns an error,
never zero. `Revision` is a per-group **financial/ledger projection revision**:
a nonnegative decimal counter incremented atomically under the group lock on each
committed financial change. It is not an ETag, entity version, authorization token,
or version of the entire GraphQL response. Profile labels, membership/account
state and other non-financial metadata can change without incrementing it.
Equal financial revisions therefore do not prove equal responses or continuing
access. Reauthorize every request; clients must refresh metadata and access state
independently rather than retain them merely because Revision is unchanged.
No global entity-versioning system is proposed.

Simplification: sort debtors and creditors by S1 ID, repeatedly emit the minimum
of current debt and credit, subtract exactly and advance exhausted entries.
O(n log n), deterministic for identical nets/IDs, no minimum-payment-count claim.
Plans may change counterparties when new expenses change nets. Return full nets
and positive obligations; never persist synthetic transfers. A=-2000,B=0,C=2000
produces A→C 2000; inactive B's history remains included. All-zero cycle produces
no obligations; A=-2000,C=2000 is not settled even though the total is zero.
Financial zero does not grant authority to remove an owner or disabled account.
