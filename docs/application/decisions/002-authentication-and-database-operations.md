# ADR-002: Authentication and database operations

- Status: Accepted policies with explicit implementation details still open.
- Decision date: 2026-09-27.
- Authority: Owner-approved follow-up discussion for O01–O07.
- Relationship: Refines [ADR-001](001-backend-foundation.md); its platform, money, and membership decisions remain in force.

## Context and implementation status

The API remains a health-only scaffold. This document records decisions, not implemented Auth, database, email, or deployment functionality. No resources or paid services are provisioned. See the [decision register](open-decisions.md) for remaining choices.

## Follow-up decisions

[ADR-003](003-bootstrap-groups-and-invitations.md) resolves bootstrap and further invitation lifecycle/token policies while preserving all other Auth/security policies here. Accepted design remains distinct from implementation.

[ADR-004](004-group-balances-membership-and-recovery.md) records ordinary-member/full-history readmission and same-attempt financial recovery, retaining current authorization on retries and receipt reads. It does not change the session/JWKS policy, decide account deletion/retention, or combine financial durability with email delivery semantics.

## O01: Sign-in and invitations

Use email/password sign-in with Supabase Auth. Signup is invite-only; disable public self-registration. Use Supabase Auth for verification and Resend for email delivery, including application invitations. Supabase verification links and application invitation links have separate lifecycles; configuring the same delivery provider does not combine their tokens.

An application invitation expires seven days after issuance. Resend reuses the same invitation and token/link, extending expiry to seven days from the resend. It does not create duplicate invitations or invalidate older copies of that link. Accepted or revoked invitations cannot be revived by resend. Revocation invalidates the invitation immediately. [ADR-003 B5/B6](003-bootstrap-groups-and-invitations.md#b5-invitation-lifecycle-o10) now specifies expired outstanding resend, duplicate/race outcomes and reusable-token protection; O10 retains the remaining design details.

Acceptance requires the matching current verified email and consumes the invitation atomically. Repeated acceptance must not create duplicate membership. Existing users join with their existing account. Account signup eligibility and group admission are separate: revoking a group invitation does not delete an existing account. First-account administrative bootstrap is the explicit exception described in [ADR-003 B1](003-bootstrap-groups-and-invitations.md#b1-explicit-administrative-bootstrap-o09); ordinary provisioning remains invite-based.

Rationale: simple, predictable invitation behavior without treating delivery-provider defaults as application policy. Consequence: older copies of a link share the extended expiry; verification and revocation remain necessary.

## O02: Sessions, GraphQL credentials, and key rotation

Use `github.com/golang-jwt/jwt/v5` with `github.com/MicahParks/keyfunc/v3` for JWT verification and JWKS integration. Pin patched stable versions at implementation. Configure Supabase asymmetric ES256 signing and allow only ES256 initially. Validate signature, expiry, configured issuer/audience, and required user claims. JWKS URLs and trust settings come from trusted configuration, never token-supplied URLs.

Use Supabase's supported Next.js session integration for storage/refresh. Relay's network function reads the current session for each request and sends only the access token in `Authorization: Bearer ...`; Go never needs the refresh token. Browser session reads supply credentials, not trusted identity: Go performs verification. Server-rendered requests use a request-scoped Supabase client and Relay store, never shared user state. Use HTTPS outside local development and explicit allowed-origin CORS if origins differ.

Logout calls Supabase sign-out and clears browser session, private drafts, and Relay data. Replace the Relay environment on logout/account change and prevent old in-flight responses from restoring prior-user state. Do not blindly retry mutations; preserve idempotency and uncertain-result recovery. Standard validation accepts an already-issued token until expiry after logout; the owner explicitly accepts that window. Do not add a Supabase session lookup or revocation store to every request. Current application-user status and group permissions are still enforced. Exact access-token lifetime and logout scope (current session versus all sessions) remain open.

JWKS policy:

- Load the configured project's public keys before protected routes become ready.
- Verify normal requests locally using cached public keys; do not cache user authorization as part of this mechanism.
- Refresh hourly with jitter. Unknown key IDs trigger one coordinated, rate-limited refresh rather than one outbound fetch per request.
- Retry fetch failures with backoff; trust cached keys for no more than two hours since the last successful fetch. A failed attempt does not reset cache age.
- If usable keys are unavailable, deny protected access. Distinguish infrastructure unavailability from invalid credentials; never bypass verification.
- Successful refresh replaces the published key set, removing keys no longer present. Refreshing keys does not extend JWT expiry.
- For routine rotation, publish standby keys, ensure upstream caches and API instances can see them, then switch signing. Retain old verification keys until previously issued tokens expire (including validation clock tolerance), then revoke.
- Provide explicit local cache invalidation for emergency revocation. Account for upstream cache delays: local refresh alone cannot guarantee instantaneous global revocation.

Rationale: local verification keeps requests independent of Auth service round trips, with bounded cache behavior. Consequences: token revocation and signing-key revocation are different concerns; both have explicitly accepted or bounded propagation windows. Cache rate limits, fetch timeouts, clock tolerance, concrete integration versions, and exact project issuer/audience values must be tested and configured during implementation.

## O03: Application identity and account lifecycle

Give each application user a stable ID with a unique link to the Supabase Auth user ID. Memberships and financial history reference the application identity, not email. Never automatically merge/link users because emails match.

For ordinary provisioning, after verified authentication and a valid invitation, Go creates the application user and accepts membership transactionally. Auth account creation is outside that application transaction: an Auth account left by incomplete provisioning grants no group access, and retry must safely complete provisioning without duplicate users/memberships.

The designated first account instead uses supported administrative Auth creation and normal emailed recovery, with verification still required, followed by an operator-only application transaction as specified in ADR-003. This exception does not enable public signup or a bootstrap invitation.

Supabase handles verified email changes; memberships remain linked to identity. Pending invitations require the current verified matching email and are not automatically retargeted by an email change.

Deactivate application access before deleting the Auth account. Require obligations resolved and ownership transferred, or group closure under a separately agreed policy. Retain financial records and minimal inactive application identity; avoid cascade deletion. Remove unnecessary profile data. Auth deletion/retry must not reactivate application access. Display-name anonymization, retention requirements, and final-group closure remain unresolved. A disabled application user is denied even while an old JWT remains valid; this is an application-status check, not per-request Supabase session revocation.

## O04: Database access and isolation

Use a private `app` schema excluded from exposed Supabase Data API schemas. Keep managed authentication identities in `auth`; do not own or recreate provider internals. Explicitly deny browser roles direct application-table/queue access. Use separate restricted API, migration, and future worker roles. The runtime role must neither own protected tables nor hold BYPASSRLS or administrative privileges.

Enable RLS for group isolation in addition to Go business authorization. After verifying the JWT, Go starts a pgx transaction, sets verified identity as transaction-local context, and executes sqlc queries in that transaction. Never derive identity from a submitted user ID. Missing context denies access, and pooled reuse must not leak identity. Test real runtime-role access, absent context, cross-group denial, and alternating-user pooled requests. Do not assume direct pgx connections inherit Supabase JWT permissions automatically.

Keep a focused database-access package and explicit SQL. Application operations own multi-table pgx transactions by default; database functions are justified by specific invariant/atomicity needs, not required for every operation. Restrict and review any SECURITY DEFINER helpers and their execution/search-path privileges. Detailed role grants, claim mapping, and policy SQL require implementation review.

## O05: Environments and connections

Use local Supabase for development. Prefer colocated Go and Supabase hosting regions. For the long-lived Go service use direct PostgreSQL through pgxpool, with session pooling as the IPv4 alternative; no transaction pooler initially. Start with a configurable maximum of five connections per API instance and budget all replicas, workers, migrations, and provider services against the actual database limit.

Verify hosted database TLS certificates and hostnames. Use ignored local environment files and hosted secret storage, keeping migration credentials out of the API and production secrets out of PR jobs. Actual region, host connectivity, total pool budget, and whether to create a separate hosted staging project remain undecided; no staging expenditure is approved here.

## O06: Stable tooling and development workflow

Use only stable tooling. Do not adopt experimental pg-delta or experimental CLI flags. Pin compatible stable pgx, sqlc, Supabase CLI and supporting tool versions in the foundation implementation.

Keep desired-state application SQL in `supabase/schemas` and immutable deployment history in `supabase/migrations`. Use a verified stable CLI generation path if supported by the pinned version. Otherwise write and review migrations manually and reconcile desired-state SQL; experimental tooling is not an acceptable workaround. CI must detect divergence between intended application structure and migration replay. Review grants, RLS, destructive changes, and backfills in all generated SQL.

Supabase CLI owns the local Supabase containers (database/Auth); Compose owns the Go API. Root commands coordinate networking and ports without provisioning a competing database. Use synthetic isolated CI data, real runtime-role security tests, fresh replay and upgrade tests. Supabase-managed references needed for sqlc analysis must not become application migrations that replace provider objects. Exact stable workflow commands, network setup, version pins, and analysis inputs remain implementation decisions.

## O07: Migration deployment and backups

GitHub Actions orchestrates migration deployment using the Supabase CLI and committed migrations; no second orchestration system or API-startup migration runner. PR jobs test disposable local infrastructure and do not receive production credentials.

Serialize target-environment deployment jobs with environment-specific concurrency and do not cancel an in-progress migration. Review pending migrations; a dry run does not prove execution safety. Apply backward-compatible expansion before compatible application deployment and smoke tests. Backfill in bounded restartable batches, then remove obsolete structure in a later reviewed contract migration. Test both fresh installation and upgrades from the previous release. Require a recovery plan for destructive changes. Prefer compatible application rollback or corrective forward migrations over automatic destructive down migrations. Never reset production.

Backups must stay within available free-plan capabilities; paid PITR is not required or authorized. Do not promise managed backups, retention, or a recovery objective without verifying the actual free-plan offering. The previously proposed one-hour data-loss/four-hour restoration targets are not adopted. Determine an affordable supported export/storage schedule and test restoration before relying on it. Exact backup method, retention, recovery limits, deployment triggers, and hosting/staging choice remain open. GitHub Actions supplies orchestration, not migration correctness or backup guarantees.

## References

- [Supabase sign-out](https://supabase.com/docs/guides/auth/signout) and [signing keys](https://supabase.com/docs/guides/auth/signing-keys)
- [golang-jwt](https://github.com/golang-jwt/jwt), [keyfunc](https://github.com/MicahParks/keyfunc)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase migrations](https://supabase.com/docs/guides/local-development/database-migrations) and [backups](https://supabase.com/docs/guides/platform/backups)

Provider documentation evolves; accepted stable-only and free-plan constraints take precedence over adopting newly documented experimental or paid features.
