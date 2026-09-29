# ADR-003: Bootstrap, group boundaries, and invitation lifecycle

- Status: Accepted policies; production behavior is not implemented by this ADR. Ownership transfer is low-priority, deferred implementation; group/trip creation and consolidated reporting are future design work.
- Recorded: 2026-09-29.
- Authority: Owner-approved policies in [#77](https://github.com/haggaikaunda/kami-split/issues/77), following the membership design discussion.
- Relationship: Refines [ADR-001 D4](001-backend-foundation.md#d4-identity-and-membership) and [ADR-002 O01/O03](002-authentication-and-database-operations.md). Their other platform, money, authentication and security policies remain in force. Stable register IDs O09/O10 are retained.

## Context and delivery boundary

The seeded UI models trips inside a household snapshot and invitations as pending members. Those shapes demonstrated UX, not the production access model. The approved backend needs explicit bootstrap, independent group ledgers, and predictable invitation admission without duplicating identities or restoring revoked access.

This is the baseline decision record for [#73](https://github.com/haggaikaunda/kami-split/issues/73). It does not implement bootstrap, authentication, invitations, membership, ownership transfer, trips, reporting or financial operations; publish business SDL; create accounts/send emails; or provision hosted/paid services. Local tooling [#74](https://github.com/haggaikaunda/kami-split/issues/74) proceeds independently. Acceptance of a policy is not completion of its implementation or approval of remaining design questions.

## B1: Explicit administrative bootstrap (O09)

Administratively create the explicitly designated first Supabase Auth account using supported administration, then establish its password through normal emailed password recovery. Public signup stays disabled; email verification remains required. Never retain or share the random initial password in scripts, logs or Git.

In one application-database transaction, provision the stable application user linked to that exact Auth ID, an empty USD group displayed as **Household**, and its sole active owner membership. Auth account creation is outside that transaction. This is the explicit first-account exception to ADR-002's ordinary verified, invitation-based provisioning; it does not create another public onboarding path.

A small operator-only runbook/helper is sufficient. There is no public bootstrap endpoint, special bootstrap invitation, first-group setup UI, or automatic bootstrap based on an apparently empty database. Reruns must recognize the original identity/group without duplicating them, resetting subsequently transferred ownership, relinking by email, or reactivating disabled access. Real account data belongs in neither schema migrations nor synthetic fixtures.

Only that designated stable application identity may create additional groups for now. Do not infer the grant from whichever account sorts first. It survives email changes, does not follow ownership transfer, and does not automatically pass to a replacement account. Its concrete representation remains a schema choice in [#75](https://github.com/haggaikaunda/kami-split/issues/75).

Rationale: explicit identity selection avoids accidental privilege assignment and keeps a one-time setup small. Consequences: Auth and application provisioning can fail independently; retries must preserve established state rather than repair it by resetting permissions. [#81](https://github.com/haggaikaunda/kami-split/issues/81) owns the operator procedure and reuses [#80](https://github.com/haggaikaunda/kami-split/issues/80)'s ordinary recovery UI. That implementation must test administrative creation, recovery, verification, password update and access on the selected stable Supabase version, including partial failure. This ADR does not guarantee untested provider recovery behavior or authorize execution against real accounts.

## B2: Groups are independent access and financial boundaries

One group/membership foundation serves the private household, trips, and arbitrary non-trip groups. A trip is a group with a trip classification and structured metadata. A generic tagging framework is not approved.

Each expense and settlement belongs to exactly one group. Balances and settlement obligations remain independent between groups: no automatic cross-group netting, transfers, or duplicated records. For example, owing someone USD 10 in one group and being owed USD 10 in another does not settle either obligation.

The initial household is for the designated user and partner. Friends see only groups they join; a trip invitation grants no household access. This is not a universal two-person group limit. Household/trip navigation is additional UI, not a new global account-role hierarchy. Group membership remains the authorization boundary, including for expense participants who are only a subset of that group.

Rationale: the same foundation supports different group experiences without sharing private household data with trip participants. Consequences: every financial read/write must retain group provenance and authorization; classifying a group as a trip creates neither a second ledger nor inherited access. Minimal membership foundations belong to #75; full group/trip design is [#85](https://github.com/haggaikaunda/kami-split/issues/85), outside #73's completion requirements.

## B3: Household dashboard and group-specific repayment

Distinguish the household **group** from the household **dashboard**. The dashboard includes the household plus ordinary/trip groups where **both partners are active members**. A group joined by only one partner remains accessible through that person's authorized Groups experience but is excluded from the shared overview. This inclusion rule does not waive server authorization.

The dashboard may explain balances by source group and open a repayment form targeting that original group without visiting its detail page. It creates one settlement in the target group, no household copy and no overall debt to settle. A cross-group total of zero is not proof that each group is settled, nor does summing different members’ nets prove their individual settlement. The earlier additional within-group direct-obligation departure safeguard is superseded by [ADR-004 C1/C2](004-group-balances-membership-and-recovery.md#c1-automatic-simplification-within-one-group-and-currency): each individual net determines financial settlement under automatic within-group simplification.

Exact combined-versus-individual metrics, “our spending” and average-trip-spend formulas, household designation representation, and historical reporting after membership changes remain undecided in this baseline. Combined allocated shares were a proposal, not an accepted formula. A private-household-expense-to-trip-report association was not adopted.

Rationale: convenient consolidated navigation must preserve the meaning of each obligation. Consequences: future reporting must define perspective and complete authorized aggregates without double counting or hiding offsetting debts. [#86](https://github.com/haggaikaunda/kami-split/issues/86) owns the future design with #85; neither reporting nor settlement implementation becomes a #73 dependency.

## B4: Ownership transfer (O09), implementation deferred

The current owner may explicitly confirm transfer to another active same-group member whose application account is enabled. Pending invitees, inactive members, disabled accounts and members of other groups are ineligible. There is no separate recipient-acceptance workflow.

Transfer is atomic and preserves exactly one active owner. The former owner remains an ordinary active member. There is no implicit departure, financial change or transfer of the separate group-creation permission. Under [ADR-004 C2](004-group-balances-membership-and-recovery.md#c2-departure-removal-visibility-and-readmission), leaving/removal requires the target’s individual group net to be exactly zero, alongside authorization and ownership checks. This supersedes this section’s earlier additional direct-obligation restriction; cross-group cancellation remains prohibited.

Rationale: a single confirmed action avoids ambiguous dual ownership while separating management rights from finances and creation authority. Consequences: the initial schema must enforce exactly one active owner and deny owner-removal/demotion bypasses even before transfer exists. Concrete ownership constraints, locking and safe-departure protocols need schema review. Transfer service, GraphQL and UI are low-priority deferred work in [#84](https://github.com/haggaikaunda/kami-split/issues/84), outside #73/#75/#76. Deferral is not permission to leave a committed ownerless group.

## B5: Invitation lifecycle (O10)

Invitations are separate from memberships; pending invitations grant no access. Ordinary admission still requires a registered account and the matching **current verified email**, with stable application identity and no email-based account merging. Supabase verification/recovery tokens and application invitations have separate lifecycles.

- Initial expiry is seven days. Explicit resend preserves the same invitation, token and link and sets expiry to seven days from resend, including an expired outstanding invitation. Older copies of that link share the extended expiry.
- At most one outstanding invitation (neither accepted nor revoked) exists per group/email, including expired invitations. A duplicate create shows the existing invitation and explicit Resend action; it creates nothing and sends no automatic email. Active members do not need invitations.
- Accepted/revoked invitations are terminal. A later appropriate invitation must be deliberately created with a new link.
- Same-user duplicate acceptance grants membership once. An old accepted link cannot reactivate a removed membership. Rejoining requires a new invitation and preserves membership identity. [ADR-004 C2](004-group-balances-membership-and-recovery.md#c2-departure-removal-visibility-and-readmission) resolves the #77 baseline’s open restoration questions: ordinary-member access to full history, including absence-period activity, without reviving former ownership or disabled access.

State changes serialize by committed order, not click order or email arrival:

| First committed transition | Required later outcome                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| Acceptance                 | Revoke/resend report already accepted and do not remove membership.                                       |
| Revocation                 | Acceptance is denied; resend cannot revive the invitation. An email already in transit cannot restore it. |
| Resend                     | Acceptance checks the extended expiry.                                                                    |

Rationale: explicit reuse and terminal states give owners predictable links without duplicate admission. Consequences: [#79](https://github.com/haggaikaunda/kami-split/issues/79) must implement and test concurrency, duplicate creates/acceptance, expiry and rollback using a reviewed database protocol with #75. [#80](https://github.com/haggaikaunda/kami-split/issues/80) owns delivery and browser onboarding. A database commit and email send are not one atomic action. Email comparison/canonicalization, trusted current-verification evidence, expiry boundary/clock, authorization rechecks, admission/locking protocol, delivery-failure semantics and retry/result retention require follow-up design; the accepted lifecycle does not silently answer them.

## B6: Reusable token protection (O10)

Generate each token once from **32 cryptographically random bytes**, URL-safe encoded. Store a verification hash and an authenticated-encrypted recoverable copy for same-link resend. Use standard cryptography, such as AES-GCM, not custom crypto.

Keep encryption keys in backend secret storage, separate from the database, browser and Git. Retain recoverable ciphertext for outstanding invitations, including expired ones. On acceptance/revocation, remove ciphertext from the **live invitation record**, retaining the hash/outcome for secure retries and audit. This is not erasure from backups or already-sent email.

Key rotation must preserve the token/link. Missing keys or decryption failures fail resend safely rather than silently replacing the link. Exclude tokens from logs, analytics and ordinary invitation reads; invitation pages must prevent URL/referrer leakage.

Rationale: a verification hash alone cannot recover a reusable link; authenticated encryption supports resend while limiting exposure of recoverable secrets. Consequences: #79 needs key-availability, integrity, rotation, terminal cleanup and leakage tests, coordinated with #80's page/delivery handling. Concrete ciphertext format, key management and retention durations remain design/implementation details. This decision does not select a custom encryption format, backup-erasure guarantee or unlimited retention policy.

## Seeded preview evidence and production differences

Historical feature guides and tests remain evidence of the delivered preview. This ADR changes neither code nor mock behavior.

| Current preview evidence                                                                                                                                                                                                                                  | Approved production direction                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [DataPort](../../../apps/web/src/lib/data/port.ts) has a household-scoped `Snapshot`/`Envelope`, embedded `Trip[]`, and `Member.status = pending`.                                                                                                        | Independent group memberships and ledgers; separate invitation records. Preview types are not the new schema or published business SDL.                                   |
| [Household setup](../../household/README.md) creates a named empty household via simulated entry; name-only invitation and role controls model pending members and allow multiple owners while guarding the last owner.                                   | Administrative first-account bootstrap; verified-email invitations; exactly one active owner. Deferred atomic transfer replaces production role-toggle assumptions.       |
| [Trip selectors](../../../apps/web/src/lib/trips.ts), [trip detail](../../../apps/web/src/lib/trip-detail.ts) and [detail UI](../../../apps/web/src/components/trips/destination.tsx) filter household expenses by `tripId` and open household repayment. | A trip is its own group; an expense/settlement belongs to that group. A shortcut must target the original group, not Household.                                           |
| [Overview](../../overview/README.md) and [repayment](../../repayment/README.md) use one session household snapshot; trip spending excludes repayments.                                                                                                    | Future consolidated dashboard uses the both-active-partners rule and source-group settlements. It must not infer complete production balances from a loaded expense page. |

See [ledger](../../ledger.md), [product scope](../../product-scope.md), [trips](../../trips/README.md) and [trip detail guide](../../trips/detail.md). Their historical totals, screenshots, acceptance counts and UX contracts are preserved, not rewritten as evidence of production functionality.

## Remaining decisions and issue ownership

The [register](open-decisions.md) retains O01–O17 and adds O18/O19 for group/reporting design. O09/O10 are partially resolved, not closed. O08 money, O13 API conventions and O14 Relay/recovery are not resolved by this ADR; #76 owns the first financial contract with #83's integration work. O11/O12 correction, closure and departure questions remain for their own workflows.

[ADR-004](004-group-balances-membership-and-recovery.md), authorized by [#93](https://github.com/haggaikaunda/kami-split/issues/93), documents the later membership, minimal-disclosure and same-attempt recovery approvals. Its automatic within-group simplification partially supersedes B3/B4's earlier direct-obligation departure restriction. Other baseline policies remain in force. #77 was completed by merged [PR #92](https://github.com/haggaikaunda/kami-split/pull/92); these follow-ups do not reopen it. Exact schema, profile fields, balance matching and recovery protocol/retention/client-state choices still need review in #75/#76/#79/#83. The new ADR does not make those issues implementation-ready or resolve O08/O13/O14 wholesale.
