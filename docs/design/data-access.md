# Seeded data and replaceable access boundary

## Scope

Implement the UI against an injected async application-service port. Its initial adapter is an in-memory store created from deterministic fixtures. Components may not import seed arrays, query mutable globals, use member names as IDs, call storage directly, or embed pair-specific financial calculations. Database/schema/migration work and real network/auth providers are excluded.

Use a single session-scoped store across routes; do not recreate it on component mount. Reload/reset explicitly restores fixtures. No localStorage/IndexedDB persistence is required. The port can later be implemented by an authorized server API without changing screen components. Do not describe an in-memory denial check as server security.

## Suggested contract responsibilities

The exact TypeScript names can change, but observable behavior must be covered by adapter contract tests:

- Context: current simulated actor/session, household, members/roles/statuses, injected clock and ID source.
- Queries: expense by ID/revision; active expenses with scope/filters; cursor-ready activity ordering; trip list/detail; balance/contributions; chart buckets or raw domain facts for shared pure selectors; pending invitations; operation status.
- Commands: create/update/soft-delete expense; record repayment; create trip; update household; simulate invite/resend/revoke/accept/decline and permitted membership transitions.
- Command envelope: household ID, client operation ID, payload, expected revision for changes. Actor comes from adapter context, not an editable actor field.
- Typed outcomes: success, validation errors by field, not found/unavailable, denied, session expired, conflict with current revision, already deleted, duplicate request/result, retryable offline/network error and unknown completion.
- Request cancellation and invalidation: define how screens avoid stale query responses replacing newer ones; never cancel a committed mutation merely because a component unmounts.

Keep domain calculations pure, with read models shared across overview, charts, trips and detail. Return copies/immutable snapshots, not mutable store references. A future API adapter maps server results to the same interface; no mock-only booleans scattered through screen code.

## Domain records and invariants

Use stable IDs for household/member/expense/trip/repayment/revision/event/operation. Expense has amount in integer minor units, ISO currency, effective local date (YYYY-MM-DD), description, payer ID, explicit participant IDs, split method, member-ID allocations, optional category/trip/note, creator ID, server-like creation/update timestamps and version. Revision contains a complete immutable snapshot and actor/event metadata. Repayment has sender/recipient IDs, amount/currency/date/note. Deletion is a revision/event, not physical removal. Preserve inactive members' historic identities.

All money inputs parse exactly; define and test a maximum below unsafe integer accumulation. Equal remainder allocation is deterministic and visible. For every expense, paid amount and allocated shares each sum to total; zero-share included members remain participants. For each currency, member net = expenses paid - allocated shares + repayments sent - repayments received. Sum of member positions is zero. Test three members and a nonparticipating payer; no debt simplification. Household and trip charts share selectors so trip-linked expenses are counted once. Dates for spend aggregation are effective dates; audit ordering uses timestamp plus monotonic sequence.

## Mutations, retries and concurrency without a database

The seed adapter performs validate → commit revision/financial state/event → return result as one indivisible operation. No partial updates even under injected failure. Duplicate operation ID with same payload returns original result; same ID with different payload returns an explicit conflict. Expected-version mismatch leaves state unchanged and returns latest revision for comparison. On timeout-after-commit, querying/retrying original operation resolves the original result rather than creating a duplicate. These semantics prepare later persistence; they are not deferred merely because storage is in memory.

Add deterministic development scenarios: empty household/trip, slow load/save, denied/inaccessible ID, expired session, failure before commit, timeout after commit, second-editor revision change and concurrent deletion. Inject them through the adapter/test harness, not random timing or success toasts. Reset must clear mutable state, operation results and revisions and reapply a named fixture. No real financial data.

## Fixtures and future transition

Port the sample values from [prototype/](prototype/) into typed fixtures without importing prototype JS. Clock: 2026-09-20. Initial debt: Kaunda owes Mizenin $42.18. Maui total $1,644.20 (Sep 5–13, 2026), Tahoe $840.00, upcoming Porto May 12–18, 2027. September 2026 household spend $1,914.56; 2026 spend $3,666.56; all-year spend $5,126.56. Names/amounts are examples, not actual travel prices. Also create a separate 3-member contract fixture; do not change the visual sample to test extensibility.

Before a real private deployment, implement authenticated server transport, membership checks on every read/mutation, role enforcement, protected invitation tokens, durable atomic transactions, immutable audit storage, idempotency uniqueness and version conditions. Existing repository security guidance still applies to that future work. Do not implement it in this seeded UX phase or depend on pilot persistence issue #7.
