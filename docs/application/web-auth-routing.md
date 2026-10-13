# Web authentication routing

Only `/sign-in` is a public application page. `apps/web/src/proxy.ts` verifies a
Supabase cookie session with `auth.getUser()` before Next renders any other page,
including `/`, deep links, prefetch/Flight requests and future routes. A signed-out
home request goes directly to sign-in; verified users retain `/groups` as home.
Static framework resources, the two current illustration assets, the root manifest
and the three installation PNGs are explicitly exempt by exact asset path. Other
image-shaped paths remain protected. API handlers remain accessible at their existing paths and retain their
own authentication, authorization and origin checks; this boundary does not grant
financial access or change the Go/database permissions.

The supported `@supabase/ssr` browser and per-request server clients share the
`kami-auth` cookie storage key. Cookies are SameSite=Lax, path `/`, and Secure on
HTTPS, and are accessible to the browser SDK as required by Supabase's supported
integration. Only the public Auth URL/key are used. Refresh writes are propagated
to both the downstream request and response, including redirects. Page responses
are private/no-store and no-referrer. The proxy owns unexpected server diagnostics with only a fixed `auth.boundary` event and `verification_unavailable` outcome; raw provider errors, account identifiers and request data are never logged. The previous localStorage-only session is
removed on upgrade and requires one new sign-in; it cannot authorize a server
request. No browser credential is copied into a query or logged.

A valid cookie snapshot alone is insufficient. Every protected request makes a
fresh provider user check with a bounded transport timeout. Provider rejection,
missing configuration and transient failures fail closed. An unavailable provider
leads to sign-in with a static message and an explicit retry link. The sign-in
controller also verifies its session so rejected cookies cannot produce a
Continue-to-account loop in place of a working credential form. Existing
current-session sign-out semantics remain: other devices can stay signed in, and
provider-issued access tokens can remain valid for their existing bounded lifetime
(up to 15 minutes). Provider rejection is enforced immediately when observed;
this change does not introduce a separate backend revocation list.

`FinancialSession` owns actor-scoped Relay memory, drafts, expiry checks and Auth
subscriptions. `AuthBoundary` suppresses protected children until verification,
on refresh resolution/failure and on logout; only a neutral status or an actionable
error is rendered. Session changes invalidate old scopes and clear private storage
before another actor gains a scope. Foreground/history restoration checks Auth
again. A synchronous pagehide/visibility handler hides protected DOM before a
BFCache snapshot, and restoration waits for verification. Supabase Auth broadcasts
session events between tabs; passive sign-out clears local private state while
preserving another tab's separate invitation context.

The `next` continuation uses `financialReturn`: only current financial paths,
Account and legacy Invitations with their allowed query fields survive. External,
protocol-relative, backslash/control-character targets, fragments, unsupported
query fields and auth-route loops fall back to `/groups`. Next's internal `_rsc`
request field is discarded before continuation sanitization. Destination access
is still checked by the server after sign-in. New protected routes are denied by
default and use the fallback until deliberately added to the return sanitizer.

Legacy `/join`, `/auth/confirm` and `/auth/password` redirect to `/sign-in` with
fixed `flow=join`, `flow=confirm` or `flow=password` selectors, for signed-out and
signed-in visitors alike. HTTP redirects inherit fragments in the browser; the
server never sees or copies an invitation capability or callback hash into the
Location query. The existing controller captures fragments in memory and scrubs
them while retaining only the safe flow selector. The original one-time
browser-bound state checks, invitation digest/context binding, isolated OTP
clients, switch-account behavior, explicit Join and password setup remain intact.
Email templates and provider callback allowlists retain their existing legacy
paths. GET/prefetch never consumes a capability or verifies an OTP.

## Verification

Route boundary tests cover signed-out HTML and Flight denial, unknown nested
routes, verified sessions, refresh cookie propagation, expired/rejected/error
checks, static/API exclusions and safe handoff/return fields. Browser boundary
tests cover neutral loading, failure, logout and pre-snapshot hiding; session tests
retain actor-switch/storage-failure and same-account cleanup checks.

The opt-in `scripts/auth-boundary-browser.cjs` runs a synthetic local Auth service
and a production Next server on loopback (default ports 3196 and 3195). After
`pnpm build`, run with an external `PLAYWRIGHT_MODULE` and `CHROME_PATH` if needed:

```sh
node scripts/auth-boundary-browser.cjs
```

It exercises actual browser cookies and server-visible Auth checks on desktop and
mobile, cold HTML/Flight requests, safe continuation, rejected/expired sessions,
provider failure, sign-out/multi-tab/history/reload, invitations, confirmation and
password setup. Synthetic fixtures prove web behavior, not hosted delivery,
provider revocation semantics or real database authorization. Existing Auth/API
and restricted database integration suites remain the provider/security evidence.

The navigation/account/appearance/percentage synthetic runners and the optional
`edit-real-browser.cjs` / `percentage-real-browser.cjs` runners also use the shared
`browser-auth-fixture.cjs` cookie setup. Start their externally supplied Next
preview with `ONBOARDING_PUBLIC_SUPABASE_URL=http://localhost:3196` and
`ONBOARDING_PUBLIC_SUPABASE_KEY=synthetic-public`; run one fixture at a time. A
custom `BROWSER_AUTH_ORIGIN` must be loopback and match that Next Auth URL. The real
financial runners retain the Go fixture's actual verified bearer and real
GraphQL endpoint; their local Auth fixture models only the web session boundary,
not production identity or financial authorization. Their optional real-database
journeys require the existing disposable integration setup and environment flags.
