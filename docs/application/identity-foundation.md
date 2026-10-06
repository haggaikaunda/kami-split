# Identity and membership foundation

Issue #75 implements the database portion of [ADR-005](decisions/005-identity-and-expense-contract-proposal.md)
and its reviewed [database design](proposals/first-expense/database.md). The
accepted policy comes from ADR-001 through ADR-005. This guide describes the identity
boundary used by the implemented [verified request identity](authentication-boundary.md),
[persisted expenses](persisted-expenses.md), and internal [targeted invitations](targeted-invitations.md).
[Onboarding transport](onboarding.md) and [operator bootstrap](bootstrap.md) are
implemented. The [Relay expense journey](relay-expenses.md) connects the first financial browser slice (#83); ownership transfer and
departure require their separately owned work.

The private `app` schema now holds users, groups, permanent memberships and an
installation singleton (empty after migrations). IDs are supplied by trusted callers;
future creation operations must generate random UUID v4 values. Auth subject and
application identity are distinct. There are no production identities in migrations.
A deferred composite owner foreign key requires one same-group active membership
at commit. OWNER is derived from that pointer, never a second mutable role flag.
The installation's explicit creator identity is independent of the group's owner.
The [operator bootstrap procedure](bootstrap.md) implements #81 with its reviewed
advisory-lock and safe-rerun protocol, never inferring rights from the first account.

Direct runtime access has column-only group/membership reads and narrow helper
execution. It cannot directly write these identity tables, read users/installation or managed Auth, create schema
objects, assume the owner role, or bypass RLS. Browser and service roles cannot
access the private schema. SECURITY DEFINER helpers use a fixed catalog/temp search
path and fully qualified app names. Identity helpers rely on owner bypass on the identity tables to avoid recursive
policies. Financial tables separately enforce forced RLS;
the identity helpers do not grant a financial bypass.
Function default PUBLIC execution remains revoked.

`DB.WithIdentity` accepts a canonical Auth UUID already verified by the implemented
authentication middleware. It binds `app.verified_sub` with transaction-local `set_config` in a
READ COMMITTED transaction. Actor-bound identity operations use that transaction, not the pool.
The setting is trusted-server evidence, not protection from stolen database
credentials or SQL injection. Missing/malformed context fails closed. Disabled or
tombstoned accounts cannot read groups; viewer status alone distinguishes their
own DISABLED/UNPROVISIONED state without returning their identity/name.

`ReadViewer`, `ListGroups`, `ReadGroup`, and `LockGroupWrite` are the
foundation query boundary. Member projections contain only membership ID, current
display name, ACTIVE/INACTIVE, OWNER/MEMBER and participation eligibility. They
include retained inactive members only for a currently authorized caller. No peer
email, Auth subject, application-user ID or reason for ineligibility is exposed.
These are internal database projections. The ledger and GraphQL layers provide
public ID encoding and authorized transport mapping for implemented expense reads.

Group reads lock the actor user SHARE, then group SHARE, then authorize and select
the complete member projection in one fresh statement. Write locking resolves
same-group participants, locks distinct users in UUID order SHARE, then group
UPDATE, and rechecks eligibility. The helper grants no DML. A caller holding a
group lock must never acquire additional user locks. User disabling and future
membership mutations must follow the shared user-before-group ordering. Lock
helpers reject stronger isolation levels because a snapshot established before a
wait could retain revoked membership. Financial writes/audit and invitation admission/revocation build on this ordering
and have their own real-database integration tests; foundation lock tests cover
the shared identity boundary.

Immutable-field triggers protect user/group/membership IDs, attribution and
creation times. Permanent `(group,user)` uniqueness retains membership identity
across inactivity and readmission; the fixture's readmission is privileged test
setup. The implemented invitation admission service can restore that same
membership as an ordinary member through an authorized new invitation. Old
accepted links cannot do so.

Deleting an enabled managed Auth account fails the linked-user CHECK. A separately
authorized lifecycle procedure must first disable its application identity under
the user lock. Auth deletion then clears only the live link; stable subject,
application identity and memberships remain. The reserved Auth subject cannot be
reused, a tombstoned link cannot be restored, and disabled access cannot be toggled
back on. No same-email lookup, identity merge, account deletion eligibility,
anonymization or retention workflow is implemented.

`make db-test` applies #75 over the shipped #74 state, replays all migrations from
scratch, checks exact desired schema/ACL/ownership, and runs real runtime-role
security and concurrent-lock tests against actual local Supabase Auth. The desired
comparison database clones that disposable provider baseline before new app DDL;
it does not invent managed Auth objects. Only the disposable project's connections
are briefly disabled for cloning. Hosted migration credentials must separately
prove the reviewed temporary schema grant / Auth-FK creation / immediate ownership
transfer / grant revocation path before deployment.

## Household sharing upgrade

[ADR-010](decisions/010-household-membership-sharing.md) makes current active
Household membership the workspace relationship. Private membership/account
eligibility generations bind cursors across leave/rejoin and eligibility loss.
The forward migration preserves all stable identities and admission history and
does not restore removed memberships or disabled/unlinked accounts.
