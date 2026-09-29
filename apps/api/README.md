# Go GraphQL server

Health-only scaffold using Go **1.27.1**, gqlgen **v0.17.95**, and `net/http`. An optional pgxpool database boundary supports local Supabase. Authentication, financial operations, and Relay integration remain unimplemented. The web preview still uses its in-memory DataPort.

## Run locally

Install Go 1.27.1 and make. From the repository root:

```sh
make api-run
curl -H 'Content-Type: application/json' -d '{"query":"{ health { status } }"}' http://127.0.0.1:8080/graphql
```

Run the curl command in a second terminal. The response is `{"data":{"health":{"status":"ok"}}}`. `/healthz` reports process liveness; `/readyz` reports whether the server is serving and not shutting down. With no `DATABASE_URL`, neither claims database readiness. For database-backed readiness, local startup, restricted roles and integration checks, see [database development](../../docs/application/database-development.md).

## Docker development

From the repository root, with Docker Engine and Compose available:

```sh
docker compose up --build -d api
docker compose ps
docker compose logs api
docker compose down
```

Compose builds from the repository root so the module and shared SDL remain in one build context. Port 8080 is exposed on host loopback only. The runtime container uses an unprivileged user, read-only filesystem, dropped capabilities, and a readiness health check. Rebuild after source changes; this scaffold does not provide hot reload. Compose's stop grace period exceeds the configured application shutdown timeout.

The Dockerfile also has a `verify` target:

```sh
docker build --target verify -f apps/api/Dockerfile .
```

That target runs formatting, vet, race tests, build, and module/generation reproducibility checks. Runtime binaries are built without CGO; the verification stage retains a C compiler for race tests. Supabase CLI owns local PostgreSQL/Auth. `make dev-up` adds the database Compose override and coordinates both stacks; `make dev-down` stops them without deleting development data.

## Configuration

| Variable               | Default          | Validation                                                             |
| ---------------------- | ---------------- | ---------------------------------------------------------------------- |
| `API_ADDR`             | `127.0.0.1:8080` | Host and numeric port 1–65535; `:8080` explicitly binds all interfaces |
| `API_SHUTDOWN_TIMEOUT` | `5s`             | Positive Go duration, at most `1m`                                     |

Explicit empty values are invalid. Compose sets `API_ADDR=:8080` inside the container. SIGINT/SIGTERM initiate graceful shutdown; timeout forces active connections closed and exits unsuccessfully.

## Layout and verification

- `cmd/server`: configuration, explicit dependency wiring, structured logging, and signals.
- `internal/config`: validated configuration.
- `internal/database`: validated pgxpool lifecycle and readiness, with disposable sqlc fixture.
- `internal/server`: HTTP routes, request protections, safe errors, and lifecycle.
- `internal/graph`: generated execution/models and handwritten resolver implementations.
- [`packages/schema`](../../packages/schema/README.md): authoritative SDL consumed by `gqlgen.yml`.

From root:

```sh
make api-format
make api-generate
make api-test
make api-build
make api-check
```

`api-check` runs formatting, module integrity, vet, regular/race tests, build, and generation drift against committed API/schema files. Commit intentional changes before the final drift check; tracked differences or untracked API/schema files fail it. Race tests require a supported platform and C compiler. Root pnpm checks remain required.

`go.mod` pins gqlgen as a tool dependency. Edit SDL and handwritten resolvers, then regenerate committed artifacts; never patch generated execution/model output. Resolver scaffolding preserves handwritten implementations on regeneration.

Only JSON POST is enabled on `/graphql`. Limits: 64 KiB body, 1,000 parser tokens, complexity 100, 16 KiB header setting, 5s header-read/10s read/15s write/60s idle timeouts. Request IDs are server-generated. Logs omit request bodies and error/panic payloads. No playground, WebSocket transport, CORS integration, or production TLS/deployment is configured.

Read [API instructions](AGENTS.md), [Go guidance](../../docs/agents/go-guidelines.md), and [architecture](../../docs/application/api-architecture.md) before extending this scaffold.
