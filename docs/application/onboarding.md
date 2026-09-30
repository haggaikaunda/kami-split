# Targeted onboarding, sessions and delivery

Issue #80 connects the [targeted invitation service](targeted-invitations.md) to Supabase Auth, Resend, thin GraphQL operations and real browser routes. It does not add invitation persistence, shared links, financial browser integration or hosted resources. The existing expense API is preserved. The financial screens remain a seeded preview; `/preview/sign-in` preserves the old account simulation. `/sign-in`, `/join`, `/auth/confirm`, `/auth/password` and `/account` use actual configured services and never render mock group data.

## Configuration and boundaries

The Go API requires its existing restricted `DATABASE_URL`, verified `AUTH_ISSUER` / `AUTH_AUDIENCE` / `AUTH_JWKS_URL`, and cursor signing configuration. Add all of:

| Setting                      | Meaning                                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVITATION_ACTIVE_KEY_ID`   | Version used for new invitation and browser-context encryption.                                                                                                |
| `INVITATION_KEYS`            | JSON map from version to unpadded base64url AES-256 key. Retain old keys for outstanding ciphertext and retained action digests.                               |
| `ONBOARDING_AUTH_URL`        | Trusted Supabase Auth URL ending in `/auth/v1`; HTTPS, or loopback HTTP locally.                                                                               |
| `ONBOARDING_AUTH_PUBLIC_KEY` | Supabase publishable/anonymous API key.                                                                                                                        |
| `ONBOARDING_AUTH_ADMIN_KEY`  | Server-only Auth admin credential, used only by the constrained eligible provisioning handler. Never give it to Next.js, GraphQL clients or the database role. |
| `ONBOARDING_ORIGIN`          | Exact browser origin, without trailing slash, used for origin checks and fixed callback destinations.                                                          |
| `RESEND_API_KEY`             | Server-only send credential.                                                                                                                                   |
| `INVITATION_FROM`            | Sender address for immutable `targeted-v1` messages.                                                                                                           |

The Next.js process needs `ONBOARDING_ORIGIN`, `ONBOARDING_API_URL` (fixed Go origin), `ONBOARDING_PUBLIC_SUPABASE_URL` (Supabase API root), and `ONBOARDING_PUBLIC_SUPABASE_KEY`. Only the last two public values are returned to the browser. Its same-origin proxy forwards the current request's bearer and context cookie, with no shared credentials or authenticated SSR cache. An unconfigured API still serves health; protected onboarding fails closed. The browser shows unavailable configuration rather than simulated success.

`ONBOARDING_LOCAL_DELIVERY_URL` optionally replaces the Resend endpoint with an HTTP **127.0.0.1-only** sink for local synthetic tests. No hosted provisioning or real-user mail is performed by repository tests. Production defaults to `https://api.resend.com/emails`.

## Supabase and email setup

Keep global public signup disabled and email confirmations enabled. Local configuration pins 900-second access tokens; Auth verification/recovery token expiry is independent of the application's seven-day invitation expiry. The supported stable browser SDK is pinned in `apps/web/package.json`.

Install the checked-in `supabase/templates/invite.html` and `recovery.html`. Configure only the deployment's exact callback origin and `/auth/confirm` path in the Auth redirect allowlist, allowing its state fragment. These templates use the supported [TokenHash and RedirectTo variables](https://supabase.com/docs/guides/auth/auth-email-templates). Admin invitations do not use PKCE code exchange. The browser calls `verifyOtp` only after an explicit button click and a same-browser, one-time state check. GET and email prefetch never consume Auth or application invitations.

For an authorized future hosted deployment, configure Supabase's supported [Resend SMTP integration](https://resend.com/docs/send-with-supabase-smtp): host `smtp.resend.com`, port `465`, username `resend`, password the dedicated send API key, and a verified sender. This is separate from the Go application's Resend HTTP transport. Local Supabase uses Mailpit instead. Do not enable email link tracking or analytics on capability/callback pages.

The designated first account uses the [operator bootstrap runbook](bootstrap.md)
and this same recovery flow.

A new invitee enters their email after a valid two-name preview. The server checks `Eligible` before calling the Auth admin invitation endpoint. New, existing, ineligible and interrupted provisioning receive the same generic response. Repeated provisioning preserves provider identity; it cannot grant membership. Existing accounts sign in or recover normally. Verification leads to the same password page used by a pre-created bootstrap account. Only explicit Join invokes `Accept`, rechecking live invitation, enabled application identity and fresh matching verified email. An Auth account left by interrupted/revoked provisioning grants no group access.

## Browser state and privacy

Application links use `/join#<capability>`. The browser scrubs the fragment and exchanges it by origin-checked POST for a random HttpOnly SameSite cookie. The Go process retains an AES-GCM encrypted capability bound to that random context for at most 15 minutes. Contexts and request budgets are bounded and purged every minute. A process restart or routing to another instance loses the context safely: reopen the original invitation or start recovery again. This initial implementation requires one instance or sticky routing; it does not claim distributed context persistence or cross-device callback recovery.

Callbacks carry only fixed types (`invite` or `recovery`) and random browser-bound state. No user-selected return URL is accepted. Sensitive pages send no-store and no-referrer headers; fragments are replaced before callback actions. The SDK stores its supported browser session separately. Application operation storage contains only kind/key, safe group/invitation IDs and a SHA-256 digest of the high-entropy original invitation capability, never email, password, token or full link. An unobserved action can be explicitly resubmitted with its original key and scope; after navigation, a create requires re-entering its original email. A different reopened invitation is rejected while a join attempt remains unresolved. Provisioning and acceptance carry this per-tab digest; the server checks it against the capability held by the current cookie, so another tab cannot switch which group an explicit Join accepts. After an email callback opens in a fresh tab, reopen the original application invitation in that tab before joining. Logout/account changes clear this state and cancel private requests; late responses cannot repopulate another account's UI. Login, callback verification and password changes use isolated nonpersistent SDK clients before applying appropriate session changes. Current-session logout explicitly warns that other devices may remain signed in and already-issued tokens may remain valid for 15 minutes.

## Operations and uncertain delivery

`packages/schema/onboarding.graphql` is authoritative. Preview exposes exactly group and inviter display names; invalid/expired/revoked/accepted capabilities share the generic unavailable-link outcome. Owner list/create/resend/revoke, original operation recovery, delivery retry and acceptance use #79 directly. Invitation and InvitationAction IDs use the existing typed `ks1` convention. Empty fields are null rather than fabricated IDs/timestamps. Historical acceptance includes current `hasAccess`, which is not an access credential.

The API accepts only one invitation root field per GraphQL request, including aliases. Before provider calls it applies bounded per-process budgets: 120 requests per peer IP/minute, 20 Auth mail attempts/minute globally, and two per canonical email/minute using keyed email digests. Forwarded-IP headers are ignored; a reverse proxy shares its peer budget. #79 additionally enforces its transactional send budgets. Scale-out requires reviewed shared budgets rather than multiplying this initial per-process allowance silently.

Save and send are separate operations. The UI attempts delivery after a newly saved create/resend, never after duplicate create. The sender claims the existing action, uses a five-second HTTP timeout inside its 30-second lease, and completes with provider accepted, definite failure or unknown. Errors/timeouts retain the original key and immutable payload. Owner list exposes recoverable actions; explicit retry does not renew expiry. Deliberate Resend creates a new action and extends the existing link once. Accepted/revoked actions remain terminal even if an email arrives late.

Keep the `targeted-v1` configured origin, sender and rendering unchanged while any recoverable intent exists; same provider key must mean the identical payload. Version a future template/configuration change instead of changing an old action's rendering. #79 retains the 23-hour recovery cutoff, terminal cleanup and periodic purge. There is no automatic retry worker, atomic database/email commit or exactly-once claim.

The fresh `/user` adapter uses the exact verified request bearer, refuses redirects, bounds response size/time, and reads current `email_confirmed_at`. #79 retains the five-second request-bound observation budget. Provider email changes and application commits are separate systems; this remains the documented bounded observation race.

## Verification

`make db-test` uses disposable local Auth/PostgreSQL and actual Mailpit messages, proving disabled public signup, invite/recovery verification without auto-confirm, password establishment, repeated invites, same existing identity, fresh email evidence, 900-second sessions, refresh and current-session logout. Independent HTTP tests exercise the configured API, owner actions, synthetic delivery, provisioning and admission under the restricted role. Existing invitation race/retention tests remain authoritative for persistence.

Focused adapter tests cover recipient/link and byte-identical retry payloads, definite/uncertain outcomes, redirects, malformed provider responses, origin checks, context expiry, callback replay, rate limits and GraphQL authentication/alias rejection. Independent UI tests cover double submission, uncertain acceptance/resend, original-key recovery, navigation/unmount, session expiration and account switching, including a regression for late password-update feedback. Real Chromium acceptance uses only synthetic local accounts and an HTTP email sink. Hosted SMTP delivery, physical devices and spoken assistive technology are not claimed by local verification.
