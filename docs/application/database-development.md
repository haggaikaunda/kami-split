# Local database foundation

Issue #74 introduces local PostgreSQL/Auth and a Go connection boundary. There
is now an [identity/membership foundation](identity-foundation.md) from #75, with
private tables, RLS and transaction-bound reads. Auth middleware, business
GraphQL operations and hosted resources remain deferred. Supabase owns its containers; Compose owns only Go.

## Prerequisites and pins

Install Docker Engine/Desktop with Compose, Go 1.27.1, Python 3.11+, curl, tar and
make. Run `make db-tools` to install repository-local binaries (macOS/Linux,
ARM64/AMD64). `scripts/tool-versions.env` pins Supabase CLI **2.118.0** and sqlc
**1.31.1**; `apps/api/go.mod` pins pgx **v5.11.0**. Wrappers reject other binary
versions. CLI-managed service image versions come from that exact CLI release
(PostgreSQL 17). No experimental flags, pg-delta, paid service, hosted account or
production credentials are required.

## Start, readiness and stop

```sh
make db-tools
make dev-up
curl --fail http://127.0.0.1:8080/readyz
curl --fail http://127.0.0.1:8080/healthz
make dev-down
```

`dev-up` waits for Supabase's health checks, applies initial migrations/seeds, then
builds and waits for the API. It does not silently stop a service when a port is
occupied. Supabase project `kami-split` publishes host ports 55421 (Auth/Data API), 55422
(Postgres), 55420 (shadow), and 55424 (local mail). **The pinned CLI publishes
Supabase ports on all host interfaces**, including on Docker Desktop; this is
not a loopback-only security boundary. Use a trusted local development machine
and network or a host firewall that blocks external access to these ports.
The synthetic credentials are public development values. Never run this stack
on an internet-exposed host. Compose's Go API binds only host loopback. Auth signup is
disabled; email stays local. The private `app` schema is not Data API exposed.

Go in Compose joins `supabase_network_kami-split` and connects directly to
`supabase_db_kami-split:5432`, not container localhost or a second database.
For Go on the host:

```sh
make db-start
DATABASE_URL='postgres://kami_api:kami-local-only@127.0.0.1:55422/postgres?sslmode=disable' make api-run
```

`dev-down` stops only this Compose project and this Supabase project. Supabase
retains local data by default. Use separate checkout/project configuration and
ports for concurrent development stacks. Do not use a global Docker prune or
stop another project's containers to resolve conflicts.

Without `DATABASE_URL`, `make api-run` and base `docker compose up --build --wait`
retain the health-only development mode. `/readyz` then means HTTP is serving
and not shutting down. With the URL present, startup must connect and validate
the runtime role before binding HTTP. `/readyz` additionally performs a bounded
pool ping on every request and returns 503 on failure, including pool exhaustion.
It recovers when connectivity returns. `/healthz` and the GraphQL health field
remain process/transport checks, independent of database availability. Readiness
does not claim migrations are up to date. With authentication configured, readiness also checks the [bounded JWKS cache](authentication-boundary.md).

| Setting              | Default | Contract                                                                   |
| -------------------- | ------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`       | absent  | Complete PostgreSQL URL with explicit host, user, database and TLS mode    |
| `DATABASE_MAX_CONNS` | `5`     | Integer 1–20; budget all future replicas against the server limit          |
| `DATABASE_TIMEOUT`   | `2s`    | Duration 100ms–10s, shared bound for startup acquisition/connect/readiness |

Explicit empty settings and orphan pool settings fail. Only `sslmode` and
`sslrootcert` URL options are accepted, preventing URL overrides of pool limits
or session roles. Hosted URLs require both `sslmode=verify-full` and an explicit
`sslrootcert`; production mounts Supabase's project CA certificate from Secret
Manager and references that file in the URL. `disable` is accepted only for
loopback and the named local Supabase container. Direct PostgreSQL is
the default where the runtime supports its IPv6 endpoint; production uses the
verified TLS session pooler for IPv4 connectivity. Transaction pooling is not
configured. Idle connections expire after 5 minutes;
connection lifetime is 30 minutes, minimum pool size zero. Shutdown drains HTTP,
then closes the pool. Future users of `Pool` must release acquisitions promptly.
Configuration/startup logs and HTTP readiness errors never include the URL,
password or underlying database error. Ignored `.env` files may hold local
settings; do not put hosted secrets in Compose or PR jobs.

## Ownership and migrations

`supabase/migrations` is the sole immutable deployment history and the Supabase
CLI is its sole runner. `supabase/schemas` describes desired application SQL.
There are no application-owned definitions of managed `auth` objects. Supabase's
migration login bootstraps restricted roles and a private schema; application DDL
uses `SET ROLE kami_migrator`, the NOLOGIN, non-admin owner. The sole #75
exception creates the users table/Auth FK as the existing migration login, then
immediately transfers ownership and revokes temporary/default grants inside the
same migration transaction; no provider schema privileges are delegated. `kami_api` is a
separate LOGIN, NOINHERIT role without ownership, role creation, database creation,
replication, BYPASSRLS or owner membership. Startup refuses other/admin roles.
Runtime has schema USAGE, column-only group/membership SELECT and narrow #75
helper execution. Each future feature must explicitly grant table privileges and
implement separately approved RLS policies. Browser roles and
`service_role` have no app schema access. Default function execution is revoked
for the owner globally because per-schema revocation cannot remove PostgreSQL's
global PUBLIC EXECUTE default. No monitoring privileges are granted for probes.

The migration owner deliberately has no password. A future controlled deployment
must use a separate migration credential authorized to assume it; the API never
receives that credential. Local `postgres` supplies bootstrap capability. Local
passwords are synthetic and assigned only in `supabase/seeds/local.sql`, separate
from migrations. Seeds currently contain no fabricated domain records.

The pinned stable CLI's `db diff --help` states that desired files are not part of
its baseline. Legacy migra also omits roles and some grants; declarative sync with
pg-delta is excluded by ADR-002. Therefore use reviewed manual migrations and
explicit desired-state reconciliation, not experimental generation:

1. Edit desired SQL under `supabase/schemas`.
2. `scripts/db-tool.sh supabase migration new descriptive_name` creates a migration.
3. Write/review SQL, including ownership, grants, RLS and compatibility.
4. `scripts/db-tool.sh supabase migration up --local` applies pending local history.
5. Run `make db-test`, then all repository checks. Never edit an applied migration.

Migration versions must be unique across branches before merging. Household designation uses
`20261005000000`; repayments use `20261006000000` after resolving a
pre-deployment collision. Both SQL bodies are unchanged. If a local database
recorded repayments under the old Household version, do not blindly
reapply or mark migrations complete: inspect its migration history and actual
schema first. Recreate only explicitly disposable test data; preserve valued
local data and reconcile its history against the installed schema before upgrading.
This correction does not repair existing database histories automatically.

The #75 test upgrades the shipped #74 foundation and separately runs fresh
replay plus migration up with an applied history. Desired-schema comparison uses
a clone of the disposable provider baseline, retaining real Auth objects.
Future migrations must add fixtures for upgrades from their prior release and
prove preservation of real existing data. Hosted deployment, backups and recovery
remain open decisions; no remote reset or deployment command is provided here.

References: [Supabase migrations](https://supabase.com/docs/guides/local-development/database-migrations),
[declarative tooling and caveats](https://supabase.com/docs/guides/local-development/declarative-database-schemas).
The pinned binary's help is the executable command contract.

## Generation and verification

```sh
make db-generate
make db-generation-check
make db-test
make api-check
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

`sqlc.yaml` generates the foundation group query directly from desired app SQL
and retains the disposable `sqlctest` generation probe. Generated pgx code is
committed, compiled and exercised under the real runtime role. Viewer/member
helpers use explicit transaction-bound pgx queries for their function projections.
There are no managed-object stubs or application-owned provider definitions.

`db-generation-check` generates into a temporary directory and compares all files.
`db-test` requires working Docker/tools and fails if dependencies are absent. It
creates a unique Supabase project with automatically selected ports, replays via
`db reset --local`, verifies upgrade from #74 and migration-up idempotence, and
runs database lint with warnings fatal under the restricted function owner.
`plpgsql_check` needs that owner context to inspect private helper calls; no
application ACL is widened for lint. Inside that stack it applies desired SQL to a throwaway comparison
database and compares schema dumps with ownership/ACLs plus global default ACLs
and cluster role attributes/memberships. Only dump restriction tokens are removed.
This is reconciliation, not an alternative deployment runner.

Tests assert real runtime and browser-role denial, generated query execution,
invalid credentials/admin startup rejection, cancellation, bounded exhausted-pool
readiness, connection loss/recovery, independent liveness and pool cleanup. They
use synthetic data, run with the race detector, and never skip for missing URLs.
The trap stops only the unique test project with `--no-backup` and deletes its
temporary files/volumes; interruption by SIGKILL may require stopping the printed
test project manually. Development data is not reset. Destructive reset is confined
to this disposable local/test command. Do not run resets against hosted resources.

CI installs the pinned tools and executes these checks without production secrets,
then preserves base health-only container checks and verifies coordinated
Supabase+Compose startup. The existing required `Verify` aggregation remains intact.

## Internal ordinary/trip creation (#103)

`DB.CreateGroup` and `DB.GroupCreationOperation` implement the accepted
[ADR-006 creation contract](decisions/006-group-creation.md) for a previously
verified Auth subject. They own READ COMMITTED transactions; no HTTP or GraphQL
entry point is published. Only the enabled, linked stable identity designated by
`installation.group_creator_user_id` can create or recover. Household membership,
email and ownership of other groups grant no capability.

The additive `005_group_creation.sql` introduces optional `group_trip` metadata
and permanent identity-scoped `group_creation_attempts`. Existing groups remain
ordinary by absence of metadata. Creation inserts its receipt, new group, sole
active owner membership and optional trip atomically; deferred foreign keys make
partial results uncommittable. No financial entries or ledger revisions are
created. Trip dates are Gregorian date-only values, independent of timezone;
classification/status projections and UI defaults are deferred to the read/UI
slices. Runtime receives only the narrow create/lookup functions and authorized
trip reads, with no direct creation-table writes or receipt reads.

Lock order is user FOR SHARE, installation FOR SHARE, then the unique identity /
CREATE_GROUP / operation-key receipt. Operator disabling follows the existing
user lock; designation changes must lock installation and must never acquire a
user lock afterwards. Trip insertion and household designation changes also
serialize on installation, enforcing an ordinary household in both directions.
Completed Go results undergo a separate current authorized group read after the
creation transaction. Result IDs describe the original creation; callers fetch
fresh group metadata before navigation.

Name canonicalization trims only ASCII space/tab/CR/LF. Destination null/omission
normalizes to empty without trimming or Unicode normalization. SQL counts Unicode
scalars and repeats Go's scalar validation. Domain rejection is durable; corrected
input needs a new key. Malformed scalar, authorization and transient failures do
not reserve keys. A same-key changed canonical input conflicts. NOT_STARTED is
only a committed-state observation, since an in-flight attempt may later commit;
retry only its identical key/input. UNAVAILABLE likewise never proves failure.
Receipts have no expiry or pruning operation.

`make db-test` snapshots real existing #75 identity/group/membership/installation
rows before applying #103 and checks exact preservation, in addition to fresh
replay and desired-state reconciliation. The real-role creation suites exercise
Unicode/date boundaries, durable rejection, access/grant denial, lost-response
replay, concurrent duplicate calls, in-flight lookup, injected rollback at every
insert, and both commit orders for disabling and creator-designation races.
