# API architecture

## Status

A health-only Go + gqlgen scaffold exists in `apps/api`, with authoritative SDL in `packages/schema`. See the [API README](../../apps/api/README.md) for running and verification. The responsibilities below describe the intended business backend. Supabase-managed PostgreSQL and Supabase Auth are selected; pgx + sqlc and Supabase CLI SQL migrations are the agreed persistence tooling. Local Supabase, pgxpool and disposable sqlc verification are implemented; see [database development](database-development.md). Business persistence remains unimplemented. The web UI currently uses its mock DataPort; Relay integration is future work. These decisions do not authorize scaffolding outside an approved implementation issue.

## Responsibilities

- GraphQL resolvers translate transport inputs and outputs and invoke application operations. They do not become the sole home of authorization or financial rules.
- Application operations authenticate their actor context, authorize group access, validate commands, and own transaction boundaries. Future imports use these same operations.
- Pure financial code validates exact amounts, splits, and settlement effects without importing gqlgen or database libraries.
- Persistence code executes explicit queries and constraints. Helpers do not secretly commit part of a larger application operation.

Prefer a single cohesive backend with explicit constructors and narrowly scoped packages. No microservices, generic repository framework, or fixed hierarchy of layers is required.

## Financial mutations

An expense mutation must atomically preserve the expense state, its audit history, and its idempotency result. Define duplicate-request behavior, including reuse of an operation ID with different input. Use database constraints and expected-version checks for concurrent changes; process-local locks do not protect multiple server instances.

Use integer minor units, explicit currency, checked arithmetic, and a documented wire range. Amounts paid and owed each reconcile to the expense total; net positions sum to zero per currency; settlements change payer and recipient positions equally and oppositely. Retain auditable history for edits and deletions.

[ADR-004 C3](decisions/004-group-balances-membership-and-recovery.md#c3-same-attempt-financial-recovery) requires a key known by the client before the initial write. Persist allocations and a recoverable result with the expense and audit atomically and durably; concurrent same-key/same-canonical-input retries and restart recovery have one effect. Server-derived actor, explicit group and operation bind recovery under the reviewed scope, with current authorization on retries and receipt reads. Changed-input reuse cannot create/overwrite the original expense. Recover the immutable original outcome, then read fresh authorized balances as needed; neither missing receipt nor cached balance proves current state. #76 retains the concrete protocol, mismatch, key retention and transport choices.

## Contract and reads

The SDL is the cross-language contract for gqlgen and Relay. Keep generated transport types at the boundary where practical. Pin generators and verify reproducibility; do not manually patch generated output.

Define stable identity and cursor pagination for Relay. Compute complete balances and spending summaries on the server rather than deriving them from a client's partially loaded expense list. Batch related reads and enforce bounded page sizes and query costs. Authorize all access paths, including node lookup and nested fields.

Map expected validation, access, version-conflict, and duplicate-operation outcomes consistently. Do not expose SQL, credentials, or private data in client errors or logs. Request cancellation propagates to database and external I/O.

[ADR-004 C1/C2](decisions/004-group-balances-membership-and-recovery.md#c1-automatic-simplification-within-one-group-and-currency) requires automatic repayment simplification from complete individual group/currency nets, preserving historical attribution and inactive-member financial contributions. Original pairwise relationships are not additional debts. Every individual net must be zero to call a group settled. The target’s zero net is the departure/removal financial condition; ownership, account and authorization checks remain separate, and the eventual balance check/transition must be atomic against competing writes. Matching, representations and concrete concurrency protocol remain reviewed design.

## Future integrations

Keep imported bank transactions separate from shared expenses until explicitly assigned and split. Plaid credentials and provider-specific behavior remain private to the integration. Work requiring durable retries must use durable processing; Supabase Queues with a Go worker is selected for future imports, but is not installed or provisioned.

See the [Go engineering guide](../agents/go-guidelines.md) for code and testing expectations. Detailed schema, authentication, persistence, deployment, and worker designs require subsequent approved issues.

## Accepted decisions and open questions

[ADR-001](decisions/001-backend-foundation.md) is the canonical record of the accepted platform, USD money representation, and membership policies. Consult the [open-decision register](decisions/open-decisions.md) before treating unresolved details as requirements.

[ADR-002](decisions/002-authentication-and-database-operations.md) adds the accepted session/JWKS policy, transaction-local identity with RLS, stable-only tooling, GitHub Actions migration deployment, and free-plan backup constraint. Local database tooling is implemented; authentication, production operations and business policies remain planned.

[ADR-003](decisions/003-bootstrap-groups-and-invitations.md) records the administrative bootstrap exception, separate group ledgers and invitation lifecycle/token protection. Each expense and settlement belongs to exactly one group; trip membership grants no household access. Future dashboard repayment shortcuts retain the original group and never duplicate or offset records across groups. The preview's embedded trips and pending members are not production schema.

[#73](https://github.com/haggaikaunda/kami-split/issues/73) tracks the first invited, persisted expense journey. [#75](https://github.com/haggaikaunda/kami-split/issues/75) owns schema/visibility decisions, [#76](https://github.com/haggaikaunda/kami-split/issues/76) the first financial contract, [#79](https://github.com/haggaikaunda/kami-split/issues/79) invitation operations, and [#81](https://github.com/haggaikaunda/kami-split/issues/81) operational bootstrap. ADR-003 does not resolve their remaining gates. Deferred transfer [#84](https://github.com/haggaikaunda/kami-split/issues/84), group/trip design [#85](https://github.com/haggaikaunda/kami-split/issues/85), and dashboard design [#86](https://github.com/haggaikaunda/kami-split/issues/86) are not #73 completion requirements.
