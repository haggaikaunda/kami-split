# Product scope

Kami Split initially supports two invited household members while keeping the domain model extensible to additional members and groups.

## Core capabilities

- Record an expense with description, exact amount, currency, date, payer, participants, and split.
- Support equal and exact-amount splits in the MVP; allow percentage splits later.
- Display a comprehensible running balance and contribution summary.
- Record repayments/settlements between members.
- Show an auditable chronological history.
- Safely edit and soft-delete expenses with concurrency protection.
- Enforce private, server-side authorized access.

## Initial exclusions

Budgets, bank synchronization, receipt scanning, recurring expenses, currency conversion, payment processing, debt simplification, and social features are outside the MVP.

## Seeded UX implementation phase

The [consolidated design](design/README.md) adds trip-associated expenses and spending charts across days, months and years. Implement against an asynchronous data-access port with deterministic in-memory fixtures; database persistence and real sign-in are deferred. Simulated access states are explicitly labeled and are not a security guarantee. Production release still requires server-side authorization. Existing pilot issues remain a separate workflow exercise.
