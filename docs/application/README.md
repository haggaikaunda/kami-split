# Application documentation

## Current application

The web application is a seeded UX preview with in-memory data and simulated access controls. Start with [product scope](../product-scope.md), [repository layout](../repository-layout.md), and the [implementation guide index](../README.md#implementation-guides). Existing feature documentation stays at its original paths to preserve links.

## Backend scaffold and planned features

[API architecture](api-architecture.md) records the agreed Go + gqlgen direction and ownership boundaries. A health-only scaffold and [local database foundation](database-development.md) exist; financial and authenticated behavior is still planned. [Agent documentation](../agents/README.md) covers engineering and delivery expectations.

## Architecture decisions

[Accepted foundation decisions](decisions/001-backend-foundation.md) cover Supabase, persistence tooling, money, and membership. The [open-decision register](decisions/open-decisions.md) tracks unresolved choices and when they must be settled. See [decision maintenance](decisions/README.md) for updating them.

[Authentication and database operations](decisions/002-authentication-and-database-operations.md) records O01–O07 outcomes and remaining implementation choices.
