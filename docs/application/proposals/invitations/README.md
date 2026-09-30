# Coordinated invitation and onboarding design (#79 / #80)

Status: owner decisions accepted; engineering protocols require implementation validation.
Owner-approved policies below stay approved; proposals are explicitly labeled.
This package reconciles the older issue bodies with their newer comments without
reopening #77/#93 or absorbing invitation work into #75/#76. #78 is complete and
no longer blocks implementation. Merge and final-head workflow gates still apply.

## Authority and ownership

The [owner I1–I5 decisions](https://github.com/haggaikaunda/kami-split/pull/101#issuecomment-5904210048)
are authoritative and supersede earlier proposals below. Targeted invitations and
onboarding are on #73’s critical path; reusable shared-link implementation is
tracked separately in [#108](https://github.com/haggaikaunda/kami-split/issues/108).

- [#79 email/delivery approval](https://github.com/haggaikaunda/kami-split/issues/79#issuecomment-5886277636)
  and [#80 counterpart](https://github.com/haggaikaunda/kami-split/issues/80#issuecomment-5886282411).
- [#79 preview/shared-link decision](https://github.com/haggaikaunda/kami-split/issues/79#issuecomment-5886419039)
  and [#80 counterpart](https://github.com/haggaikaunda/kami-split/issues/80#issuecomment-5886424614).
- [#79 first-time admission approval](https://github.com/haggaikaunda/kami-split/issues/79#issuecomment-5886876182)
  and [#80 counterpart](https://github.com/haggaikaunda/kami-split/issues/80#issuecomment-5886881918).
- [ADR-003](../../decisions/003-bootstrap-groups-and-invitations.md),
  [ADR-004](../../decisions/004-group-balances-membership-and-recovery.md),
  [ADR-005](../../decisions/005-identity-and-expense-contract-proposal.md) and
  [shared identity/locking contract](../first-expense/shared.md).
  PR #95 is merged. Its later lifetime-of-financial-history recovery policy
  supersedes its earlier receipt deferral; it does not settle invitation retention.

| Owner     | Responsibilities                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #79       | Invitation tables, token protection, preview projection, owner operations, action/result persistence, delivery intent, lifecycle, atomic application identity/membership admission and readmission.    |
| #80       | Supabase provisioning/verification/password/session integration, current-email evidence adapter, Resend transport, owner/invitee browser UX, and reviewed thin onboarding GraphQL adapter calling #79. |
| #75 / #78 | Stable identities, permanent membership uniqueness, restricted RLS/helper foundations / verified subject and transaction-local claims. No duplicate foundations here.                                  |

## Settled policy

Targeted invitations compare trimmed case-insensitive addresses consistently for
uniqueness and current verified-email acceptance. Preserve dots/plus suffixes;
never link accounts by email. Address corrections revoke and deliberately create
an invitation with a new link. Keep one outstanding targeted invitation per
(group,email key), including expired ones. Duplicate create sends nothing.

Targeted create and explicit resend set seven-day validity; resend preserves ID
and exact token/link, including after expiry. Accepted/revoked states are terminal.
Creation/expiry extension remains committed after email failure or uncertainty.
Recovering the same action cannot extend expiry again; deliberate Resend is a new
action. Provider acceptance is not recipient delivery.

Valid-link possession alone may reveal group name and inviter display name before
sign-in. Nothing else about group finances, member lists or recipient accounts is
public. Preview never admits or consumes. Invalid/expired/revoked links do not
receive this disclosure grant.

Shared links are an additional explicit invitation kind: owner distributed,
multiple recipients, no application email on create/copy/renew, seven-day validity,
explicit same-link renewal including after expiry, terminal revocation. Joining,
viewing and copying do not renew; joining does not consume the whole link.
Revocation/expiry blocks further admission, not existing membership.

Eligible registered, signed-in, currently verified first-time group recipients,
including forwarded-link recipients, explicitly choose Join group and join
immediately without an owner queue. Application provisioning and admission are
atomic; incomplete Auth provisioning alone grants nothing. Successful admission
is ordinary membership with full history, no ownership or creation permission.
Disabled accounts remain denied.

Readmission preserves the same membership identity, ordinary role and full history.
An old accepted targeted link cannot reactivate membership. Former members must
use a **new targeted invitation** after departure/removal. Shared links admit only
first-time members in the initial shared-link feature; renewal cannot undo removal.
No departure-generation/owner-tenure-bound readmission grant system is required.
A different Auth subject never merges into an existing identity by email.

## Accepted owner decisions I1–I5

- **I1:** Targeted-only former-member return, preserving stable membership, ordinary
  role and full history; no restored ownership or group-creation permission.
- **I2:** One outstanding non-revoked shared link per group, including expired;
  no fixed use cap. Duplicate create returns existing without renewal. Revoke then
  explicitly create to rotate. Management follows the enabled current owner;
  ownership transfer alone leaves links valid. Implement in #108.
- **I3:** Retain only minimal non-sensitive invitation/action/admission audit and
  idempotency data needed for history, safe retries and duplicate protection.
  Keep targeted email/comparison data and recoverable token ciphertext while
  outstanding, including expired, and remove both on accepted/revoked transition.
  Encrypted delivery material survives only the bounded recovery period needed
  for uncertain sending, then is purged. There is no 30-day recipient retention.
  Engineering selects and validates the smallest reliable purge mechanism/timing;
  broader deletion/anonymization remains separate.
- **I4:** Fifteen-minute access tokens; ordinary logout ends the current session/
  device, with UI explaining other devices may remain signed in. Global logout
  is later work. Clock tolerance, refresh and stable provider configuration are
  engineering choices. Auth verification/recovery expiry is independently selected
  and validated, not coupled to seven-day application invitations.
- **I5:** Targeted invitations (#79) plus onboarding (#80) are on #73’s critical
  path. Shared lifecycle/forwarding/renewal/UI remain designed here but delivery
  belongs to #108, without blocking the first persisted expense journey.

## Reconciled gates

| Existing gate               | Correct remaining work                                                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #79.1 email policy          | Policy resolved. Implement/test one canonicalizer and supported provider syntax; no alias debate.                                                                                  |
| #79.2 verified evidence     | Implement request-bound current Auth response and bounded freshness protocol in technical design; prove email-change/error handling.                                               |
| #79.3 transaction/admission | Review and implement the technical protocol; real restricted-role concurrency proof required.                                                                                      |
| #79.4 returning members     | I1 resolved: new targeted invitation only; stable ordinary membership/full history; no old-link or disabled revival.                                                               |
| #79.5 / #80.2 delivery      | Commit-versus-send policy resolved. Implement durable action/intent handoff and explicit retry; I3 terminal privacy cleanup is approved.                                           |
| #80.1 admission             | Reuse #79; do not re-open comparison/delivery/first-time-join policy. Auth interruption and current evidence are engineering tests.                                                |
| #80.3 preview/privacy       | Two-field valid-link preview approved. Generic enumeration-safe responses and callback/provisioning protocol below are engineering recommendations; I2/I3 boundaries are approved. |
| #80.4 sessions              | I4 session experience is approved. Pin stable SDK/provider configuration and verify local behavior in implementation.                                                              |
| #80.5 contract              | Review proposed operations/results below using merged #76 conventions. No financial contract dependency needs reopening.                                                           |

## Readiness and smallest dependency order

The product decisions are resolved. Once PR #101 is reviewed and merged, #79 can
proceed through the normal implementation workflow. #75 and #78 are complete;
reuse their restricted identity/membership and verified-request foundations.
Engineering must validate the current-email, provider, locking and recovery
protocols; design acceptance does not claim runtime proof.

1. Merge the coordinated design after independent review and required checks.
   Keep #79/#80 open until their implementation acceptance criteria are satisfied.
2. Implement #79 targeted storage/token lifecycle, owner create/list/resend/revoke,
   durable action/delivery intents and recovery, then atomic targeted admission and
   same-membership readmission. Require real restricted-role and race coverage.
   No unfinished SDL or shared-link implementation is part of this critical path.
3. Hand #80 concrete internal interfaces for current-email evidence, preview,
   owner operations, action recovery, delivery claim/completion and admission.
   #80 owns synthetic invite-only Auth/verification/recovery proof, Resend transport,
   reviewed thin SDL and owner/invitee browser flows. No hosted resources or real
   email. #79 does not implement #80’s provider/browser adapters.
4. Deliver reusable shared lifecycle, forwarding, renewal and shared-link UI under
   #108 as a separate follow-on. Shared links remain first-time-only; no readmission
   grants are part of either initial feature.

[Technical design](technical.md) defines protocols and representative operations.
[Validation](validation.md) distinguishes design review from implementation tests.
