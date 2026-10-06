# Go engineering guide

## Status and authority

The agreed backend is Go + gqlgen with PostgreSQL and an authoritative SDL-first contract. Verified authentication, persisted single-group expenses and recovery, complete balances, and the internal targeted invitation/admission/delivery-recovery foundation are implemented. Public [onboarding](../application/onboarding.md) (#80) and the [Relay expense journey](../application/relay-expenses.md) (#83) connect actual provider and financial browser flows; the seeded preview routes and mock DataPort were retired in #184. Persisted group-local repayment recording and recovery are implemented; the authenticated Group/Trip workspace connects that contract under #171. Expense editing/deletion and imports remain deferred to approved issues. [API agent instructions](../../apps/api/AGENTS.md) state enforceable rules; this guide explains them. Root instructions and issue-specific requirements still apply.

Use [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments), [Effective Go](https://go.dev/doc/effective_go), and [Google's Go style principles](https://google.github.io/styleguide/go/guide) as references for readability, explicit behavior, small interfaces, naming, and standard tooling. Effective Go is foundational, not a complete modern tooling guide. These sources do not mandate a particular application directory hierarchy.

## Selected Uber conventions

We adopt this specific subset of the [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md), not the entire guide:

| Rule                                                                                                                           | Application                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| [Avoid mutable globals](https://github.com/uber-go/guide/blob/master/style.md#avoid-mutable-globals)                           | Inject database connections, clocks, and external clients through constructors.                        |
| [Avoid init](https://github.com/uber-go/guide/blob/master/style.md#avoid-init)                                                 | Make startup configuration and dependency construction explicit.                                       |
| [Handle errors once](https://github.com/uber-go/guide/blob/master/style.md#handle-errors-once)                                 | Handle or propagate a failure; avoid logging it at every layer.                                        |
| [Error wrapping](https://github.com/uber-go/guide/blob/master/style.md#error-wrapping)                                         | Add context and preserve causes when callers need to inspect them.                                     |
| [Don't panic](https://github.com/uber-go/guide/blob/master/style.md#dont-panic)                                                | Return errors for validation, authorization, conflicts, and operational failures.                      |
| [Don't fire-and-forget goroutines](https://github.com/uber-go/guide/blob/master/style.md#dont-fire-and-forget-goroutines)      | Make ownership, shutdown, and completion handling explicit.                                            |
| [Defer cleanup](https://github.com/uber-go/guide/blob/master/style.md#defer-to-clean-up)                                       | Keep cleanup near successful acquisition; do not silently lose consequential errors.                   |
| [Copy slices and maps at boundaries](https://github.com/uber-go/guide/blob/master/style.md#copy-slices-and-maps-at-boundaries) | Copy where shared backing storage could violate ownership; this is not a blanket copy-everything rule. |
| [Reduce nesting](https://github.com/uber-go/guide/blob/master/style.md#reduce-nesting)                                         | Use early returns to make the successful path easy to follow.                                          |

We do not automatically adopt underscore-prefixed globals, Uber-specific atomic dependencies, functional options, every micro-optimization, or the guide's full linting configuration. Use ordinary constructors for required dependencies. Optional configuration patterns and additional dependencies need a concrete benefit.

## Local design policies

These policies are Kami Split decisions, not claims of industry consensus:

- Start with concrete implementations. Introduce small interfaces at actual consumer boundaries, without a matching interface for every struct. Avoid generic repositories, service frameworks, and event buses without a present requirement.
- Organize packages around coherent responsibilities. Use Go's `internal` boundary for application-private code; do not scaffold empty layers or prescribe identical layers for every feature.
- Keep resolvers thin, authorization in application operations, and financial calculations pure. See [API architecture](../application/api-architecture.md).
- Use `errors.Is`/`errors.As` for recognizable error causes when appropriate, not string matching. Map application failures centrally to safe GraphQL responses. Log unexpected failures at their owning boundary without sensitive payloads.
- Carry request context through I/O. Pure calculations need no context just for uniformity. Essential post-request work must be durably scheduled, not detached from request cancellation.
- Define ownership of mutable values. Shallow copying a slice or map does not isolate nested mutable values; copy to the depth required by the ownership contract.
- Keep financial values exact. Validate bounds before arithmetic and serialization. Go `int64`, GraphQL `Int`, and JavaScript numbers have different ranges; choose and test the wire representation explicitly before publishing money fields.
- Add pagination, batching, and query limits deliberately. Benchmark representative operations before introducing caching, pooling, or parallel execution as optimizations.

## Documentation and comprehensibility

The [API instructions](../../apps/api/AGENTS.md) require Go doc comments for all exported handwritten types, functions, methods, constants, and variables. Generated code is exempt; regenerate it from its source rather than adding comments by hand. Public comments describe the caller's contract, including relevant invariants, ownership, security requirements, concurrency guarantees, and non-obvious reasoning.

Unexported implementation does not need a comment on every declaration. Add context where a reader cannot infer intent or constraints from clear code. Comments that paraphrase statements add maintenance work without explaining the contract. If a comment must walk through a difficult expression or nested branch, first consider restructuring the code with meaningful names, intermediate values, early returns, or a cohesive helper.

Readable decomposition makes an operation's decisions and effects easy to follow locally. Extract a helper when it names a meaningful responsibility or clarifies reasoning; avoid scattering a straightforward operation across trivial helpers. There are no arbitrary maximum function or file sizes: cohesion and comprehensibility determine whether decomposition helps.

Modularity means cohesive responsibilities and explicit dependencies, not a prescribed number of packages or layers. Keep related behavior together and expose the dependencies and ownership boundaries a caller needs to understand. Mixed responsibilities and hidden coupling make changes harder to reason about even when tests pass. Start with cohesive concrete implementations; introduce small consumer-owned interfaces only at real boundaries. Unnecessary layers, speculative interfaces, generic repositories, and abstractions without a present need work against this goal.

The [schema documentation policy](../../packages/schema/README.md) applies the same contract-focused approach to public GraphQL SDL. The independent reviewer checks these documented standards on the final diff without turning personal style preferences into required rewrites.

## Testing and tools

Test observable behavior. Use table-driven tests where cases share a clear structure, without forcing unrelated scenarios into one table. Financial tests should cover rounding/remainder rules, overflow, and balance invariants. Persistence tests should exercise real PostgreSQL constraints, atomic rollback, competing updates, duplicate operation IDs, and authorization denial. Mock external providers at their boundary rather than mocking every internal function.

The API pins the Go toolchain and gqlgen tool in `apps/api/go.mod`. `make api-check` runs formatting checks, module integrity, `go vet ./...`, regular and race-enabled tests, `go build ./...`, and reproducible gqlgen generation against committed files. Run `go test -race ./...` on a supported runner with its required toolchain; race detection does not prove database concurrency correctness. Integration tests must actually execute in CI rather than silently skip for missing infrastructure.

Database verification is mandatory: `make db-test` exercises disposable real Supabase/PostgreSQL migrations, permissions, identity, financial and invitation integration scenarios, including race-enabled tests. `make db-generation-check` verifies sqlc generation drift. Current root pnpm checks remain required for repository changes. Independent testers verify issue requirements and reviewers inspect the final diff, including financial, authorization, and failure-path risks.
