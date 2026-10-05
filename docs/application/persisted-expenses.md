# Persisted expenses and complete balances

Issue #82 implements the reviewed [first-expense contract](proposals/first-expense/contract.md)
and [shared identity and money rules](proposals/first-expense/shared.md). The
running SDL is in [packages/schema](../../packages/schema/README.md). The web [authenticated journey](relay-expenses.md) uses Relay; the seeded preview and mock DataPort were retired in #184. Invitations and administrative bootstrap are implemented by their dedicated services. Edits, deletion and uploaded receipt files remain separate work; actor-scoped Group/Trip creation forms are implemented under #106.

## Transaction and recovery boundary

Business operations consume the [verified request identity](authentication-boundary.md)
and use the restricted `kami_api` role with transaction-local claims. Creator
identity never comes from mutation input. One create stores the expense, all
explicit allocations, audit attribution and durable operation outcome in one
transaction. Same-key retries compare canonical input bytes and SHA-256, scoped
to actor, group and CREATE_EXPENSE. Changed intent returns `OperationMismatch`.
Definitive domain rejection is retained without a financial effect. Records do
not expire while the associated financial history remains.

The client generates a UUID v4 key before the first submission. After a lost
response, keep the same key and frozen input: lookup may return the original
success, a definitive validation rejection, `NOT_OBSERVED`, or `UNKNOWN`.
`NOT_OBSERVED` is not proof that an in-flight attempt cannot commit. A retry never
silently substitutes a new key. Success contains immutable original financial
values; current expense labels and complete balances require a separate
currently authorized read.

Retries first lock the actor/group and look for the original outcome. New work
restarts with affected-user locks in UUID order before the group write lock,
then checks the attempt again before current participant eligibility. This lets
an authorized actor recover an original result after a participant becomes
inactive without allowing a new write using an ineligible participant. Actor
access itself is always current. Database uniqueness and group locking protect
concurrent requests across processes; there is no process-local duplicate cache.

Append-only tables, group-scoped RLS, composite foreign keys and deferred
reconciliation protect stored history. Allocation insertion is restricted to
its expense creation transaction so a later zero-share row cannot alter
historical participation. No runtime UPDATE or DELETE grants are added.

## Exact money and reads

Money uses checked integer cents, with canonical decimal strings on the GraphQL
wire. Per-expense totals are 1–999999999; explicit shares may be zero. Equal
splits assign remainder cents by ascending canonical Membership ID, independently
of selection order or locale. The payer need not be a participant or the creator.

Complete paid, owed, sent and received aggregates use PostgreSQL numeric
accumulation and checked int64 conversion. Internal [repayment persistence](persisted-repayments.md)
shares the transaction/recovery engine and financial revision with authenticated
repayment mutations, history and original-attempt recovery. Net is paid − owed + sent − received. Group positions include inactive-member history and all
expenses, regardless of page filters. Positive nets are amounts owed to a member;
negative nets are amounts owed by them. Simplification matches debtors and
creditors in canonical ID order and emits no synthetic transactions. A group is
settled only if every individual net is zero; unavailable or overflowing reads
return explicit errors.

Selected group profiles, expense page and complete balances are assembled from
one freshly authorized READ COMMITTED statement after actor/group locks. Expenses
are ordered by effective date, creation timestamp and UUID, all descending.
Filters are inclusive date range, category and explicit participant (including
zero-share participation). Pages use `first` 1–100, default 20, and signed forward
cursors. A cursor pins financial inclusion to its initial revision: subsequent
creates, including backdated ones, appear only after restarting the list. Labels
and access are not frozen across pages. Complete balances on a later page can
have a newer revision than that page's anchor.

## Configuration and limits

Protected business startup requires the existing database/auth configuration and
both cursor settings:

| Variable               | Meaning                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `CURSOR_ACTIVE_KEY_ID` | Active signing key ID: 1–32 ASCII letters, digits, underscore or hyphen.             |
| `CURSOR_SIGNING_KEYS`  | JSON object mapping key IDs to unpadded base64url secrets of at least 32 bytes each. |

Generate keys with a cryptographically secure source and supply them through
local environment/secret management, never a committed configuration or log.
Keep the same keys across restarts and include prior IDs during planned rotation.
Removing a key makes its existing cursors `INVALID_CURSOR`; restart the list,
not a financial attempt. No ephemeral fallback key is generated. Both settings
may be absent in health-only development mode; partial or empty configuration is
invalid. The configuration object is capped at 16 KiB and cursors at 2048 bytes.

The endpoint accepts JSON POST with a 64 KiB request-body limit, 1000 parser tokens
and complexity 100. One distinct `expenses` selection is supported per Group
projection; requesting multiple aliased connections on the same projection
returns `INVALID_INPUT` at the nullable connection field. These budgets reject
requests explicitly; member lists and complete financial positions are never
silently truncated. Pagination errors return `expenses: null` plus a field error,
not an empty successful connection. GraphQL execution has a 10-second context deadline below the 15-second socket write timeout. It cancels database lock waits and propagates request cancellation; uncertain commit outcomes require same-attempt recovery.

Public `/health` and GraphQL `health` remain available without credentials.
Business operations require verified credentials; invalid credentials return
HTTP 401 and verification infrastructure failure returns HTTP 503. Parse,
validation and scalar-coercion errors use HTTP 400; expected domain results use
unions. `/ready` checks configured dependencies and is not a statement that the
bootstrap or invited-user journey is complete.

## Verification

`make db-test` runs isolated Supabase upgrade/fresh-replay/desired-schema checks,
restricted-role integration tests and financial/GraphQL integration packages.
`make db-generation-check` verifies checked sqlc output. `make api-check` covers
formatting, module integrity, vet, regular/race tests, build and gqlgen drift.
Root pnpm formatting, lint, type checking, tests and build remain required.
Independent requirements testing and final-diff review must cover the final head
before this issue can merge.
