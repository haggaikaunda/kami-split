# Historical designation and current Household lifecycle

[ADR-010](decisions/010-household-membership-sharing.md) supersedes the separate
pair consent gate. Active Household membership authorizes sharing; no designation
operation, second confirmation or setup screen exists in the runtime.

## Retained history

Migration 012 retires the unused internal Go operation and SQL pair command,
audit mutation helpers and pair invalidation behavior. Prior migrations and
restricted designation/audit tables remain intact. EMPTY/absent, PENDING, ACTIVE,
SUSPENDED, ENDED and CANCELLED rows have no permission authority. The retirement
migration neither changes historical rows nor writes new consent/audit events.
[ADR-008](decisions/008-household-partner-policy.md) preserves the former policy and
approval evidence. The immutable installation Household pointer keeps history
attached to its original group.

The table historically named `household_designation_guard` retains its singleton
as a technical scope serialization point. Its legacy pair/proposer/version/consent
columns are never inputs to runtime authorization or lock discovery. Restricted
storage remains inaccessible to the API role and browser.

## Current lifecycle and lock order

Dashboard/Expenses/Activity reads discover active Household users and the actor,
lock users in UUID order FOR SHARE, then the singleton FOR SHARE, then eligible
groups in UUID order FOR SHARE. Fresh discovery after waits detects missing users
or new sources. Reads restart a whole transaction within bounded attempts/deadline;
no out-of-order lock or old snapshot may be appended/reused.

Privileged Household membership/ownership changes call
`app.household_lifecycle_lock(affected_user_ids)` before group locks or mutations.
It discovers current and historical Household users plus affected users, locks
users in UUID order, locks the singleton FOR UPDATE, rechecks discovery and then
locks the Household FOR UPDATE. Membership/ownership triggers retain the same
transaction preparation marker and reject unprepared transitions. Invitation
admission/readmission uses this protocol and stable identities. Existing financial
departure rules and active-owner constraints remain unchanged; this is no new
removal or ownership API.

Account disable/unlink retains the canonical application-user statement lock and
per-row discovered-user safety check. Managed Auth deletion still requires prior
application-account disable; immutable identity restrictions prohibit re-enabling
or relinking. These paths no longer mutate a pair state or require fresh consent.
Membership/account eligibility revisions advance independently and invalidate
Household Expense/Activity cursors even across leave/rejoin. Account loss never
silently removes an active member from the common source intersection.

## Verification and rollout

`make db-test` verifies compatible previous-schema membership upgrade, retirement
of nonempty legacy command/history state, same-account access and pending denial,
restricted-role permissions, canonical locking/races, fresh migration replay,
schema/ACL reconciliation and financial dump/replay. Required Go, web and generation
checks and independent tester/reviewer gates apply to each delivery PR.

Production Group failure diagnosis, applied migration/shipped-commit evidence and
the originally invited partner's confirmation remain #197 rollout gates. Neither
historical fixtures nor a fresh demo establish production-account recovery.
