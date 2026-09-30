# Verified API identity

Issue #78 implements the actor boundary specified by ADR-002 using
`golang-jwt/jwt/v5 v5.3.1` and `MicahParks/keyfunc/v3 v3.8.2`. These were the
latest stable module releases checked at implementation. Issue #82 now exposes the reviewed [business expense fields](persisted-expenses.md) using this boundary. Onboarding, session lookup, a revocation database, invitation service and hosted configuration remain outside this authentication implementation.

## Configuration and request flow

Set all of `AUTH_ISSUER`, `AUTH_AUDIENCE`, and `AUTH_JWKS_URL`, together with the
existing restricted-role `DATABASE_URL`. Values are project-specific; none are
embedded in the application. Issuer and JWKS endpoint must use HTTPS, except
explicit loopback HTTP addresses for local fixtures. Credentials, queries and
fragments in those URLs are rejected. Partial/empty auth configuration is an
error. Absent auth settings retain the health-only development mode.

The server authenticates GraphQL request credentials into private request context.
Only one `Authorization: Bearer <access token>` is accepted. Verification permits
ES256/P-256 only, checks the configured issuer/audience, signature, required expiry,
issued-at, canonical nonzero UUID subject and `role: authenticated`. Optional
not-before is checked. Clock tolerance is 30 seconds. Access tokens are bounded to
16 KiB. Token-supplied `jku`, `x5u`, `jwk`, `x5c` and critical-extension headers are
rejected, never fetched or used as keys. Refresh tokens are never accepted as a
separate credential type.

Protected application operations call `auth.WithActor(ctx, db, callback)`.
It consumes the private verified evidence, invokes #75's `DB.WithIdentity`, binds
`app.verified_sub` transaction-locally and reads `app.viewer_identity()` inside
that transaction. The callback receives the stable application ID and a `pgx.Tx`,
only for a currently READY account. Disabled and unprovisioned identities do not
reach the callback. No user ID or metadata from a GraphQL input supplies this
identity. Only the existing database helpers determine group visibility; an actor
alone grants no group authority. Callbacks must use their transaction and the
reviewed group locking/authorization helpers, never the pool. Authorization is
rechecked per operation; no account or membership status enters the key cache.

`Verifier.Protect` is the reusable protected HTTP wrapper. The server uses `Authenticate` so missing/invalid credentials do not alter public health. A pre-execution check requires verified credentials for business selections; application operations then invoke `WithActor` and map its outcomes at the owning transport boundary. Attaching middleware alone does not authorize a resolver. The lower-level
`DB.WithIdentity(subject, ...)` remains a trusted internal/database-test primitive,
not a request-facing API.

## Outcomes and readiness

Missing/invalid credentials map to HTTP 401 with safe GraphQL code
`UNAUTHENTICATED`; verification or database unavailability maps to HTTP 503
`UNAVAILABLE`, consistent with #76. The current protected HTTP boundary maps
DISABLED and UNPROVISIONED to HTTP 403 with their distinct safe codes. The implemented `viewer` resolver exposes these self-only states as `ViewerAccess` without admitting group access. Unexpected dependency/callback
errors are reduced to UNAVAILABLE, with no SQL/provider error details or request
payloads exposed. No token/key contents are logged.

`/healthz` and GraphQL `health` remain public liveness checks. With auth configured,
`/readyz` additionally requires a successfully warmed, nonempty JWKS cache younger
than two hours and the existing database readiness check. Failed warmup starts
an unready process whose owned refresh loop retries; it never allows protected
requests through. Public health does not imply protected readiness.

## Cache lifecycle and emergency operation

The verifier uses keyfunc's static validated key sets; its HTTP auto-cache is not
used. A successful fetch atomically **replaces** the entire set, including removal
of missing keys. Empty published sets revoke local access. Only unique named
public EC P-256 signing keys are accepted. Requests normally verify locally.

- Fetch timeout: five seconds, honoring caller cancellation; response maximum:
  64 KiB. HTTP redirects are refused. Only the configured endpoint is contacted.
- Scheduled refresh: one hour after a successful fetch, with independently sampled
  jitter from minus five to plus five minutes. A one-second owned timer checks due
  work; shutdown cancels and joins the refresh loop.
- Unknown key IDs and cold/stale caches share one in-flight fetch. Waiting requests
  can cancel independently. Successful fetches suppress additional probes for
  30 seconds, including repeated unknown IDs. A remaining unknown ID after a
  successful refresh is invalid credentials; failed verification infrastructure is
  unavailable.
- Failed fetches retry at 1, 2, 4, 8 seconds and so on, capped at five minutes.
  Requests and the scheduler share this backoff. Failures never reset the last
  successful-fetch timestamp. Known keys remain usable strictly less than two
  hours after that timestamp; expired tokens remain expired after key refresh.
- Send `SIGHUP` to the local API process for emergency invalidation. It discards
  all keys immediately and prevents an already in-flight fetch from republishing
  its result. Protected readiness/access fail closed until the next successful
  refresh. `Verifier.Invalidate()` provides the same explicit in-process control.
  This does not invalidate upstream caches or promise instantaneous global key or
  session revocation. Each API instance must receive the operation.

Current verified-email proof for invitation acceptance remains #79/#80 work:
a signed, stale JWT email is not evidence that the email is currently verified.
Access-token lifetime and logout scope remain the existing tracked decisions.

## Verification

`go test -race ./...` covers real HTTP requests, malformed/tampered/expired tokens,
claim/algorithm/trust restrictions, safe errors, public health and protected
readiness. Injected clock/fetcher tests cover cache age, jitter, replacement,
concurrent unknown keys, backoff, cancellation and in-flight invalidation.

`make db-test` runs the auth integration package as well as the existing database
suite in disposable real Supabase PostgreSQL. Signed HTTP requests use the real
restricted `kami_api` role with a single-connection pool, distinct Auth/application
IDs, alternating actors, disabled old tokens, unprovisioned accounts, inaccessible
groups, rollback and request cancellation. Reused connections contain no previous
identity. Existing #75 tests also prove absent-claim, inactive and cross-group RLS
denial, including after transaction reuse; no grants or policies are widened.
