# Application documentation

## Current application

The web application includes an [authenticated expense journey](relay-expenses.md) at `/groups` alongside explicitly labeled seeded preview routes with in-memory data and simulated access controls. Start with [product scope](../product-scope.md), [repository layout](../repository-layout.md), and the [implementation guide index](../README.md#implementation-guides). Existing feature documentation stays at its original paths to preserve links.

## Backend and planned features

[API architecture](api-architecture.md) records the agreed Go + gqlgen direction and ownership boundaries. The [local database foundation](database-development.md), [identity/membership boundary](identity-foundation.md), [verified API identity](authentication-boundary.md), and [persisted expense operations](persisted-expenses.md) are implemented. The first expense API includes atomic audit/recovery, signed pagination and complete balances; internal [targeted invitation operations](targeted-invitations.md) add lifecycle, durable delivery recovery and admission. The [onboarding integration](onboarding.md) connects Auth, email, sessions and real entry pages. The internal [Household partner designation](household-designation.md) adds explicit consent and lifecycle invalidation; the separate #111 `householdDashboard` implements coherent authorized summary reads. The [Relay expense journey](relay-expenses.md) connects real financial browser reads, creation and recovery. [Agent documentation](../agents/README.md) covers engineering and delivery expectations.

## Architecture decisions

[Accepted foundation decisions](decisions/001-backend-foundation.md) cover Supabase, persistence tooling, money, and membership. The [open-decision register](decisions/open-decisions.md) tracks unresolved choices and when they must be settled. See [decision maintenance](decisions/README.md) for updating them.

[Authentication and database operations](decisions/002-authentication-and-database-operations.md) records O01–O07 outcomes and remaining implementation choices.

[Bootstrap, group boundaries and invitation lifecycle](decisions/003-bootstrap-groups-and-invitations.md) records the #77 baseline, preview differences and separately owned follow-up decisions. Transfer and consolidated reporting remain deferred. Independent trip metadata and authenticated discovery are implemented under #104/#105.

[Group balances, membership lifecycle and financial recovery](decisions/004-group-balances-membership-and-recovery.md) records #93’s accepted policy, partially superseding the earlier direct-obligation departure restriction. #77 was completed by merged [PR #92](https://github.com/haggaikaunda/kami-split/pull/92). The reviewed first-expense contract and its server implementation now provide deterministic simplification; the preview remains separate.

[Ordinary and trip-group creation design](decisions/006-group-creation.md) records #85’s minimal extension of the implemented identity foundation. The design document itself implements no features; #104 implements the creation/metadata API and #105 implements authenticated discovery. Creation forms remain separate.

[Household dashboard and group repayment design](decisions/007-household-dashboard.md) records #86’s complete-read, individual-balance and original-group recovery requirements. Partner designation (#130), append-only repayment API (#110) and summary reads (#111) are implemented. The summary uses one signed informational viewer net, eligible/open-space counts and simple expense face-value totals. #169 adds cross-space/group expense feeds with structured filters and complete filtered/month totals; free-text search remains #177. Couple-spending/average/history formulas and #112 browser integration remain deferred.

- [Targeted onboarding](onboarding.md): actual invitation, verification, sessions, recovery and provider delivery configuration.

The [administrative bootstrap runbook](bootstrap.md) covers explicit first-account
and Household creation, safe retries, and the ordinary verified-email recovery
flow. Hosted execution requires separate authorization.

The [production deployment configuration](production-deployment.md) records the
approved #140 Vercel, Cloud Run, Supabase, and GitHub environment contract. It
records the provisioned provider foundation, completed production configuration,
gated API and web deployment workflow, and operating procedures without claiming
that the application is already serving production traffic.

## Authenticated financial browser

The [Relay expense journey](relay-expenses.md) connects admitted groups, bounded expenses, creation, complete balances and original-attempt recovery at `/groups`. [Authenticated Activity](activity.md) adds complete group and Household event feeds with source-aware current details. Other preview routes remain explicitly simulated.
