# Testing strategy

Tests should demonstrate behavior rather than mirror implementation details.

- **Unit tests:** deterministic business rules and validation.
- **Integration tests:** API, persistence, authorization, migrations, and transaction boundaries.
- **End-to-end tests:** a small number of critical user journeys and browser-visible failures.
- **Independent testing pass:** compare acceptance criteria with implementation, identify missing edge cases, and add test-only coverage where useful.

Financial features must cover equal, exact, and percentage splits where supported; rounding; edits; deletion; settlements; duplicates; concurrent changes; invalid and large amounts; currency rules; and date/time-zone behavior.
