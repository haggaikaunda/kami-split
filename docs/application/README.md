# Application documentation

## Current application

The web application is a seeded UX preview with in-memory data and simulated access controls. Start with [product scope](../product-scope.md), [repository layout](../repository-layout.md), and the [implementation guide index](../README.md#implementation-guides). Existing feature documentation stays at its original paths to preserve links.

## Backend and planned features

[API architecture](api-architecture.md) records the agreed Go + gqlgen direction and ownership boundaries. The [local database foundation](database-development.md), [identity/membership boundary](identity-foundation.md), [verified API identity](authentication-boundary.md), and [persisted expense operations](persisted-expenses.md) are implemented. The first expense API includes atomic audit/recovery, signed pagination and complete balances; onboarding and real web integration remain separate. [Agent documentation](../agents/README.md) covers engineering and delivery expectations.

## Architecture decisions

[Accepted foundation decisions](decisions/001-backend-foundation.md) cover Supabase, persistence tooling, money, and membership. The [open-decision register](decisions/open-decisions.md) tracks unresolved choices and when they must be settled. See [decision maintenance](decisions/README.md) for updating them.

[Authentication and database operations](decisions/002-authentication-and-database-operations.md) records O01–O07 outcomes and remaining implementation choices.

[Bootstrap, group boundaries and invitation lifecycle](decisions/003-bootstrap-groups-and-invitations.md) records the #77 baseline, preview differences and separately owned follow-up decisions. Transfer, full trips and consolidated reporting remain deferred.

[Group balances, membership lifecycle and financial recovery](decisions/004-group-balances-membership-and-recovery.md) records #93’s accepted policy, partially superseding the earlier direct-obligation departure restriction. #77 was completed by merged [PR #92](https://github.com/haggaikaunda/kami-split/pull/92). The reviewed first-expense contract and its server implementation now provide deterministic simplification; the preview remains separate.

[Ordinary and trip-group creation design](decisions/006-group-creation.md) records #85’s minimal extension of the implemented identity foundation. No creation API or real trip UI is implemented by that document.
