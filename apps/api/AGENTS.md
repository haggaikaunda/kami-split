# Go API agent instructions

Follow the repository-wide [delivery workflow](../../docs/agents/delivery-workflow.md), including independent testing and final-diff review.

These instructions supplement the root [AGENTS.md](../../AGENTS.md). Read the [Go engineering guide](../../docs/agents/go-guidelines.md) and [API architecture](../../docs/application/api-architecture.md) before API changes.

The API currently implements a health-only scaffold. Financial operations, authentication, and persistence require separately approved issues.

## Design and implementation

- Use idiomatic Go, `gofmt`, explicit constructors, and concrete types by default. Introduce small consumer-owned interfaces for actual boundaries; do not generate an interface for every struct or speculative generic frameworks.
- Keep packages cohesive and dependencies explicit. Avoid mutable globals, startup side effects in `init()`, and catch-all utility packages.
- Keep gqlgen resolvers focused on transport mapping. Application operations own authorization and transaction boundaries; financial calculations remain independent of GraphQL and database libraries.
- Treat the checked-in SDL in `packages/schema` as authoritative once introduced. Pin generation tools, regenerate output rather than editing generated code, and check for generation drift in CI.
- Use integer minor units with currency and checked arithmetic. Preserve root financial invariants and explicitly define safe Go/GraphQL/JavaScript amount bounds.
- Commit financial changes, audit records, and idempotency results consistently in one database transaction. Enforce concurrency and duplicate-request protection in the database; do not rely on process-local locks.
- Return expected failures as errors, not panics. Wrap useful context, preserve causes when appropriate, and handle/log failures once at the owning boundary. Expose safe GraphQL errors without SQL, credentials, or private financial data.
- Pass `context.Context` as the first parameter of request-bound I/O operations. Propagate deadlines/cancellation; do not replace request context with `context.Background()` to keep work running.
- Give every goroutine an owner, bounded workload, cancellation/shutdown path, and completion handling. Work that must survive restart needs durable processing.
- Use `defer` for cleanup after successful acquisition; handle consequential cleanup errors. Copy retained or returned maps/slices when necessary to protect state ownership. Prefer early returns to deep nesting.

## Verification

- Test financial behavior and failure paths, not implementation structure. Use real PostgreSQL integration tests for transactions, constraints, duplicate requests, concurrent changes, rollback, and cross-group access once persistence exists.
- Preserve the builder/tester/reviewer workflow. Measure representative workloads before adding performance complexity.
- Run `go test ./...`, `go vet ./...`, and `go build ./...` from its root; require clean `gofmt` output and generation checks. Run race-enabled tests on a supported CI runner. These Go checks supplement, not replace, existing repository checks.
- Apply only the selected external rules in the linked guide. External style guides are supplementary, not wholesale repository policy.
