# Architecture decisions

[ADR-001: Backend foundation](001-backend-foundation.md) records accepted platform, money, and membership decisions. [ADR-002: Authentication and database operations](002-authentication-and-database-operations.md) refines O01–O07, including stable-only tooling and free-plan backups. [ADR-003: Bootstrap, groups and invitations](003-bootstrap-groups-and-invitations.md) records the approved #77 baseline and deferred feature boundaries. [ADR-004: Group balances, membership lifecycle and financial recovery](004-group-balances-membership-and-recovery.md) records automatic within-group simplification, the partially superseding departure rule, readmission and recovery requirements from #93. #77’s baseline was delivered by merged [PR #92](https://github.com/haggaikaunda/kami-split/pull/92). [Open decisions](open-decisions.md) tracks questions to resolve before their dependent work begins.

Accepted means agreed design, not implemented functionality. GitHub issues/PRs remain the source of truth for delivery status. Each implementation issue must identify the relevant decisions and acceptance tests.

Clarify these documents through reviewed PRs as we learn. Preserve stable IDs. For a substantive reversal, add a new ADR, link the superseded decision, and explain the change rather than silently rewriting history. Resolve register entries by recording the outcome and linking its ADR/issue; retain the entry for traceability.

[ADR-005: Identity and first expense contract](005-identity-and-expense-contract-proposal.md)
records the accepted #75/#76 design and P1–P4 decisions, including lifetime-of-
financial-history operation recovery records. Uploaded receipt attachments remain
deferred. Design acceptance does not claim implementation; delivery gates still apply.

[ADR-006: Coordinated invitation and onboarding design](006-invitation-onboarding-design.md)
records #79/#80 owner-approved follow-ups including I1–I5 and engineering protocols.
#78 is complete; targeted #79/#80 delivery is on #73’s critical path, while reusable
shared-link implementation is tracked separately in #108. Runtime proof remains required.

[ADR-006: Ordinary and trip-group creation](006-group-creation.md) defines the #85 design-only extension, its contract, UI adaptation and ordered follow-up work. Adoption and implementation are separate.

[ADR-007: Household dashboard](007-household-dashboard.md) specifies #86’s consolidated overview and shared group repayment entry, with explicit policy deferrals and [implementation slices](../proposals/household-dashboard-slices.md). The #111 server summary implements its refined signed-net, space-count and simple expense-total contract; #112 browser integration remains separate.

[ADR-008: Household partner policy](008-household-partner-policy.md) records owner-approved #109 designation, consent, lifecycle and dashboard eligibility policy, including larger Households and no owner self-invitation. The #130 internal designation foundation implements that adopted policy; the decision record itself remains design authority.

[ADR-009: Invitation-scoped Auth continuation](009-invitation-auth-continuation.md) records #164's one-email targeted setup, independently verified shared-link signup, durable one-use proof and explicit interruption/replacement recovery trade-off. It supersedes the earlier two-email/shared-provisioning restrictions while preserving explicit admission and disabled public signup.
