# Proposed #75 database boundary

**SQL sketches only, not a migration or executable runtime query.** Reuse #74's
roles, schema, desired-state reconciliation and Supabase test stack. Shared
[identity/disclosure/lock rules](shared.md) apply without redefinition.

## D1: Tables and constraints

```sql
-- Owned by kami_migrator; all IDs supplied as CSPRNG UUID v4 by trusted code.
CREATE TABLE app.users (
  id uuid PRIMARY KEY,
  auth_subject uuid NOT NULL UNIQUE, -- immutable tombstone, never reassigned
  live_auth_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (live_auth_id IS NULL OR live_auth_id = auth_subject),
  CHECK (NOT enabled OR live_auth_id IS NOT NULL)
);
CREATE TABLE app.groups (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  owner_membership_id uuid NOT NULL,
  owner_active boolean NOT NULL DEFAULT true CHECK (owner_active),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.memberships (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES app.groups(id),
  user_id uuid NOT NULL REFERENCES app.users(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id),
  UNIQUE (id, group_id, active),
  UNIQUE (id, group_id)
);
ALTER TABLE app.groups ADD CONSTRAINT exactly_one_active_owner
  FOREIGN KEY (owner_membership_id, id, owner_active)
  REFERENCES app.memberships(id, group_id, active)
  DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE app.installation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  household_group_id uuid NOT NULL UNIQUE REFERENCES app.groups(id),
  group_creator_user_id uuid NOT NULL UNIQUE REFERENCES app.users(id)
);
```

All unspecified deletes are NO ACTION; never cascade history. Auth provider owns
`auth.users`; reference only its primary key. Controlled migration credential
must grant the DDL owner only schema USAGE and column REFERENCES(id) needed for
that FK, not SELECT or ownership of Auth data. Verify on pinned Supabase in #75;
if the hosted provider denies this grant, report a deployment blocker, never
broaden runtime privileges. No managed Auth table/trigger is created or changed.

There is no role column that could disagree with the pointer: OWNER means
`membership.id = group.owner_membership_id`; everyone else is MEMBER. NOT NULL
pointer enforces at least one; one pointer enforces at most one; composite FK
ensures same group and active. The referenced unique constraints are immediate
(PostgreSQL cannot reference a deferred unique constraint). A group can be
transiently incomplete inside a transaction, never committed ownerless. Runtime
cannot update any identity, group, membership or installation column directly.
Identity IDs, auth_subject, membership group/user and created_at are immutable
for all supported operations; #75 should enforce immutability with triggers as
well as grants. No runtime DELETE, TRUNCATE, REFERENCES or trigger privilege.

Installation has zero rows before explicit #81 bootstrap and exactly one after
its atomic transaction. Its two pointers independently designate Household and
the sole stable identity permitted to create groups later. Ownership transfer
never edits this row. This does not create general admin roles, trip metadata,
automatic partner admission, or a group-creation endpoint.

## D2: Transactions and deletion/retry

Bootstrap (#81 operator only): lock the singleton setup via a transaction-scoped
advisory lock with one documented fixed key; resolve explicit Auth subject, reject
disabled/tombstoned/conflicting identity; insert user, group with preassigned owner
membership ID, membership, installation; `SET CONSTRAINTS ALL IMMEDIATE`; commit.
Existing singleton must match exact user/group/membership and expected unchanged
ownership to report an idempotent result. Never upsert to reset ownership,
reactivate membership or award a replacement account the creation grant. Failed
Auth creation/application transaction retries are independent; no real seed data.

Future transfer protocol example (not a service in this change): lock current
actor and target users in S3 order, group FOR UPDATE, reread owner and eligibility;
update only `owner_membership_id` to enabled active same-group target. Old owner
remains active ordinary member. Set constraints immediate and commit with audit.
Competing transfers serialize; the loser rechecks and denies if no longer owner.
Direct owner inactivation fails the composite FK at commit, including privileged
SQL that skipped the application check. Cross-group pointers fail the FK. No
second role flag can produce two owners.

Future departure: same locks plus complete financial net check and membership
transition in the same transaction. Both positive and negative nets block; zero
net intermediary qualifies financially even if original expenses involved them.
Owner pointer must already reference another active member. No deletion or
financial write-off; corrections reopening departed obligations remain O11.

Auth lifecycle: disable application access first under user lock, without
silently inactivating an owner; then use the separately authorized Auth deletion
procedure. FK SET NULL preserves user/membership/history; enabled CHECK makes
unexpected deletion of an enabled account fail rather than leave stale access.
The immutable auth_subject remains reserved. On retry, a missing live Auth link
or disabled row is terminal for provisioning: return denied, never restore link
or enable it. A same-email new Auth UUID is a different identity, not a recovery
shortcut. No automatic replacement-account linkage. Full deletion eligibility,
anonymization and retention are O03/O12, not provided by this safety mechanism.

## D3: RLS and narrowly privileged functions

`kami_api` remains LOGIN NOINHERIT, non-owner, NOBYPASSRLS, with app USAGE.
Browser `anon`, `authenticated`, `service_role`, PUBLIC get no app USAGE/table
privileges/helper execution. Default function PUBLIC EXECUTE remains revoked.

| Object                     | kami_api grants                              | RLS/helper behavior                                                             |
| -------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| users                      | none                                         | `viewer_identity()` returns only own status/public projection                   |
| groups                     | SELECT(id,name,currency,owner_membership_id) | `can_read_group(id)`                                                            |
| memberships                | SELECT(id,group_id,active)                   | `can_read_group(group_id)`                                                      |
| installation               | none                                         | viewer helper returns only own creation-capability boolean                      |
| member profile projection  | EXECUTE `group_members(group_id)`            | authorizes group, returns S2 fields only                                        |
| identity/membership writes | none                                         | only future reviewed admission helper; operator bootstrap separate              |
| future financial tables    | no grant yet                                 | #82 adds explicit SELECT/INSERT privileges plus group RLS and atomic operations |

Sketch:

```sql
ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.installation ENABLE ROW LEVEL SECURITY;
CREATE POLICY group_read ON app.groups FOR SELECT TO kami_api
  USING (app.can_read_group(id));
CREATE POLICY membership_read ON app.memberships FOR SELECT TO kami_api
  USING (app.can_read_group(group_id));
-- No identity/membership write policies or grants for kami_api.
```

`viewer_identity()`, `can_read_group(uuid)`, `group_members(uuid)` and the narrow
lock functions below are SECURITY DEFINER owned by `kami_migrator`, with
`SET search_path = pg_catalog, pg_temp`, fully qualified app names, no dynamic
SQL, no user-selected actor, no logging, and explicit EXECUTE only to kami_api.
These identity tables intentionally do not FORCE RLS: owner execution bypasses
these policies and prevents recursive membership-policy evaluation. Runtime
cannot SET ROLE owner or replace functions. This exception is limited to a few
fixed functions; it is not a blanket runtime bypass. Future financial tables can
FORCE RLS and must not be read by these owner helpers.

Exact `can_read_group(g)` logic: parse context UUID safely; find users where
live_auth_id = context AND auth_subject = context AND enabled; return EXISTS
active membership with that user_id and group_id=g. Missing/malformed returns
false. No caller-supplied user argument or email fallback. `viewer_identity`
returns UNPROVISIONED if no reserved subject, DISABLED if disabled or no live link,
otherwise only S2 viewer fields; no unrelated identity rows. `group_members`
rechecks can_read_group, joins that group's retained memberships/users/groups,
and projects S2 fields. Account-disabled peers appear nonparticipating, without
revealing the account status reason. An inactive caller gets no historical data.

`lock_group_read(g)` locks own user SHARE then group SHARE and rechecks access;
`lock_group_write(g, affected_members[])` resolves distinct users from same-group
member IDs, includes actor, locks users SHARE in UUID order then group UPDATE,
and rechecks enabled/active eligibility. Wrong-group IDs return generic denial.
These return no privileged rows. The write helper grants no DML capability by
itself. #82 uses it before financial SQL; #75 tests lock behavior. Membership
mutations are only through reviewed fixed functions/operator protocols with the
same ordering. Function grant/owner/search-path tests are part of #75, including
malicious temp objects and direct calls without context.

## D4: Admission integration contract (#79/#80)

An unprovisioned verified subject cannot insert itself or read groups through
ordinary RLS. #79 must introduce `accept_invitation(token_proof, admission_kind)`
as a single narrowly privileged transaction-bound operation, not a general
`add_member(group,user)` escape hatch. Go owns token/email/provider/business
validation; its dedicated admission path binds current verified evidence to the
request. SQL must also verify the locked persisted invitation's group, lifecycle,
expiry and proof hash and write the admission receipt/membership atomically.
The helper derives subject from S3, never an actor argument. Runtime cannot
manufacture an admission by setting `is_invited=true` or supplying an arbitrary
group ID. Exact proof/current-email transport is a #79/#80 gate, not a finalized
helper signature or grant to implement before invitation storage exists.

Current verified-email evidence cannot be a stale JWT email claim. #80/#79 must
verify a supported current Supabase identity response outside database locks,
bind its subject to #78 identity, and specify freshness/email-change race behavior
before accepting targeted invitations; no privileged Auth SELECT for kami_api.
For targeted admission require current normalized matching email, new valid
invitation for readmission, and terminal accepted receipt retry that cannot
reactivate an inactive membership. Generic first-time Join has no email-target
comparison and no owner queue; verified status is still mandatory. Under the
S3 locks it requires no existing membership, inserts ordinary active membership,
and records actor admission without consuming/renewing the shared link. Duplicate
admission returns the existing result only while authorized; expired/revoked link
cannot grant new access. Former-member generic admission remains gated; do not
encode targeted-only as the solution. Full-history ordinary readmission reuses
UNIQUE(group,user), never creates a second membership or changes the owner pointer.

A separate valid-token preview may project only group name/inviter display name
before login; ordinary group RLS remains unchanged. #79 owns the narrow preview
capability and redaction. No financial/member-list grants flow from token possession.

## D5: Required implementation scenarios

#75 must run fresh replay/upgrade/desired-schema comparison on #74's isolated
Supabase stack, using real kami_api/browser roles and synthetic managed Auth users:

1. Two groups, three users, inactive history; duplicate Auth links and permanent
   memberships reject, readmission preserves ID, disabled/tombstoned retry denies.
2. Commit ownerless group, cross-group owner, inactive owner: all fail. Bootstrap
   cycle commits only when complete. Transfer/inactivate races test both orders;
   at most one winner with exactly one active owner after every commit.
3. Missing/malformed GUC, disabled user, inactive caller, unrelated node/group,
   direct identity DML/helper misuse/browser access all deny without private data.
4. Alternate users through one pooled connection after commit, rollback and
   cancellation; verify empty context never inherits previous access.
5. Delete enabled Auth user fails; disable then delete retains identity/history;
   retry and same-email replacement never reenable/relink. Provider FK permission
   tested against actual auth schema, not a hand-created imitation.
6. Status disable versus financial lock, membership removal versus financial
   lock, and admission versus revoke serialize with eligibility reread. #82/#79
   add real operation tests; schema tests alone cannot prove those services.
7. Exact profile column denial, helper search-path attacks, role membership and
   recursion checks. Audit all future membership/owner mutations atomically;
   no workflow is delivered by these scenarios.

## Primary technical evidence

[PostgreSQL foreign keys](https://www.postgresql.org/docs/17/sql-createtable.html)
support deferred composite references to immediate unique keys; this motivates
the owner pointer. [RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
explains owner bypass, default denial and policy recursion/race concerns.
[set_config](https://www.postgresql.org/docs/17/functions-admin.html) documents
transaction-local settings. [Supabase user data](https://supabase.com/docs/guides/auth/managing-user-data)
recommends referencing only the managed Auth primary key and notes deletion does
not itself invalidate issued JWTs. We deliberately reject cascading history.
Checked 2026-09-29; actual provider-role and concurrency proof remains #75 tests.
