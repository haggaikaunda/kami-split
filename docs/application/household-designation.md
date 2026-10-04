# Household partner designation

Issue #130 implements the internal designation foundation required by
[ADR-008](decisions/008-household-partner-policy.md). `DB.HouseholdDesignation`
accepts a previously verified Auth subject and owns a READ COMMITTED transaction.
There is no public partner directory, GraphQL designation operation or UI in this
slice. #111 implements the separate authorized complete `householdDashboard`
summary query using this finalized designation foundation.

## Pair and consent

The installation Household can contain more than two members. Its owner proposes
two distinct enabled, Auth-linked active members by immutable application-user
UUID, in canonical order. The owner may be either nominee or neither; ownership,
invitation acceptance and installation-creator status never count as consent.
Existing memberships are reused without self-invitation or duplicate admission.

A persistent singleton guard exists even before installation bootstrap or the
first proposal. The installed Household pointer cannot be replaced, keeping pair
history attached to its original Household. Its designation version is independent of ledger revisions.
`PROPOSE` supplies the expected current version and advances it; both nominees
must `CONSENT` to the exact new version and exact pair. A replacement pending
proposal discards all prior consent. Stale commands conflict; duplicate current
consent has one effect and one audit event. Only two explicit confirmations make
the state `ACTIVE`.

The proposer or either nominee can `CANCEL` a pending proposal. Either finalized
partner can `END` an active or suspended designation while otherwise authorized.
A non-partner owner cannot end or replace a finalized designation. Replacement
requires ending it and proposing a new version with fresh confirmations.

Ownership transfer cancels pending proposals but preserves finalized pairs.
Household departure or account eligibility loss cancels a pending proposal or
suspends a finalized pair, advances its version, and clears both confirmations.
Readmission alone leaves the pair suspended. Both partners must confirm the new
version after eligibility is restored. This adds no account re-enable or Auth
relink capability; existing immutable identity restrictions still apply.

## Authorization, audit and failures

The internal operation returns only state and version, never peer global IDs,
email addresses or account status. Current Household membership and account
eligibility are rechecked after acquiring locks. An unauthorized caller receives
`NOT_FOUND`; authorization precedes conflict information. Ordinary group ledger
access, financial balances and ownership remain governed by their existing rules.

Guard and audit tables have RLS enabled and no direct runtime or browser grants.
Restricted audit records capture version, pair, actor, previous/new state and
proposal, consent, finalization, cancellation, suspension and termination events.
Privileged lifecycle changes without a verified application actor use a null
actor instead of attributing the change to the affected member. Stable identities
and audit history remain after managed Auth deletion.

## Lifecycle and lock order

Designation operations discover the actor and affected pair/proposer identities,
lock application users in UUID order FOR SHARE, lock the guard FOR UPDATE, then
lock the Household group FOR UPDATE. A fresh statement rechecks authorization and
eligibility. If discovery missed a newly current identity, SQL requests a complete
transaction restart. The Go boundary retries at most three times within a
five-second context deadline, returning `UNAVAILABLE` if it cannot establish the
complete set. An uncertain commit must be followed by a fresh authorized read
before attempting a different transition.

Privileged Household membership or ownership changes call
`app.household_lifecycle_lock(affected_user_ids)` in the same transaction before
locking groups or changing rows. The helper discovers and locks the current pair
and proposer plus affected users, then the guard and Household. It can request a
transaction restart with SQLSTATE `40001`; callers must roll back and rediscover,
never append locks after the group. Triggers reject all unprepared Household active-membership or ownership changes,
including before the first proposal. Invitation admission acquires this protocol before restoring
a Household membership. These hooks add designation invalidation, not a new
membership removal API or exemption from existing departure rules.

Account disable/unlink takes user locks before guard invalidation. The account
lifecycle statement trigger locks application users in canonical order, including
for multi-row updates; this intentionally serializes rare account lifecycle
changes. Regular profile changes do not use that trigger. Managed Auth deletion
continues to require prior application-account disable, and FK-driven live-link
removal passes through the same invalidation hook. No trigger acquires the guard
for the first time after a group lock.

## Verification

`make db-test` checks upgrade preservation, fresh migration replay, desired-schema
and ACL reconciliation, restricted-role behavior and real PostgreSQL integration
races. The database designation tests cover consent and lifecycle behavior;
existing identity, invitation, Auth and financial suites remain required.
`make api-check`, `make db-generation-check`, and the root pnpm checks also apply.
