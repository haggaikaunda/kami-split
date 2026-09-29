# Architecture decisions

[ADR-001: Backend foundation](001-backend-foundation.md) records accepted platform, money, and membership decisions. [ADR-002: Authentication and database operations](002-authentication-and-database-operations.md) refines O01–O07, including stable-only tooling and free-plan backups. [ADR-003: Bootstrap, groups and invitations](003-bootstrap-groups-and-invitations.md) records the approved #77 baseline and deferred feature boundaries. [Open decisions](open-decisions.md) tracks questions to resolve before their dependent work begins.

Accepted means agreed design, not implemented functionality. GitHub issues/PRs remain the source of truth for delivery status. Each implementation issue must identify the relevant decisions and acceptance tests.

Clarify these documents through reviewed PRs as we learn. Preserve stable IDs. For a substantive reversal, add a new ADR, link the superseded decision, and explain the change rather than silently rewriting history. Resolve register entries by recording the outcome and linking its ADR/issue; retain the entry for traceability.
