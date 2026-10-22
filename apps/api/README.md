# Go GraphQL server

Go **1.27.1**, gqlgen **v0.17.95**, and `net/http` server with verified identity and persisted single-group expenses. PostgreSQL stores allocations, audit and recoverable operation results atomically. Complete balances and signed pagination follow the [persisted expense contract](../../docs/application/persisted-expenses.md). Internal targeted invitation, admission and durable delivery recovery are also implemented; [onboarding transport](../../docs/application/onboarding.md) connects provider adapters, invitation SDL and browser entry. The web preview keeps its in-memory DataPort; the separate [Relay expense journey](../../docs/application/relay-expenses.md) connects authenticated group expenses at `/groups` (#83).

The authenticated `householdDashboard` read implements the [ADR-007 summary](../../docs/application/decisions/007-household-dashboard.md) under [ADR-010 membership sharing](../../docs/application/decisions/010-household-membership-sharing.md). It returns complete original-space balances and exact signed viewer net, open/active space counts, and active expense face-value totals from one coherent authorized read. Sharing fallback, financial overflow and discovery failure never return partial totals; the production Household browser workspace consumes these reads under #112.

The #169 `householdExpenses` and `groupExpenses` reads add structured-filtered
expense views with original-space attribution, complete face-value totals/counts,
and complete monthly totals/counts independent of page size. Filters combine source
group, multiple categories, inclusive calendar dates, Involving Membership IDs
(payer or saved split participant, including zero shares), and separate Paid by
Membership IDs (payer only). Fields combine with AND, alternatives within each
field with OR; every selected ID is authorized. Date and exact amount sorting
support both directions over the complete anchored dataset. The legacy
`Group.expenses` participant-only filter remains unchanged. Signed continuation
cursors bind scope, filters, current authorized eligibility and per-space financial
anchors; rows and summaries share the anchored dataset, while every request checks
current access. Repayments never contribute to spending. Free-text search remains
separate #177 scope; these reads introduce no search field or SQL text search.

## Run locally

Install Go 1.27.1 and make. From the repository root:

```sh
make api-run
curl -H 'Content-Type: application/json' -d '{"query":"{ health { status } }"}' http://127.0.0.1:8080/graphql
```

Run the curl command in a second terminal. The response is `{"data":{"health":{"status":"ok"}}}`. `/health` reports process liveness; `/ready` reports whether the server is serving and not shutting down. Both production Cloud Run and local Compose probes use these endpoints. With no `DATABASE_URL`, neither claims database readiness. For database-backed readiness, local startup, restricted roles and integration checks, see [database development](../../docs/application/database-development.md).

## Docker development

From the repository root, with Docker Engine and Compose available:

```sh
docker compose up --build -d api
docker compose ps
docker compose logs api
docker compose down
```

Compose builds from the repository root so the module and shared SDL remain in one build context. Port 8080 is exposed on host loopback only. The runtime container uses an unprivileged user, read-only filesystem, dropped capabilities, and a readiness health check. Rebuild after source changes; the server does not provide hot reload. Compose's stop grace period exceeds the configured application shutdown timeout.

The Dockerfile also has a `verify` target:

```sh
docker build --target verify -f apps/api/Dockerfile .
```

This optional manual target is not run in CI, where `make api-check` owns source verification. CI builds the production image once and reuses it for both health-only and coordinated database startup (`make dev-up DEV_BUILD_FLAG=--no-build`).

That target runs formatting, vet, race tests, build, and module/generation reproducibility checks. Runtime binaries are built without CGO; the verification stage retains a C compiler for race tests. Supabase CLI owns local PostgreSQL/Auth. `make dev-up` adds the database Compose override and coordinates both stacks; `make dev-down` stops them without deleting development data.

## Configuration

| Variable               | Default          | Validation                                                             |
| ---------------------- | ---------------- | ---------------------------------------------------------------------- |
| `API_ADDR`             | `127.0.0.1:8080` | Host and numeric port 1–65535; `:8080` explicitly binds all interfaces |
| `API_SHUTDOWN_TIMEOUT` | `5s`             | Positive Go duration, at most `1m`                                     |

Explicit empty values are invalid. Compose sets `API_ADDR=:8080` inside the container. SIGINT/SIGTERM initiate graceful shutdown; timeout forces active connections closed and exits unsuccessfully.

## Banking worker and verified ingress

The [banking lifecycle worker](../../docs/application/banking-worker.md) uses a
separate `kami_worker` pool for durable cleanup and protected Item observation.
It also polls durable enrollment cleanup. The internal [sync adapter](../../docs/application/banking-sync.md) validates account-filtered provider pages; restricted persistence atomically commits complete batches and their cursors. The same worker executes first and incremental imports for explicitly selected bindings, with per-binding retry budgets and atomic batch/checkpoint/completion. Verified Transactions notifications durably coalesce demand; the one-minute poll recovers missed notifications through daily eligible reconciliation. See the [sync runbook](../../docs/application/banking-sync.md#background-dispatch-and-reconciliation) for safe diagnostics and resume. The [private reporting API](../../docs/application/banking-reporting.md) exposes owner-only canonical transaction/detail/archive reads, complete exact summaries and guarded single-field annotation edits/resets with durable recovery. Reads use stored data and the saved reporting timezone without requesting a provider refresh. Personal transaction/activity browser screens remain a separate delivery. The API's sole verified
ingress is opt-in; configuring it grants no live enrollment authority. The
[authenticated lifecycle API](../../docs/application/banking-enrollment.md#managing-an-existing-connection)
shares the existing teardown/purge obligations and reports local stop, remote
cleanup and active-copy deletion separately. Existing-Item repair and cleanup
remain available when new enrollment is disabled.

| Variable                                                           | Purpose                                                                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `BANKING_ENVIRONMENT`                                              | Explicit `sandbox` or `production`; absent with all dependent variables absent disables API banking ingress.    |
| `PLAID_CLIENT_ID`, `PLAID_SECRET`                                  | Environment-specific server-only provider credentials.                                                          |
| `BANKING_KEY_CURRENT`                                              | Current independent banking key version.                                                                        |
| `BANKING_KEYS`                                                     | JSON version-to-padded-base64 map of 32-byte AES keys; retain old versions for unfinished work.                 |
| `BANKING_ENROLLMENT_ENABLED`                                       | Explicit `true` opts into new enrollment only with separately verified prerequisites; absent defaults disabled. |
| `BANKING_WEBHOOK_ORIGIN`                                           | Deployed HTTPS API origin for immutable attempt-specific Link correlation.                                      |
| `BANKING_USER_DISCOVERY_VERIFIED`, `BANKING_USER_REMOVAL_VERIFIED` | Explicit `true` capability gates for restricted Users API discovery/removal, independently verified under #255. |
| `WORKER_DATABASE_URL`                                              | Required separate restricted-worker PostgreSQL URL; API database credentials are ignored.                       |
| `WORKER_ADDR`                                                      | Operational listener, default `127.0.0.1:8081`.                                                                 |
| `WORKER_SHUTDOWN_TIMEOUT`                                          | Graceful shutdown deadline, default `5s`, maximum `1m`.                                                         |

Incomplete/empty configuration fails closed. Secret values never appear in startup
errors. The worker exposes `/ready` and aggregate `/status`, with a clearly bounded
100-operation sample prioritized toward incomplete work. Keep operational endpoints
on an internal/loopback interface. SIGINT/SIGTERM cancel and join the consumer.

Use `make banking-worker-run` with explicit configuration. The production image
contains both binaries. The optional Compose `banking` profile runs the worker;
the database override supplies only the synthetic local worker URL. Provide
banking keys/provider settings explicitly in an owned local environment. CI and
`make db-test` use `make banking-worker-smoke` against an empty disposable database
to check the actual executable, private status and graceful shutdown without live
provider calls. Neither command provisions a hosted worker or enables enrollment.

## Layout and verification

- `cmd/server`: configuration, explicit dependency wiring, structured logging, and signals.
- `internal/config`: validated configuration.
- `internal/auth`: verified request identity, provider evidence and transaction-bound actor access.
- `internal/invitation`: internal targeted invitations, capability preview/eligibility, admission and durable delivery recovery.
- `internal/database`: validated pgxpool lifecycle/readiness, transaction-local identity, restricted foundation queries and generated sqlc group reads. See the [identity foundation](../../docs/application/identity-foundation.md).
- `internal/server`: HTTP routes, request protections, safe errors, and lifecycle.
- `internal/graph`: generated execution/models and thin handwritten transport mapping.
- `internal/profile`: verified self-only profile read and atomic display-name comparison/update, independent of group discovery; see [the profile contract](../../docs/application/profile.md).
- `internal/group`: verified identity-scoped group creation and durable recovery; see [the group contract](../../packages/schema/README.md#group-creation-and-discovery).
- `internal/expense`: authorized reads, transactional writes and same-attempt recovery.
- `internal/ledger`: pure exact-money, canonical-input, split, balance and cursor rules.
- [`packages/schema`](../../packages/schema/README.md): authoritative SDL consumed by `gqlgen.yml`.

From root:

```sh
make api-format
make api-generate
make api-test
make api-build
make api-check
```

`api-check` runs formatting, module integrity, vet, regular/race tests, build, and generation drift against committed API/schema files. Commit intentional changes before the final drift check; tracked differences or untracked API/schema files fail it. Race tests require a supported platform and C compiler. Run `make db-test` for required real Supabase/PostgreSQL migration, permission and race-enabled integration verification, and `make db-generation-check` for sqlc drift. Root pnpm checks remain required.

`go.mod` pins gqlgen as a tool dependency. Edit SDL and handwritten resolvers,
then regenerate committed artifacts; never patch generated execution/model
output. Resolver scaffolding preserves handwritten implementations on
regeneration.

Only JSON POST is enabled on `/graphql`. Limits: 64 KiB body, 1,000 parser
tokens, complexity 200, 16 KiB header setting, 5s header-read/10s read/15s
write/60s idle timeouts, and a 10s GraphQL execution context deadline that
cancels database lock waits. Request IDs are server-generated. Logs omit request
bodies and error/panic payloads. No playground, WebSocket transport, or broad
browser CORS integration is configured. Cloud Run owns production TLS and the
gated deployment workflow and remaining operator configuration are documented
in [production deployment configuration](../../docs/application/production-deployment.md).

Read [API instructions](AGENTS.md), [Go guidance](../../docs/agents/go-guidelines.md), and [architecture](../../docs/application/api-architecture.md) before extending the API.

See [verified API identity](../../docs/application/authentication-boundary.md) for optional authentication configuration, protected readiness, cache invalidation and transaction access. Protected startup additionally requires `CURSOR_ACTIVE_KEY_ID` and `CURSOR_SIGNING_KEYS`; see [cursor configuration and operating limits](../../docs/application/persisted-expenses.md#configuration-and-limits). Public health remains unauthenticated.

The finite complexity budget includes conditional selections even when omitted
at execution. The shipped composed workspace operation exceeds the former 100
limit; exact Relay wire/transport regressions verify all current operations fit
200 while over-budget operations remain rejected before execution.

Percentage is supported alongside Equal and Exact without opt-in configuration.
Deployments require the percentage migration and compatible API/web readers; see
the [percentage deployment/rollback contract](../../docs/application/percentage-splits.md).

Private [banking enrollment](../../docs/application/banking-enrollment.md) exposes
actor-bound Link operations and selected-account reads. New enrollment is disabled
by default and requires separate verified discovery/removal capability gates;
cleanup/ingress configuration alone grants no enrollment authority.
