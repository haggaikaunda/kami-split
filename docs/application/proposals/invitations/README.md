# Coordinated invitation and onboarding design (#79 / #80)

Status: design recommendation for review, not implementation authorization.
Owner-approved policies below stay approved; proposals are explicitly labeled.
This package reconciles the older issue bodies with their newer comments without
reopening #77/#93 or absorbing invitation work into #75/#76. #78 gates affected
implementation, not completion of this design.

## Authority and ownership

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
An old accepted targeted link cannot reactivate membership. An old saved shared
link cannot silently undo departure/removal. **Targeted-only readmission is not an
approved policy.**

## Owner decisions that remain

Recommendations below are concrete proposals, not adopted defaults. No response
or elapsed time constitutes approval.

| ID                              | Recommendation                                                                                                                                                                                                                                                                                                                                  | Consequence / alternative                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1 former members               | Allow shared-link return only with a current owner's explicit, single-use authorization for that specific retained membership and its current departure generation, plus a valid shared link and explicit Join. Fresh targeted invitations remain available.                                                                                    | Keeps shared-link readmission possible while a saved link or general renewal alone cannot restore access. Alternative: allow a newly created shared link issued after departure to readmit; this is simpler but forwarded replacement links can undo deliberate removal without member-specific intent. Targeted-only is another choice, not assumed.                                                                       |
| I2 shared-link controls         | One non-revoked shared link per group, including expired; no total admission cap. Current enabled owner inherits management after transfer; transfer alone leaves links valid. Preview labels the original inviter's current display name.                                                                                                      | Duplicate create returns existing without renewal. Revoke then deliberately create replaces the link. Alternative: multiple links, use caps, or invalidate on transfer; these materially change owner expectations and exposure. Ten invitees is not a ten-use cap.                                                                                                                                                         |
| I3 invitation privacy/retention | Retain minimal invitation/action/admission audit and idempotency records for the group's retained lifetime; no automatic expiry of recovery keys. Clear recipient address/key from terminal targeted rows after 30 days; purge encrypted delivery snapshots within 24 hours after the first send attempt or immediately at terminal transition. | Outstanding (including expired) invitations retain address/key and recoverable token. Terminal token ciphertext is removed immediately regardless of the 30-day address window. This leaves long-lived pseudonymous audit; future deletion/anonymization needs separate design. Alternative shorter audit requires a safe non-replayable key retirement scheme. Financial recovery approval does not approve this proposal. |
| I4 session experience           | 15-minute access tokens, 30-second API clock tolerance, ordinary logout of this session; clearly explain other devices remain signed in.                                                                                                                                                                                                        | The accepted residual-token window remains; global logout is the alternative. Recommend 60-minute Auth verification/recovery links, independently of seven-day application invitations, subject to stable provider configuration proof.                                                                                                                                                                                     |
| I5 delivery placement           | Keep both invitation modes in #79/#80, delivered in the slices below within their existing parent track; no silent deferral of shared links or readmission.                                                                                                                                                                                     | Owner may explicitly move a slice to a later milestone. This design is not approval to ship the expanded scope before decisions/tests are complete.                                                                                                                                                                                                                                                                         |

I1 authorizations are invalidated by a subsequent departure or ownership transfer;
this avoids replay after a second removal and prevents old-owner approvals surviving
transfer. A new targeted invitation must also be issued after the most recent
departure: an outstanding invitation issued while the person was previously active
must not become a future readmission capability merely by being resent. This is
the technical interpretation of NEW invitation, not a change to stable-link resend.

I1 relies on retained identity, not a claim that email can identify a human. A
new Auth subject is not automatically linked to an old member. Preventing a person
from returning with an entirely different account would require a separate identity
or moderation policy; do not introduce email merging to simulate that guarantee.

## Reconciled gates

| Existing gate               | Correct remaining work                                                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #79.1 email policy          | Policy resolved. Implement/test one canonicalizer and supported provider syntax; no alias debate.                                                                          |
| #79.2 verified evidence     | Implement request-bound current Auth response and bounded freshness protocol in technical design; prove email-change/error handling.                                       |
| #79.3 transaction/admission | Review and implement the technical protocol; real restricted-role concurrency proof required.                                                                              |
| #79.4 returning members     | Role/history/stable identity approved. I1 alone chooses shared-link reauthorization; no old-link revival or disabled reactivation.                                         |
| #79.5 / #80.2 delivery      | Commit-versus-send policy resolved. Implement durable action/intent handoff and explicit retry; I3 retention remains owner choice.                                         |
| #80.1 admission             | Reuse #79; do not re-open comparison/delivery/first-time-join policy. Auth interruption and current evidence are engineering tests.                                        |
| #80.3 preview/privacy       | Two-field valid-link preview approved. Generic enumeration-safe responses and callback/provisioning protocol below are engineering recommendations; I2/I3 affect exposure. |
| #80.4 sessions              | I4 remains owner choice. Pin stable SDK/provider configuration and verify local behavior in implementation.                                                                |
| #80.5 contract              | Review proposed operations/results below using merged #76 conventions. No financial contract dependency needs reopening.                                                   |

## Readiness and smallest dependency order

Neither complete issue is implementation-ready: I1–I5 need explicit resolution,
the technical proposal needs review, and affected production work needs #75/#78.
This is a completed design proposal, not a claim of provider/runtime proof.
Design review and a synthetic Auth compatibility experiment can proceed now.

1. Merge the coordinated design after decisions, independent review and required
   checks. Record approved/deferred scope explicitly; keep both feature issues open.
2. Complete #75 restricted identity/membership foundation, then #78 verified
   identity/context. #74 tooling is reused. Synthetic owners avoid a dependency on
   operational #81 bootstrap.
3. #79 targeted storage/token/owner lifecycle plus atomic action/delivery intent.
   Restricted-role and race tests; no exposed unfinished SDL. Then targeted atomic
   admission/readmission with the evidence interface and same-membership tests.
4. #79 shared lifecycle and first-time admission, then I1 readmission authorizations
   if approved. These can be separate PRs, but no shipped former-member path is
   quietly replaced by targeted-only or old-link acceptance.
5. #80 synthetic invite-only Auth/verification/recovery integration; it can develop
   against the agreed interface alongside steps 3–4 after #78. Prove provider
   configuration before public exposure. No hosted resources or real email.
6. #80 Resend adapter and thin implemented onboarding SDL, then owner and invitee
   browser flows in separate focused PRs. Contract documents may precede code;
   public fields arrive only with implementations. Test delivery ambiguity, callback
   security, session isolation and phone/desktop accessibility before shipping.

[Technical design](technical.md) defines protocols and representative operations.
[Validation](validation.md) distinguishes design review from implementation tests.
