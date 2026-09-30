# Identity and membership foundation

Issue #75 implements the database portion of [ADR-005](decisions/005-identity-and-expense-contract-proposal.md)
and its reviewed [database design](proposals/first-expense/database.md). The
accepted policy comes from ADR-001 through ADR-005. The HTTP API remains health-only;
no authentication, invitation, bootstrap, ownership transfer, departure or financial
operation is exposed by this change.

The private `app` schema now holds users, groups, permanent memberships and an
initially empty installation singleton. IDs are supplied by trusted callers;
future creation operations must generate random UUID v4 values. Auth subject and
application identity are distinct. There are no production identities in migrations.
A deferred composite owner foreign key requires one same-group active membership
at commit. OWNER is derived from that pointer, never a second mutable role flag.
The installation's explicit creator identity is independent of the group's owner.
Bootstrap execution remains #81; use its reviewed advisory-lock and safe-rerun
protocol rather than inferring rights from the first account.

Runtime has column-only group/membership reads and narrow helper execution. It
cannot write these tables, read users/installation or managed Auth, create schema
objects, assume the owner role, or bypass RLS. Browser and service roles cannot
access the private schema. SECURITY DEFINER helpers use a fixed catalog/temp search
path and fully qualified app names. Their owner bypasses RLS only on these identity
tables to avoid recursive policies; no financial table or financial bypass exists.
Function default PUBLIC execution remains revoked.

`DB.WithIdentity` accepts a canonical Auth UUID already verified by the future #78
middleware. It binds `app.verified_sub` with transaction-local `set_config` in a
READ COMMITTED transaction. All operations use that transaction, not the pool.
The setting is trusted-server evidence, not protection from stolen database
credentials or SQL injection. Missing/malformed context fails closed. Disabled or
tombstoned accounts cannot read groups; viewer status alone distinguishes their
own DISABLED/UNPROVISIONED state without returning their identity/name.

`ReadViewer`, generated `ListGroups`, `ReadGroup`, and `LockGroupWrite` are the
foundation query boundary. Member projections contain only membership ID, current
display name, ACTIVE/INACTIVE, OWNER/MEMBER and participation eligibility. They
include retained inactive members only for a currently authorized caller. No peer
email, Auth subject, application-user ID or reason for ineligibility is exposed.
These are internal database values; public ID encoding and GraphQL transport remain
in their owning issues.

Group reads lock the actor user SHARE, then group SHARE, then authorize and select
the complete member projection in one fresh statement. Write locking resolves
same-group participants, locks distinct users in UUID order SHARE, then group
UPDATE, and rechecks eligibility. The helper grants no DML. A caller holding a
group lock must never acquire additional user locks. User disabling and future
membership mutations must follow the shared user-before-group ordering. Lock
helpers reject stronger isolation levels because a snapshot established before a
wait could retain revoked membership. Financial writes/audit and admission/revoke
semantics remain #82/#79; foundation lock tests do not claim those workflows work.

Immutable-field triggers protect user/group/membership IDs, attribution and
creation times. Permanent `(group,user)` uniqueness retains membership identity
across inactivity and readmission; the fixture's readmission is privileged test
setup, not an admission service. A future authorized new invitation may restore
that same membership as an ordinary member. Old accepted links cannot do so.

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
