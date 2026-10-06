# ADR-010: Household membership authorizes sharing

- Status: implementation decision for owner-requested #197; rollout acceptance remains open.
- Supersedes ADR-008's separate designation/consent and pair-only dashboard entry.
- Preserves ADR-007's complete reads, exact money and original-group repayments.

## Relationship and aggregation

An authorized owner invitation expresses intent to share Household expenses.
Authenticated, validated explicit Join establishes agreement and membership.
Opening a link, email delivery or creating an Auth account grants no membership.
Every enabled, Auth-linked active Household member receives its ledger, history,
Overview, Expenses, Balances, Activity and Members. Ownership affects management,
not basic reads. Group creation remains a separate installation grant.

The Household ledger is always included. For two or more active Household members,
additional source groups are included only when **every** active Household member
also has an active membership there. This adopts the common-member policy proposed
in #197 as an explicit implementation decision, not a previously approved ADR-008
rule. It avoids a hidden pair, a two-member cap, and union-based disclosure. Adding
C removes an A/B-only trip from the overview without deleting its financial history
or changing A/B's independent access through Groups/Trips.

A sole member receives only the Household ledger and can invite others. Their
individual other groups remain available through Groups/Trips. This avoids treating
all personal groups as shared Household history before another member agrees.
An active member whose account is disabled or unlinked remains in the common-member
set: extra sources are excluded for everyone, while other valid members retain the
Household ledger. Account disable must never broaden the intersection by silently
removing a person. Explicit inactive membership changes the common-member set under
the existing financial departure and lifecycle restrictions. Readmission reuses the
same membership and grants the common overview without another consent operation.
No new removal, account recovery, ownership or private bank-sharing API is introduced.

## Authorization and coherent reads

Dashboard, structured Expenses, Activity and source context use the same database
scope. Nested source metadata retains ordinary server authorization. A source ID
outside the common set cannot be used to obtain that source through a Household
read; its independent group read requires that viewer's own active membership.

Reads discover and lock all active Household users plus the actor in UUID order,
then the existing singleton guard, then eligible groups in UUID order. The guard
is a technical serialization point and its pair flags are never permission inputs.
After waits, discovery rechecks users and sources. A missed user or added source
requires a whole new transaction, bounded by three attempts and five seconds.
Admission/readmission and privileged Household lifecycle writers retain the existing
user → guard → group protocol; account disable and managed Auth unlink retain the
canonical user-lock protocol. No guard is first acquired after a group lock.

Opaque cursor eligibility starts with a new `membership-v1` domain and includes
actor, Household membership/account state, per-row eligibility generations and
eligible source memberships. Generations advance on membership active changes or
account enabled/live-link changes, so leave/rejoin cannot reuse an old scope binding.
They are separate from financial revisions and private, not a second relationship.
Context versions additionally bind current source/member metadata. Sessions remain
actor-scoped; network-only reads and generation guards discard late private responses.

## Existing records and legacy disposition

Forward migration `20261011000000_household_membership.sql` changes read functions
and adds private generation counters. It updates no memberships, identities,
invitations, allocations, expenses, repayments, receipts or audits. Existing valid
members require no new invitation, account, storage reset or designation confirmation.
Pending recipients still Join normally. An accepted old link cannot restore a
subsequently inactive membership. Disabled and unlinked accounts stay denied.

Legacy EMPTY/absent, PENDING, ACTIVE, SUSPENDED, ENDED and CANCELLED states all have
no read authority after migration. Rows and restricted history remain unchanged by
the migration; no historical consent is invented. Existing internal designation
operations and lifecycle audit hooks remain temporarily for compatible rollout and
historical tests. They do not alter the membership scope. Removing those obsolete
operations/hooks is a separate cleanup gate before #197 is complete; retained
serialization and immutable-Household protections must survive that cleanup.

An accepted receipt without its corresponding stable active membership is not
permission to insert one. Operators must inspect original invitation ID, accepted
Auth subject, application identity, membership ID and later departure order. Pending,
incomplete and later-removed admissions differ. No email matching, impersonation or
blanket repair is authorized. Ambiguous evidence requires operator review; no
production admission inconsistency has been established by this implementation.

## Rollout and remaining acceptance

Apply the forward migration before deploying the updated API/web. Existing API
reads call the replaced database functions, so basic membership sharing works across
the compatible rollout. Deploy API with regenerated SDL and then web with updated
Join/failure copy. Old cursors fail safely and require a fresh traversal; web refresh
fetches current scope without clearing storage. Partial rollout may retain old copy
until the web deploy, but must not expose excluded sources or invent zero balances.

No obsolete schema is contracted in this slice. Deployment failure can retry normal
migration/release tooling. Reverting API/web alone does **not** restore old pair
permission: that requires an explicitly reviewed forward migration, not an undo of
applied history or a database reset. Added generation columns may remain unused by
an older binary. Record shipped commits and applied migration version before cleanup.

The Group failure is investigated independently. A successful Group plus a failed
Viewer used to collapse into “Group unavailable”; the updated workspace attributes
safe errors to the owning read and retains retry. The pre-change disposable database
suite passes, so this finding is not proof of the original production root cause.
Production request/session/admission diagnostics and the original partner's read-only
post-rollout confirmation remain blocking acceptance evidence. No synthetic expenses
are created in the real Household. Do not close #197 from fixture results alone.
