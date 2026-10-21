# API architecture

## Status

The authenticated `householdDashboard` read implements the [ADR-007 summary](decisions/007-household-dashboard.md) under [ADR-010 membership sharing](decisions/010-household-membership-sharing.md). It returns complete original-space balances and exact signed viewer net, open/active space counts, and active expense face-value totals from one coherent authorized read. Sharing fallback, financial overflow and discovery failure never return partial totals; the Household browser workspace consumes these reads under #112, with complete [Expenses integration](expenses-ledger.md) implemented by #170.

The #169 `householdExpenses` and `groupExpenses` reads add structured-filtered
expense views with original-space attribution, complete face-value totals/counts,
and complete monthly totals/counts independent of page size. Filters combine source
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

The Go + gqlgen API in `apps/api` implements public health, authenticated expense operations, ordinary/trip group creation and recovery, and authorized group metadata reads, with authoritative SDL in `packages/schema`. See the [API README](../../apps/api/README.md) for running and verification. Supabase-managed PostgreSQL and Supabase Auth are selected; pgx + sqlc and Supabase CLI SQL migrations are the agreed persistence tooling. Local Supabase, pgxpool and disposable sqlc verification are implemented; see [database development](database-development.md). The [identity foundation](identity-foundation.md) implements private identities,
groups, memberships and transaction-bound reads. [Persisted expenses](persisted-expenses.md) implement atomic financial creation, audit/recovery, authorized projections and complete balances. Internal [targeted invitation operations](targeted-invitations.md) add lifecycle, durable delivery recovery and admission; [onboarding adapters](onboarding.md) connect Auth, email, browser entry and the invitation SDL. [Expense editing](expense-editing.md) adds versioned guarded corrections with immutable snapshots; deletion and imports remain deferred; append-only actual group repayments and history are implemented. The [authenticated expense journey](relay-expenses.md) uses Relay at `/groups`, connected to real account/onboarding pages. The seeded web runtime and mock DataPort were retired in #184. These decisions do not authorize scaffolding outside an approved implementation issue.

[Authenticated activity](activity.md) reads immutable expense/repayment events with signed scope-bound pagination. Household traversal reuses the summary eligibility and locking boundary; its Activity UI is separate from the broader #112 dashboard implementation.

The [self-profile contract](profile.md) provides authenticated reads independent of
group discovery, an atomic expected-name display-name update, and a separately
guarded Light/System/Dark appearance preference. It changes only application
profile metadata through narrowly granted SQL functions; Auth
metadata and immutable financial/audit/recovery records remain unchanged.

The [reporting-timezone API](reporting-timezone.md) provides a self-only saved IANA
zone, independent version and durable same-attempt write recovery without a bank
connection. Its consumer UI and general date-bound reads remain separate deliveries. The [replacement backend](banking-replacement.md) validates boundaries against the saved zone.

## Responsibilities

The additive `groupDirectory` read returns compact authorized ordinary/trip
metadata, active membership counts and complete expense-only spend/personal net,
excluding the designated Household. It aggregates in one RLS-protected statement
with a five-second deadline, without transferring expense pages or membership
identities. `Group.financialSummary` reuses its current authorized snapshot and the
same exact-money calculation; paging, expense filters and trip dates do not affect
these totals. Per-source overflow is an explicit financial problem, while failed
discovery returns no entries. See the [schema contract](../../packages/schema/README.md#compact-group-directory-and-financial-summaries)
for bounds, snapshot semantics and API-before-consumer deployment.

- GraphQL resolvers translate transport inputs and outputs and invoke application operations. They do not become the sole home of authorization or financial rules.
- Application operations authenticate their actor context, authorize group access, validate commands, and own transaction boundaries. Future imports use these same operations.
- Pure financial code validates exact amounts, splits, and settlement effects without importing gqlgen or database libraries.
- Persistence code executes explicit queries and constraints. Helpers do not secretly commit part of a larger application operation.

The database owns its private runtime pool. Capability preview and eligibility use
narrow invitation persistence methods without manufacturing actor identity; admission
rechecks authorization. Raw pool access exists only in integration-tagged builds
for permission probes and fault injection. The invitation package owns recurring
cleanup orchestration, with cancellation and completion owned by the server.

Prefer a single cohesive backend with explicit constructors and narrowly scoped packages. No microservices, generic repository framework, or fixed hierarchy of layers is required.

## Financial mutations

An expense mutation must atomically preserve the expense state, its audit history, and its idempotency result. Define duplicate-request behavior, including reuse of an operation ID with different input. Use database constraints and expected-version checks for concurrent changes; process-local locks do not protect multiple server instances.

Use integer minor units, explicit currency, checked arithmetic, and a documented wire range. Amounts paid and owed each reconcile to the expense total; net positions sum to zero per currency; settlements change payer and recipient positions equally and oppositely. Retain auditable history for edits and deletions.

[ADR-004 C3](decisions/004-group-balances-membership-and-recovery.md#c3-same-attempt-financial-recovery) requires a key known by the client before the initial write. Persist allocations and a recoverable result with the expense and audit atomically and durably; concurrent same-key/same-canonical-input retries and restart recovery have one effect. Server-derived actor, explicit group and operation bind recovery under the reviewed scope, with current authorization on retries and receipt reads. Changed-input reuse cannot create/overwrite the original expense. Recover the immutable original outcome, then read fresh authorized balances as needed; neither missing receipt nor cached balance proves current state. #76 finalized the concrete protocol, mismatch, retention and transport choices implemented by #82.

## Contract and reads

The SDL is the cross-language contract for gqlgen and Relay. Keep generated transport types at the boundary where practical. Pin generators and verify reproducibility; do not manually patch generated output.

Define stable identity and cursor pagination for Relay. Compute complete balances and spending summaries on the server rather than deriving them from a client's partially loaded expense list. Batch related reads and enforce bounded page sizes and query costs. Authorize all access paths, including node lookup and nested fields.

Map expected validation, access, version-conflict, and duplicate-operation outcomes consistently. Do not expose SQL, credentials, or private data in client errors or logs. Request cancellation propagates to database and external I/O.

[ADR-004 C1/C2](decisions/004-group-balances-membership-and-recovery.md#c1-automatic-simplification-within-one-group-and-currency) requires automatic repayment simplification from complete individual group/currency nets, preserving historical attribution and inactive-member financial contributions. Original pairwise relationships are not additional debts. Every individual net must be zero to call a group settled. The target’s zero net is the departure/removal financial condition; ownership, account and authorization checks remain separate, and the eventual balance check/transition must be atomic against competing writes. Matching, representations and the financial concurrency protocol follow the finalized first-expense contract; membership departure mutations remain deferred.

## Future integrations

Keep imported bank transactions separate from shared expenses until explicitly assigned and split. Plaid credentials and provider-specific behavior remain private to the integration. Work requiring durable retries must use durable processing; Supabase Queues with the restricted Go lifecycle worker is implemented for cleanup, protected status observations and durable initial imports for explicitly selected accounts. Ongoing sync triggers, public transaction/reporting reads and browser UI remain downstream. Hosted provisioning and live rollout remain separately authorized.

The internal [private banking storage](banking-storage.md) foundation implements
owner-only persistence, protected credential storage, durable attempts and lifecycle
fences. The [lifecycle worker](banking-worker.md) implements protected narrow Plaid cleanup,
Item observation, worker privileges/runtime and verified durable HTTP ingress.
The [enrollment API](banking-enrollment.md) implements actor-bound Link operations,
retained stream reads, durable unknown-exchange recovery, explicit selection,
existing-Item repair and revision-checked disconnect/private-history deletion. New enrollment is
disabled by default; the [replacement backend](banking-replacement.md) implements explicit staged date-ownership plans and bounded recovery. The [transaction sync adapter and restricted persistence](banking-sync.md) validate account-filtered pages and atomically commit complete batches with lifecycle/reporting fences. The existing worker executes durable first imports for selected bindings. Ongoing sync triggers and public transaction/reporting APIs remain deferred. The [planned Personal banking contract](personal-banking.md) defines owner-only
source/binding/annotation boundaries, exact posted-date spending, saved reporting
preferences, durable lifecycle fencing and explicit exchange uncertainty. The
lifecycle slice owns the minimum queue consumer and verified ingress; transaction
sync extends it. C5-v2 replacement publishes a versioned reporting plan: preserve
the entire prior canonical history and original annotations through confirmed
posted-bank date D inclusive, and use the new binding strictly after D. Repeated
transitions retain earlier intervals. A separate recovery archive adds no second
reporting contribution; recovery explicitly publishes a new plan revision without
restoring provider permission or deleted data. Activation/recovery compare-and-swap
plan/import/data/annotation/lifecycle revisions and fence only the affected account.
The lifecycle slice can verify persisted activation with controlled import fixtures
before real sync exists. Live provider recovery/backup capabilities require
verification.
The remaining planned contract does not grant banking access through groups.
Delivered enrollment SDL is documented separately; live capabilities remain gated.

See the [Go engineering guide](../agents/go-guidelines.md) for code and testing expectations. Extensions to schema, authentication and persistence, and hosted deployment and worker implementation require separately approved issues.

## Accepted decisions and open questions

[ADR-001](decisions/001-backend-foundation.md) is the canonical record of the accepted platform, USD money representation, and membership policies. Consult the [open-decision register](decisions/open-decisions.md) before treating unresolved details as requirements.

[ADR-002](decisions/002-authentication-and-database-operations.md) adds the accepted session/JWKS policy, transaction-local identity with RLS, stable-only tooling, GitHub Actions migration deployment, and free-plan backup constraint. Local database tooling is implemented; the [verified identity boundary](authentication-boundary.md) is implemented; expense business resolvers are implemented; hosted production operations remain separate.

[ADR-003](decisions/003-bootstrap-groups-and-invitations.md) records the administrative bootstrap exception, separate group ledgers and invitation lifecycle/token protection. Each expense and settlement belongs to exactly one group; trip membership grants no household access. Dashboard repayment shortcuts retain the original group and never duplicate or offset records across groups. The preview's embedded trips and pending members are not production schema.

The [identity foundation](identity-foundation.md), [financial contract](persisted-expenses.md), [invitation/onboarding](onboarding.md), [bootstrap](bootstrap.md), independent Group/Trip creation and Household summaries are implemented. See [the current journey](relay-expenses.md) for browser consumers. Ownership transfer remains deferred under [#84](https://github.com/haggaikaunda/kami-split/issues/84); broader reporting policy is listed in the [decision register](decisions/open-decisions.md).

## Diagnostic ownership

Unexpected database, actor, expense and invitation errors retain private causes
for `errors.Is`/`errors.As` through `internal/diagnostic`; their `Error` text stays
safe. Callers must never serialize the cause or log the error object. Diagnostic
operation labels are static server-defined strings, never request values.

Database startup reports once at the owning application boundary, using the safe
static operation label when an unexpected pool/probe failure is classified.
Runtime-role rejection retains its safe generic startup event. The database
package does not log driver errors or connection/server payloads.

The GraphQL boundary installs a request-scoped diagnostic sink and emits at most
one structured failure event per request with a generated request ID and static
operation label. Resolver union mappings and expense uncertainty mappings report
before consuming unexpected errors. Expected validation, access masking and durable
operation outcomes remain quiet. Panic recovery reports only `graphql.panic` and
never retains the recovered value. Internal invitation operations do not log;
future transport/worker adapters own reporting their returned unexpected failures
through `diagnostic.Report` with their own correlation and sink.
