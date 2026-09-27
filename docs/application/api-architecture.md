# API architecture

## Status

A health-only Go + gqlgen scaffold exists in `apps/api`, with authoritative SDL in `packages/schema`. See the [API README](../../apps/api/README.md) for running and verification. The responsibilities below describe the intended business backend. PostgreSQL is the intended database. The web UI currently uses its mock DataPort; Relay integration is future work. These decisions do not authorize scaffolding outside an approved implementation issue.

## Responsibilities

- GraphQL resolvers translate transport inputs and outputs and invoke application operations. They do not become the sole home of authorization or financial rules.
- Application operations authenticate their actor context, authorize group access, validate commands, and own transaction boundaries. Future imports use these same operations.
- Pure financial code validates exact amounts, splits, and settlement effects without importing gqlgen or database libraries.
- Persistence code executes explicit queries and constraints. Helpers do not secretly commit part of a larger application operation.

Prefer a single cohesive backend with explicit constructors and narrowly scoped packages. No microservices, generic repository framework, or fixed hierarchy of layers is required.

## Financial mutations

An expense mutation must atomically preserve the expense state, its audit history, and its idempotency result. Define duplicate-request behavior, including reuse of an operation ID with different input. Use database constraints and expected-version checks for concurrent changes; process-local locks do not protect multiple server instances.

Use integer minor units, explicit currency, checked arithmetic, and a documented wire range. Amounts paid and owed each reconcile to the expense total; net positions sum to zero per currency; settlements change payer and recipient positions equally and oppositely. Retain auditable history for edits and deletions.

## Contract and reads

The SDL is the cross-language contract for gqlgen and Relay. Keep generated transport types at the boundary where practical. Pin generators and verify reproducibility; do not manually patch generated output.

Define stable identity and cursor pagination for Relay. Compute complete balances and spending summaries on the server rather than deriving them from a client's partially loaded expense list. Batch related reads and enforce bounded page sizes and query costs. Authorize all access paths, including node lookup and nested fields.

Map expected validation, access, version-conflict, and duplicate-operation outcomes consistently. Do not expose SQL, credentials, or private data in client errors or logs. Request cancellation propagates to database and external I/O.

## Future integrations

Keep imported bank transactions separate from shared expenses until explicitly assigned and split. Plaid credentials and provider-specific behavior remain private to the integration. Work requiring durable retries must use durable processing; this document does not select or install a queue.

See the [Go engineering guide](../agents/go-guidelines.md) for code and testing expectations. Detailed schema, authentication, persistence, deployment, and worker designs require subsequent approved issues.
