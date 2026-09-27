# Open architecture decisions

These are unresolved questions, not approved requirements or an implementation backlog. Accepted foundations are in [ADR-001](001-backend-foundation.md). Resolve each entry in a reviewed ADR/update and link its implementation issue when created. Keep stable IDs and retain resolved entries with their outcome.

| ID  | Decision to make                                                                                                                                                 | Resolve before                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| O01 | Sign-in methods, signup eligibility, email verification, invitation delivery and expiry duration, resend/revoke behavior                                         | Auth and invitations             |
| O02 | JWT library, key rotation/cache behavior, issuer/audience settings, session revocation expectations, browser session storage and refresh/logout behavior         | Auth integration                 |
| O03 | Application-user to Auth identity linkage, provisioning/recovery, email changes, account deletion and audit retention                                            | User schema                      |
| O04 | Runtime/migration roles, grants, RLS strategy, Data API exposure, transaction-local claims if used, bypass-denial tests                                          | Database foundation              |
| O05 | Supabase environment/region strategy, direct vs pooled connection, pool limits, TLS and secret distribution                                                      | Hosted database connectivity     |
| O06 | Pinned pgx/sqlc/Supabase CLI versions, schema analysis of managed objects, local Supabase/API Compose networking, isolated CI data and seed strategy             | Persistence tooling              |
| O07 | Migration rollout sequencing, backward compatibility, large backfills, recovery/rollback policy and backup/restore objectives                                    | First deployed migrations        |
| O08 | MinorUnits accepted syntax, int64/aggregate bounds, overflow errors, Relay scalar mapping and frontend arithmetic; stable cross-language participant ID ordering | Money schema and calculations    |
| O09 | Group creation/bootstrap, membership uniqueness, transaction/locking protocol for one owner and safe departure, owner transfer target eligibility                | Group/membership implementation  |
| O10 | Invitation acceptance vs revocation/expiry races, duplicate invitations, rejoin roles, returning-member historical visibility                                    | Invitations/rejoining            |
| O11 | Historical expense corrections involving inactive members; effects on previously settled obligations; settlement edit/reversal authorization and audit           | Edit/delete and settlement flows |
| O12 | Last-owner departure, group archival/deletion, handling disputed or unresolvable obligations, account deletion while membership obligations remain               | Departure/group closure          |
| O13 | GraphQL global IDs, cursor ordering, pagination/filtering, error unions/codes, expected-version and idempotency-key scope/retention, operation-result lookup     | Business SDL and first mutation  |
| O14 | First Relay migration slice, cache isolation on auth changes, mutation summary updates, drafts and uncertain-result recovery                                     | Real UI integration              |
| O15 | Hosting, regions, CORS/TLS, rate/query budgets, latency targets, metrics/log retention, alerting and operational recovery                                        | Production launch                |
| O16 | Plaid eligibility/consent, credential storage, webhook verification, sync cursors/reconciliation, pending-to-posted changes, expense assignment                  | Plaid integration                |
| O17 | Queue payloads, atomic enqueue/outbox choice, visibility/lease durations, retry/backoff, poison-message handling, deduplication and worker monitoring            | Durable jobs                     |

## Working sequence

Resolve the relevant subset rather than designing every future feature now: domain contract and access boundaries → persistence/local infrastructure → identity and minimal membership → first real expense/balance journey with Relay → safe edits/settlements and remaining UI workflows → operational readiness → Plaid and workers. Track detailed sequencing and delivery in GitHub issues; this register is not evidence that features exist.
