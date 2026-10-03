# ADR-009: Invitation-scoped Auth continuation

## Status and scope

Accepted product policy in [issue #164](https://github.com/haggaikaunda/kami-split/issues/164), implemented by its onboarding change. This explicitly supersedes the targeted two-email account setup described in [ADR-006](006-invitation-onboarding-design.md) and the historical #108 restriction that shared links cannot start Auth provisioning. Historical issue/PR evidence remains unchanged. Financial, membership, readmission and owner policies are unchanged.

## Decision

A high-entropy targeted application capability is mailbox proof only for its canonical recipient stored by the application. The API accepts this proof on an explicit origin-checked POST bound to the original browser context and tab digest. It requires a live targeted invitation with an attempted application delivery (`UNKNOWN` or `PROVIDER_ACCEPTED`). Neither GET nor safe preview consumes proof. Browser-supplied email is never used by this exchange.

The restricted database atomically records one Auth claim per invitation before external I/O. The server uses Supabase's supported admin `generate_link` operation with `type=magiclink`, validates the returned recipient, subject and verification type, rejects disabled/deleted application identities, and rechecks invitation liveness before releasing its one-time token hash. The isolated browser client verifies the token before installing a session. New identities set a password; existing identities continue without a redundant password challenge. The provider sends no additional email. Admission still requires a separate explicit Join with fresh verified current-email evidence and full server authorization.

A reusable shared capability proves no email ownership. A live shared context may send an ordinary independent Auth invitation to a submitted email, with generic account-existence-safe responses. After verification and password setup, browser-bound callback state restores the original group context. Public signup remains disabled. Shared-link admission continues to reject former/inactive members.

## Failure, replay and recovery trade-off

The durable targeted Auth claim is never rolled back after a provider failure, uncertain response, restart or browser interruption. Competing attempts cannot mint multiple continuations. A same-token application resend extends invitation validity but cannot reset its Auth claim; immutable delivery retries also leave the claim unchanged. Provider material is not stored in the delivery payload or application database, so application delivery never depends on a short-lived Auth token.

This deliberately favors one-use proof over transparent distributed retry. If an account exists, ordinary sign-in/password recovery remains available. If setup was interrupted before an account existed, the inviter must revoke and create a replacement invitation. A replacement also recovers an unconfirmed identity left by an uncertain provider response without duplicating it. No automatic retry worker, encrypted provider-token cache or claim lease is introduced.

The existing encrypted browser contexts remain process-local, bounded to 15 minutes and fail closed on restart, expiry or another instance. Same-device callback recovery is supported; cross-device recovery and distributed context persistence remain outside this change. Deployment retains one instance or reviewed sticky routing.

## Evidence and limits

[Supabase generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink) is the supported provider primitive. Disposable Supabase CLI 2.118.0 tests verify both modern API-key and legacy JWT-key families, `signup` for new identities and `magiclink` for existing identities, one-time OTP verification, no second targeted email, independent shared-link Mailpit verification, and explicit admission. Database tests exercise concurrent claims, unsent/expired/shared rejection and same-token resend replay denial. Local tests do not claim production SMTP or hosted rehearsal evidence.
