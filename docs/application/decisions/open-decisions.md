# Open architecture decisions

This register distinguishes accepted outcomes from unresolved questions; it is not an implementation backlog. Accepted foundations are in [ADR-001](001-backend-foundation.md) and refinements in [ADR-002](002-authentication-and-database-operations.md). Resolve each entry in a reviewed ADR/update and link its implementation issue when created. Keep stable IDs and retain resolved entries with their outcome.

## O01–O07: accepted policies and remaining details

[ADR-002](002-authentication-and-database-operations.md) records the accepted outcomes. These entries are retained for traceability; partially settled does not mean the policy is unapproved or the feature is implemented.

| ID  | Status and accepted outcome                                                                                                                                                        | Still to resolve                                                                                                       | Timing                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| O01 | Policy settled: email/password, invite-only, Supabase Auth + Resend, seven-day invitation, same-link resend extending expiry, acceptance/revocation terminal                       | Bootstrap in O09; expired resend/token storage/races in O10; delivery configuration during implementation              | Auth and invitations                            |
| O02 | Policy settled: golang-jwt/v5 + keyfunc/v3, ES256, Relay Bearer transport, Supabase session integration, no immediate session revocation, hourly JWKS refresh/two-hour maximum age | Exact versions, token lifetime/logout scope, issuer/audience values, fetch timeout/rate limit and clock tolerance      | Auth integration                                |
| O03 | Partially settled: stable application identity, unique Auth link, invite-based retry-safe provisioning, verified email changes, deactivate-before-delete                           | Retention/anonymized display, account-deletion recovery, group closure dependencies                                    | User lifecycle                                  |
| O04 | Architecture settled: private app schema, separate restricted roles, transaction-local verified identity, RLS isolation, Go business authorization                                 | Concrete role grants, policy SQL and helper privileges, tested claims mapping                                          | Database foundation                             |
| O05 | Partially settled: direct pgxpool/session fallback, initial five-connection cap, verified TLS, separate secrets                                                                    | Host/region, hosted staging choice, connection mode and total deployment budget                                        | Hosted connectivity                             |
| O06 | Workflow settled: stable tooling only, desired SQL plus migrations, Supabase local stack and API Compose, isolated synthetic CI                                                    | Version pins, verified stable generation/manual reconciliation commands, networking and sqlc managed-object analysis   | Persistence tooling                             |
| O07 | Policy settled: serialized GitHub Actions deployment, no cancellation/startup runner, expand/backfill/contract, free-plan-only backups                                             | Deployment triggers, staging choice, verified backup/export availability and storage/retention, tested recovery limits | First deployed migrations and production launch |

## Other open decisions

| ID  | Decision to make                                                                                                                                                                     | Resolve before                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| O08 | MinorUnits accepted syntax, int64/aggregate bounds, overflow errors, Relay scalar mapping and frontend arithmetic; stable cross-language participant ID ordering                     | Money schema and calculations    |
| O09 | Group creation/bootstrap, membership uniqueness, transaction/locking protocol for one owner and safe departure, owner transfer target eligibility                                    | Group/membership implementation  |
| O10 | Invitation acceptance/resend/revocation races, expired-invitation resend, secure reusable-token storage, duplicate invitations, rejoin roles, returning-member historical visibility | Invitations/rejoining            |
| O11 | Historical expense corrections involving inactive members; effects on previously settled obligations; settlement edit/reversal authorization and audit                               | Edit/delete and settlement flows |
| O12 | Last-owner departure, group archival/deletion, handling disputed or unresolvable obligations, account deletion while membership obligations remain                                   | Departure/group closure          |
| O13 | GraphQL global IDs, cursor ordering, pagination/filtering, error unions/codes, expected-version and idempotency-key scope/retention, operation-result lookup                         | Business SDL and first mutation  |
| O14 | First Relay migration slice, implementation of ADR-002 session isolation, mutation summary updates, drafts and uncertain-result recovery                                             | Real UI integration              |
| O15 | Hosting, regions, CORS/TLS, rate/query budgets, latency targets, metrics/log retention, alerting and operational recovery                                                            | Production launch                |
| O16 | Plaid eligibility/consent, credential storage, webhook verification, sync cursors/reconciliation, pending-to-posted changes, expense assignment                                      | Plaid integration                |
| O17 | Queue payloads, atomic enqueue/outbox choice, visibility/lease durations, retry/backoff, poison-message handling, deduplication and worker monitoring                                | Durable jobs                     |

## Working sequence

Resolve the relevant subset rather than designing every future feature now: domain contract and access boundaries → persistence/local infrastructure → identity and minimal membership → first real expense/balance journey with Relay → safe edits/settlements and remaining UI workflows → operational readiness → Plaid and workers. Track detailed sequencing and delivery in GitHub issues; this register is not evidence that features exist.
