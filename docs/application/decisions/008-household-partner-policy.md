# ADR-008: Household partner designation policy

- Status: Proposal for #109; owner agreement and independent design review pending.
- Basis: adopted ADR-007 / #86, implemented #75 and adopted #85.
- Scope: policy and engineering design only; no schema, API or UI implementation.

## Proposed owner decisions

The current enabled, linked Household owner may propose two distinct stable
application-user identities as the household pair. Ownership authorizes proposing,
not automatic designation: both proposed partners must explicitly accept the exact
pair and proposal version while enabled, Auth-linked and active Household members.
The owner may be one partner, but ownership, installation creator permission,
invitations, email addresses and member ordering never imply partnership.

No pre-onboarding placeholder, email designation or invitation acceptance counts as
partner consent. Ordinary #79/#80 admission establishes identity and membership
first. Until a pair is finalized, an authorized viewer sees the Household ledger
and “Shared overview is not available yet”; no partner identity or pending invitation
is disclosed through that fallback. Existing authorized invitation management stays
separate. No extra membership or group-creation authority is granted.

Either current partner may explicitly end the designation without the other's
consent. Ending it clears shared overview access immediately on revalidation and
changes no memberships, balances, ownership or financial history. Existing departure,
owner-transfer and zero-net requirements continue independently. An owner who is not
a partner cannot silently dissolve or replace a finalized pair. Replacement requires
ending the old designation and fresh explicit acceptance from both proposed partners;
no old consent transfers. Pending proposals may be cancelled by their proposer or
either nominee; rejection leaves no finalized pair. A new proposal invalidates prior
proposal consent. Ownership change invalidates an unfinished proposal; finalized
consent survives ownership transfer.

Disabled, unlinked or inactive-Household status of either partner suspends the whole
shared overview for both. Preserve stable designation/history without substituting
another person. Restoring eligibility alone does not reactivate sharing: both partners
must freshly confirm the pair. Ending a designation is available to an otherwise
authorized current partner during suspension; it does not require the unavailable
partner. Current foundation constraints prohibit re-enabling a disabled account or restoring
a removed Auth link. Any future recovery/relinking capability requires separate
review and authorization and cannot match identities by email; this policy does
not enable it. The fresh-consent rule applies if such recovery is later supported,
and to already designed membership readmission. Suspension and termination grant no account-recovery privilege.

Dashboard entry requires the viewer to be one of the finalized, freshly confirmed
partners, enabled, Auth-linked and an active Household member; both partners must
meet those account/membership conditions. An eligible pair sees the Household plus
only ordinary/trip groups where both are currently active members. No other Household
member, owner or friend gets dashboard permission from that role alone. Ordinary
individual group access and complete lifetime financial history are unchanged.

These are proposed product choices, not recorded owner approval. #109 cannot close
until the owner agrees and the design passes independent review.

## Stable identity, consent and audit

Represent the pair conceptually by two distinct immutable internal application-user
UUIDs associated with the existing installation Household pointer. Membership IDs
remain per-group identities; resolve them independently in each eligible group.
Auth IDs, emails, names and invitation IDs are not pair identity. Expose only the
already authorized minimal membership/profile fields, never peer global user IDs.

Use a monotonic designation version separate from financial revision. Consent names
that exact version and pair; stale/duplicate requests cannot approve a later proposal.
Record actor, previous/new state, version and consent/termination events in restricted
audit history. A retry of an identical transition has one effect; conflicting versions
require a fresh authorized read. These are implementation requirements, not new
DDL, retention policy, transport types or an enabled operation.

## Compatible locking and coherent reads

Use READ COMMITTED. Discover candidate identities before locking, then lock all
affected application users in canonical UUID order, then the stable Household
designation guard, then affected groups in canonical UUID order. The guard exists
independently of whether a pair has been proposed; first designation must serialize
through the same guard as later transitions. Its concrete storage awaits schema review.

Dashboard reads take user and designation locks FOR SHARE and group locks FOR SHARE.
Designation/consent writers take user locks FOR SHARE, the guard FOR UPDATE and
Household group lock FOR UPDATE, then recheck owner, membership, status, version
and consent in a fresh statement. User-status/Auth-unlink operations take affected
user locks FOR UPDATE first. Any operation that changes designation state takes the
guard before groups. Existing group-only operations may omit the guard but must never
acquire it after locking a group. They still serialize membership eligibility through
group locks. No operation acquires a user lock after designation/group locks.

If discovery missed a current/new pair user or eligible group, roll back and restart
with an expanded canonical lock set within a bounded deadline. Never append an
out-of-order lock or reuse a snapshot established before waiting. Dashboard reads
recheck the pair, both accounts, Household authorization, eligible groups and complete
projections in one subsequent statement snapshot. Failure to establish the complete
set returns unavailable without sensitive rows or totals.

Suspension must persist across disable/re-enable and leave/rejoin cycles so an
intervening access loss cannot silently restore old consent. Implementation must
coordinate all disabling, Auth unlinking and Household membership transitions with
the designation guard before group locks, recording invalidation atomically. This
requires explicit integration with the managed Auth deletion path and its existing
user-lock protocol; do not add an after-group trigger that reverses lock order.
Runtime race tests must prove the protocol before a dashboard query ships.

## No-disclosure and acceptance trace

Unauthorized direct dashboard or hidden-group reads have the same safe NOT_FOUND
outcome as nonexistent resources. No excluded names, IDs, amounts, counts, nested
nodes, placeholders or inferred partner identity appear. A viewer with ordinary
Household access may receive the ledger fallback without a reason revealing another
account's status. Session/account changes clear cached data; generation guards reject
late responses after access loss. Financial revisions do not prove current eligibility.

| ADR-007 probe        | Required policy outcome and future verification                                                                                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D5: one partner only | Exclude A/C-only X entirely, including totals/counts/nested nodes; A's independently authorized Groups access remains. Test both viewers and hidden direct IDs.                                                                                                         |
| D6: access loss      | B leaving T excludes T only. Either partner losing Household/account eligibility suspends the whole overview and invalidates consent; leave/rejoin and disable/re-enable require new confirmations. Race reads against removal, unlink, replacement and late responses. |
| D7: no partner       | Before both current-version consents, show authorized Household ledger plus unavailable copy; no inferred pair, fake zero, pending-person disclosure or automatic invitation consent.                                                                                   |
| D8: empty/settled    | Include eligible Household even with no extra groups. Empty history differs from settled history; designation changes never erase ledger facts.                                                                                                                         |
| D9: loading/error    | Discovery/revalidation failure hides sensitive cached labels and all totals; no zero/settled claim. Ineligible pair does not become a partial dashboard.                                                                                                                |
| D10: partial rows    | Only freshly authorized eligible rows may show unavailable summaries. A complete H row may render; every overview total stays absent and incomplete is explicit.                                                                                                        |

Independent review must also cover nonpartner owner denial, stale/duplicate consent,
proposal cancellation, ownership transfer, separation with nonzero financial balances,
account recovery, first-designation races and canonical lock ordering. These are
requirements for future execution tests, not claims of runtime verification.

## Delivery boundary

After owner agreement and design adoption, a separate reviewed implementation slice
must supply designation storage/operations, restricted audit, all lifecycle invalidation
paths and real-role concurrency/no-disclosure tests. #111 remains blocked on that
implementation as well as #82 and #104. #112 consumes the reviewed reads. #110 owns
repayment policy and implementation; #73 is unchanged. No hosted resources, paid
capabilities, cross-group financial writes or financial-history deletion are authorized.
