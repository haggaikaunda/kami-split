# Go API agent instructions

Follow the repository-wide [delivery workflow](../../docs/agents/delivery-workflow.md), including independent testing and final-diff review.

These instructions supplement the root [AGENTS.md](../../AGENTS.md). Read the [Go engineering guide](../../docs/agents/go-guidelines.md) and [API architecture](../../docs/application/api-architecture.md) before API changes.

The API implements verified authentication, transaction-local identity, persisted single-group expense creation and recovery, complete balances, and authenticated GraphQL reads. Targeted invitation/onboarding, durable delivery recovery, and ordinary/trip group creation APIs are implemented; the [Relay expense journey](../../docs/application/relay-expenses.md) connects real group expense reads, creation and recovery (#83). The production web uses the sole actor-scoped FinancialSession and Relay environment; the seeded preview and mock DataPort were retired in #184. Append-only repayment persistence and its authenticated API/history share the financial transaction/recovery engine. Collaborative expense editing (#212) uses guarded current projections, immutable revision snapshots and per-expense concurrency; see [editing](../../docs/application/expense-editing.md). Deletion and imports remain deferred.

The authenticated `householdDashboard` read implements the [ADR-007 summary](../../docs/application/decisions/007-household-dashboard.md) under [ADR-010 membership sharing](../../docs/application/decisions/010-household-membership-sharing.md). It returns complete original-space balances and exact signed viewer net, open/active space counts, and active expense face-value totals from one coherent authorized read. Sharing fallback, financial overflow and discovery failure never return partial totals; the production Household browser page consumes these reads under #112, with authorized destination loading and context-version compatibility under #193.

The #169 `householdExpenses` and `groupExpenses` reads add structured-filtered
expense views with original-space attribution, complete face-value totals/counts,
and complete monthly totals/counts independent of page size. Issue #223 adds
complete category totals/counts and exact viewer allocation/payer amounts from
the same filtered anchored dataset; dashboard totals also expose complete viewer
share/paid. These expense-spending amounts exclude repayments. Filters combine source
group, multiple categories, inclusive calendar dates, Involving Membership IDs
(payer or saved split participant, including zero shares), and separate Paid by
Membership IDs (payer only). Fields combine with AND; alternatives within each
field combine with OR. Every selected Membership ID must belong to the authorized
scope and any selected group. Date and exact amount sorting support both directions
over the complete anchored dataset; ties use date (for amount), creation time,
source UUID and expense UUID in the selected direction. The legacy
`Group.expenses` participant-only filter remains unchanged. Signed continuation
cursors bind scope, filters, current authorized eligibility and per-space financial
anchors; rows and summaries share the anchored dataset, while every request checks
current access. Repayments never contribute to spending. Free-text search remains
separate #177 scope; these reads introduce no search field or SQL text search.

The internal [banking storage foundation](../../docs/application/banking-storage.md)
provides owner-private persistence, a separate credential keyring, durable attempts
and lifecycle fences. The [lifecycle worker](../../docs/application/banking-worker.md) implements durable
cleanup and the sole verified webhook ingress. The [enrollment API](../../docs/application/banking-enrollment.md) implements
actor-bound enrollment, explicit selection, existing-Item repair, disconnect,
private-history deletion and retained-account/status reads with default-disabled
new enrollment. The [replacement backend](../../docs/application/banking-replacement.md) implements explicit staged date-ownership plans and bounded recovery. The protected [transaction sync adapter](../../docs/application/banking-sync.md) validates account-filtered provider pages; restricted atomic batch persistence, durable selected-account imports, verified Transactions dispatch and daily missed-notification reconciliation are implemented. The [owner-only status API](../../docs/application/banking-status.md) exposes persisted import progress, coverage and freshness. The [private reporting API](../../docs/application/banking-reporting.md) adds coherent canonical transaction/archive reads, complete exact summaries and guarded private annotation edits. Personal provides shared navigation, initial Link selection/recovery and private connection inventory/status; existing-connection management UI remains separate.

The [reporting-timezone API](../../docs/application/reporting-timezone.md) supplies
an owner-only independent preference and immutable write recovery. Account consumes
its independent control, and Personal initializes the device zone once. Private
bank reporting uses this saved preference for date bounds. Personal Transactions consumes these stored report reads; full transaction detail/private
editing and Overview presentation remain separately owned capabilities.

## Design and implementation

- Document every exported handwritten package declaration with its caller-visible contract. Preserve GraphQL descriptions on all public SDL declarations; do not manually document generated gqlgen/sqlc output.

- Use idiomatic Go, `gofmt`, explicit constructors, and concrete types by default. Introduce small consumer-owned interfaces for actual boundaries; do not generate an interface for every struct or speculative generic frameworks.
- Document every exported handwritten Go type, function, method, constant, and variable with a Go doc comment; generated code is exempt. Explain contracts, invariants, security/concurrency requirements, ownership, or non-obvious reasoning rather than restating implementation. Comment unexported code where that context is needed; restructure difficult implementation instead of explaining it line by line.
- Prefer readable named helpers and intermediate values over dense expressions and deeply nested control flow when decomposition improves clarity. Use clear names; do not extract gratuitous helpers or impose arbitrary function/file size limits.
- Define module boundaries by cohesive responsibilities and explicit dependencies. Avoid mixed responsibilities, hidden coupling, unnecessary layers, speculative interfaces, generic repositories, and abstraction for its own sake.
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

## Evidence placement

Commit code, meaningful tests, required generated source, approved design inputs and maintained technical documentation. Put issue-specific verification results, screenshots, logs, review reports, acceptance status, work plans and task-start/merge/checkout closeout evidence on the tracking issue or PR, not in repository files. Documentation updates must explain lasting behavior or procedures, not record that a particular run passed. A historical label does not make work-tracking material appropriate for the repository.

Write run outputs to ignored `test-results/` or an external temporary directory. Preserve useful fixtures, test baselines and approved design inputs; classify by purpose and consumers. Before committing and during final review, inspect staged/final files for accidental evidence, task plans and copied issue specifications. Check documented behavior against the actual code. Publish unique history on its owning issue/PR before removing it; preserve original provenance and privacy. This changes evidence placement, not independent testing, whole-final-diff review, final-head CI or post-merge closeout obligations.
