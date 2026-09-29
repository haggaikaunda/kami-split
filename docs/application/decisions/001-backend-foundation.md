# ADR-001: Backend foundation

- Status: Accepted design; implementation is incremental.
- Decision date: 2026-09-27.
- Authority: Repository owner approved these choices in the architecture discussion.
- Scope: Platform, persistence tooling, money, identity, and group membership.

## Follow-up decisions

[ADR-002](002-authentication-and-database-operations.md) refines authentication, identity, RLS, local tooling, migration deployment, and backup policies. [ADR-003](003-bootstrap-groups-and-invitations.md) records administrative bootstrap, independent group/settlement boundaries, deferred ownership transfer and invitation lifecycle/token protection. References below to open details reflect this original decision; use the updated [register](open-decisions.md) for current status.

## Context and current state

Kami Split has a seeded Next.js UI and a Go + gqlgen health-only server with Docker support. Business GraphQL operations, Supabase integration, authentication, persistence, Relay, and imports are not implemented by this ADR. The design must preserve exact financial calculations and auditability while supporting future clients and imports. See [API architecture](../api-architecture.md) and [open decisions](open-decisions.md).

## D1: Application and platform boundaries

Keep web and API in the monorepo with independent deployment boundaries. Go + gqlgen serves an authoritative SDL-first GraphQL contract; Relay will consume it. `cmd/server` is the executable/composition point and `internal/server` owns HTTP lifecycle. Keep business rules out of transport code.

Use Supabase Auth for identity, sign-in, sessions, and token issuance; Supabase-managed PostgreSQL for durable application data. The frontend uses Supabase for authentication and sends its access token with application GraphQL requests. Go validates signature, permitted algorithms, issuer, audience, and expiry using maintained JWT tooling and the project's signing keys. Key caching/rotation and session revocation details remain open.

Supabase establishes identity; Go enforces group authorization and business rules on every application access path. Restrict direct client access to application tables so Supabase's data interfaces cannot bypass the Go boundary. The exact database roles, grants, and RLS design are an open implementation decision, not a claim that direct SQL inherits a user's JWT permissions.

Use Supabase Queues (pgmq) with a Go worker for future durable imports. Introduce `cmd/worker` when jobs exist, not now. Keep imported bank transactions separate from shared expenses until assigned and split. Workers must tolerate redelivery and prevent duplicate effects; queue visibility is not an end-to-end exactly-once financial guarantee. Store provider credentials privately and avoid sensitive queue payloads.

Rationale: Supabase provides managed identity and infrastructure while Go retains the application contract and financial authority. Consequences: authentication and queues introduce provider-specific integration; core financial logic and SQL remain separately testable. No Supabase resource creation or queue provisioning is authorized by this document alone.

## D2: Database access and schema evolution

Use pgx for PostgreSQL connections and transactions, and sqlc for typed Go functions generated from explicit SQL. Keep generated database types internal and map them to domain/GraphQL types at appropriate boundaries. Do not add a generic repository framework by default. Query code does not automatically enforce authorization.

Use one checked-in SQL migration history under `supabase/migrations`, managed with the Supabase CLI. Do not introduce a competing migration runner. Applied migrations are immutable; subsequent changes use new migrations. Review generated SQL, test fresh installs and upgrades, and apply production migrations through a controlled deployment step with separate migration/runtime privileges. Local resets are for disposable development/test databases; never use a remote reset as deployment.

The future sqlc configuration must account for application schema and any referenced Supabase-managed objects without taking ownership of provider internals. Pin tooling when it is introduced. Supabase local containers support integration tests for Auth-specific behavior; coordinate them with the API Compose setup rather than creating two competing databases.

Rationale: explicit, reviewable SQL and generated plumbing make transactions understandable. Consequences: agents must maintain migrations and query generation together; schema evolution needs compatibility tests. Connection mode and local orchestration details remain open.

## D3: Money contract

- Support USD only initially; reject unsupported currencies in production inputs. Keep an explicit currency code even while only one is enabled. Historical EUR domain tests are not production multi-currency support.
- Represent money as integer cents: USD 12.34 is 1234 minor units. Use a named Go int64 amount type and PostgreSQL BIGINT, with validation and checked arithmetic. Never use binary floating point for financial calculations.
- Use a GraphQL `MinorUnits` custom scalar encoded as an integer string, paired with a USD currency enum. Example JSON: `{"amountMinor":"1234","currency":"USD"}`. Scalar parsing and canonicalization details remain to be specified before publishing the schema.
- Preserve the existing record bound: expense and settlement totals are 1 through 999,999,999 cents (USD 9,999,999.99). Allocations can be zero. Balances can be negative; aggregate bounds are separate from record limits.
- Check aggregate arithmetic and database-to-Go conversions for overflow. Keep transmitted integers exact; any JavaScript-number conversion must check its safe-integer range. Decide frontend scalar arithmetic before Relay integration.
- Amounts paid and owed each reconcile to the expense total. Net positions sum to zero per currency. Settlements change sender and recipient positions equally and oppositely.
- Preserve deterministic equal-split remainders: distribute leftover cents by participant ID in ascending code-unit order, independent of UI selection order. USD 10 split three ways is 3.34, 3.33, 3.33. Specify a cross-language stable ID ordering before server implementation.

Rationale: minor units preserve exactness, and string transport avoids GraphQL Int's 32-bit limit and JSON client precision loss. Consequences: custom scalar validation and Relay mapping are required; string transport alone does not guarantee safe client arithmetic. See the existing [ledger contract](../../ledger.md).

## D4: Identity and membership

A group is the authorization boundary. An application user is linked to a Supabase Auth identity. A membership connects one user to one group and records owner/member role and active/inactive status. A user may belong to multiple groups; the data model has no two-person restriction.

Exactly one active owner exists per group. Registered users only: no guest financial participants. Invitations are separate expiring records; pending invitations grant no access and are not active memberships.

| Operation                                  | Owner                  | Member |
| ------------------------------------------ | ---------------------- | ------ |
| View group expenses, balances, and history | Yes                    | Yes    |
| Create expenses and record settlements     | Yes                    | Yes    |
| Edit/delete own expenses                   | Yes                    | Yes    |
| Edit/delete another member's expense       | Yes, with audit reason | No     |
| Invite/remove members, rename group        | Yes                    | No     |
| Transfer ownership                         | Yes                    | No     |

Permission applies within an active membership and does not override financial validation. Creator and payer are separate concepts; paying an expense does not by itself grant edit rights. Settlement editing/reversal permissions are not settled by the expense permissions above.

Lifecycle rules:

- Removal ends group access while preserving attribution in expenses, allocations, settlements, and audit history. Do not cascade-delete financial history.
- Inactive members cannot participate in new expenses. Historical corrections involving them require an explicit policy before implementation.
- Leaving or removal requires outstanding settlement obligations to be resolved. A zero net balance alone is insufficient where unresolved pairwise obligations remain.
- An owner transfers ownership before leaving. Transfer must be atomic and preserve the one-active-owner invariant.
- Rejoining restores the existing membership identity and its historical continuity; owner privileges must not be accidentally revived. Detailed role-restoration policy remains open.
- Email invitation acceptance requires the matching verified email of the signed-in user, is idempotent, and rejects expired/revoked invitations.

Rationale: separating identities, memberships, and invitations prevents invitations from granting premature access and preserves financial attribution. Consequences: departures and transfers require transactional checks against concurrent financial writes. Last-owner/group closure, account deletion, and historical visibility policies need explicit decisions.

## Implementation and change control

This ADR records design, not a blanket feature implementation issue. Design the initial SDL against real UI journeys, then implement a persisted, authorized expense-create/list/balance slice with Relay. Idempotency, audit, and atomic financial writes are required from the first mutation. Add remaining workflows incrementally; Plaid follows proven financial operations.

Use the [decision register](open-decisions.md) to resolve dependencies before their implementation issue is ready. Amend clarifications through PRs; document substantive reversals with a superseding ADR.

## References

- [Supabase JWT verification](https://supabase.com/docs/guides/auth/jwts)
- [Supabase PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase Queues](https://supabase.com/docs/guides/queues)
- [Supabase SQL migrations](https://supabase.com/docs/guides/local-development/database-migrations)
- [pgx](https://github.com/jackc/pgx), [sqlc generation](https://docs.sqlc.dev/en/latest/howto/generate.html)
- [GraphQL Int specification](https://spec.graphql.org/October2021/#sec-Int)
