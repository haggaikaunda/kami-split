# Invitation and onboarding technical recommendations

This is an engineering proposal under the [decision sheet](README.md), not a
runtime schema, migration or second source of invitation policy.

## Storage and capability boundaries (#79 targeted; #108 shared)

Both targeted and reusable shared paths use the implemented invitation service. Keep their distinct eligibility, token and delivery contracts explicit; current API/browser behavior is documented in [targeted invitations](../../targeted-invitations.md) and [onboarding](../../onboarding.md).

Use an explicit TARGETED / SHARED kind, never infer shared authorization from a
null email. Invitation has UUID, immutable group/kind/creator, created sequence,
expiry, revoked timestamp, token hash, ciphertext/key version, and targeted-only
recipient comparison key / accepted actor / membership outcome. CHECK constraints
keep kind-specific columns consistent. Partial unique (group,email_key) covers
unaccepted/unrevoked targeted rows, without filtering expiry. Under approved I2 a
partial unique group index covers unrevoked shared rows. Shared rows have no global
accepted state. Expiry is derived, not a terminal state or background cleanup job.

Tokens use 32 CSPRNG bytes, unpadded base64url, SHA-256 lookup hash, AES-256-GCM
recoverable copy with unique nonce and invitation ID/kind as authenticated data.
Only owner copy operation for shared links and authorized delivery materialization
can recover plaintext. Ordinary lists/actions/receipts never return tokens.
Targeted accepted/revoked transitions clear ciphertext and recipient email/comparison data atomically. Shared joins do
not clear it; revocation does. Expired outstanding links retain ciphertext. Key
rotation reencrypts under a new version without changing plaintext/hash/link;
missing key or failed authentication is unavailable, never token regeneration.
No backup/email-erasure claim follows live-row cleanup.

Store immutable action key, verified actor identity, operation kind, invitation/
group, canonical input digest, committed timestamp, safe result and optional
immutable delivery intent. Unique(actor,operation,key) prevents double execution;
a reused key with different inputs gives KEY_REUSED. Group is included in canonical
input, so a key cannot silently target another group. Canonical comparisons use
versioned deterministic serialization. Use a keyed digest for email-bearing inputs to avoid a dictionary-searchable retained email hash; key rotation must preserve comparison for retained actions. No plaintext token/password in action data.
Store targeted terminal admission outcome and shared per-actor admissions
separately; retained stable membership IDs are the result, never access credentials.
A new join after another departure is a new admission generation, not a replay of
an earlier receipt. Public recovery always checks current actor authorization.

Go owns policy. Narrow SECURITY DEFINER operations derive actor from #78's verified
subject, validate persisted token proof/kind/group/expiry, and atomically write only
the necessary invitation/admission/action rows. No generic add-member helper, actor
input, invited=true flag, arbitrary owner-pointer write, Auth SELECT or broad RLS
bypass for kami_api. Fixed search_path, fully qualified names, no dynamic SQL,
PUBLIC/browser execution revoked, minimal grants, real-role probes required.
Token preview has a separate narrow two-field projection; no group read grant.

## Email evidence and canonicalization (#80 to #79)

For each new acceptance attempt, #78 verifies the JWT. #80's server-side adapter
calls Supabase getUser with that access token outside database locks. Require a
successful response from the configured Auth service, exact subject equality,
nonempty current email and email_confirmed_at for that current email. Never trust
user metadata, JWT email alone, a client supplied proof or a future pending email.
Do not give ordinary runtime database credentials privileged Auth access.

Internal CurrentEmailEvidence contains subject, normalized email, observed-at
monotonic time and provider verification status. It is request-local, not a public
input/cache/bearer receipt. Recommend at most five seconds between successful Auth
response and admission's locked decision point. If lock waits exceed this budget,
rollback, refetch outside locks and retry bounded by the request deadline; do not
call the provider while holding database locks. Auth failure means UNAVAILABLE,
not wrong-email and never bypass. Recheck local account enabled/live link under lock.

Freshness semantics are explicit: current means the authoritative provider response
sampled for this attempt, within the five-second bound. This is NOT an atomic
transaction with Supabase email change: a change after that observation can race
admission. The merged #75 D4 calls for an external current-response protocol; this
recommendation supplies its bound without privileged Auth table reads. Review this
race explicitly. If strict commit-instant matching is required, block affected
admission until a separately reviewed provider-coordinated proof is demonstrated;
do not claim a second HTTP lookup eliminates the race. Changing email never
retargets invitations or memberships; the next attempt fetches new evidence.

Initial syntax recommendation: trim Unicode White_Space at the ends; accept ASCII
addr-spec without display names/comments/quoted local parts, max 254 bytes, local
part max 64, ordinary DNS domain labels. Reject internal whitespace/control bytes.
ASCII lowercase the whole accepted address, preserving dots/plus. Reject unsupported
internationalized forms visibly rather than silently converting them. One Go
canonicalizer handles create/provision/accept; DB stores a C-collated key and checks
its canonical shape. Local Supabase compatibility tests must cover uppercase,
whitespace, aliases, wrong address, pending/completed email changes and existing
users. Unsupported provider behavior is a failed engineering gate, not permission
to merge accounts or weaken verification.

## Transaction protocol and concurrency (#79)

READ COMMITTED, #75 order: existing affected users UUID order FOR SHARE, group
FOR UPDATE, invitation/action rows, then membership rows. New application-user
uniqueness on reserved Auth subject is resolved before group locks, inside the same
transaction; failed admission rolls it back. Disabled/tombstoned identity is denied,
never upserted enabled. Obtain fresh statements after waiting for locks and recheck
current owner/member/account state. A token lookup may locate immutable IDs before
locking but is not authorization. Cross-group/user receipt lookup returns safe denial.

After locks, use database clock_timestamp() as the decision time. Valid iff
not terminal and decision_time < expires_at; equality is expired. Set creation/
resend/renew expiry to that decision time plus seven days. Do not use transaction
start time across a lock wait. Validity is evaluated at the serialized decision
point; a transaction may finish committing just after the expiry instant. The
clock is injectable in tests through a test seam, never a caller-selected deadline.

Owner actions recheck the group owner pointer and enabled actor under locks. Group
ownership transfer uses the same group lock. Approved I2 preserves link validity while
transferring management to the current owner; former owners cannot copy/renew/revoke.
The preview's inviter label is original creator's current minimal display name,
not an email or historical profile snapshot; validate this minimal projection in implementation.

Targeted acceptance compares current verified evidence, consumes once, provisions
application identity if necessary, inserts or reactivates the permanent membership,
writes audit/result, clears ciphertext and commits atomically. Same-key recovery locates the actor-bound action before applying new-admission live-link checks; acceptance itself makes a targeted link terminal, so historical recovery cannot require a still-live link. Never changes owner
or designated-creator pointers. A replay reports historical completion plus current
access state, never updates membership. Acceptance-first makes later revoke/resend
ALREADY_ACCEPTED; revoke-first denies acceptance/resend. Resend-first changes the
expiry acceptance checks. Same action replay never extends again. Different resend
actions serialize; each sets its own seven-day expiry and delivery intent.

Shared first-time admission inserts permanent UNIQUE(group,user) membership and an
actor admission record; invitation stays reusable. Active-member retry is an
idempotent already-member result with current access check, not another admission.
Inactive is never treated as first-time merely because this link has no receipt.
Join-first then revoke leaves admitted membership; revoke-first denies joining.
A failed transaction leaves no user/membership/action residue. Unknown commit uses
the same key for recovery, not a new operation. Token expiry/revocation never
inactivates already-admitted memberships.

Approved I1 requires a new targeted invitation for every former-member return.
Old accepted links never reactivate membership; shared links always deny inactive
members, including after renewal. Implement no shared readmission grants or
owner-tenure/departure-generation authorization system. Targeted admission reuses
the permanent membership ID, sets ordinary membership and never changes ownership
or group-creation grants. Engineering must ensure an invitation predating departure
cannot become a new readmission capability through resend; choose the smallest
reliable persisted lifecycle ordering and test it with synthetic departure fixtures.
Departure/transfer services remain outside this assignment.

## Commit and delivery handoff (#79 persistence, #80 transport)

Commit invitation change, action result and a small delivery intent in one DB
transaction. Invoke Resend only after commit through #80. No broad queue framework:
request-driven dispatch plus explicit recover/retry is sufficient initially. Crash
between commit and send leaves a discoverable pending intent; UI does not claim sent.
A dedicated restricted dispatch capability can claim only that intent, with a
30-second lease and compare-and-set completion; ordinary browser roles cannot.
Workers, if later needed, reuse this protocol rather than inventing lifecycle state.

Materialize a stable encrypted message snapshot for the action (recipient/link/
expiry/text version), with no raw token in logs or normal queries. Provider key is
stable for that delivery intent, not regenerated per HTTP try. A retry uses identical
payload/key; a later deliberate resend is a new action and provider key. Snapshot
retention follows approved I3: retain only for bounded uncertain-send recovery,
purge when recovery is no longer needed and at the recovery-window deadline.
Select and test a reliable purge mechanism rather than leaving expired material
indefinitely. Clear snapshots at terminal transitions, and recheck terminal
state/current owner before claiming retry. An already-transmitted message may arrive
late; it cannot restore the invitation. Never hold DB locks across provider calls.

Delivery states: NOT_REQUESTED (shared/duplicate), PENDING, PROVIDER_ACCEPTED,
FAILED_DEFINITE, UNKNOWN, SUPPRESSED_TERMINAL. Provider acceptance does not assert
delivery. A timeout after transmission or lost completion write is UNKNOWN. Within
Resend's documented 24-hour deduplication window, retry same intent/key/payload with
current authorization. Conservatively stop retries 23 hours after first submission.
After that, recover state but require a deliberate new Resend to send again; do not
blindly retransmit the old intent. A currently expired link also needs deliberate
Resend rather than an email-only retry. Late successful responses cannot overwrite
terminal suppression or a newer lease. Unknown database commit first recovers the
action/intent; NOT_OBSERVED is not proof it never committed.

Recommend one deliberate send per invitation/minute and ten/group/hour, bounded
per-actor and recipient abuse limits, plus token/IP-based preview/provision budgets.
Limits are configuration with explicit retryAfter, not link-use caps. Same-action
status recovery never spends another email budget. On rate limit, do not mutate
expiry; authorize/check limit under the same group serialization before committing.
No automatic retry schedule or exactly-once guarantee is promised.

## Auth/browser and public adapter (#80)

Keep public Supabase signup disabled. A server-only invite-eligible provision
endpoint asks #79 to check live capability, kind and targeted email compatibility
before privileged Auth invitation creation. Use supported admin inviteUserByEmail
and configured Resend SMTP for verification; never auto-confirm or enable signup.
Shared mode asks recipient to enter their own email; targeted mode does not disclose
stored recipient email. This Auth message is separate from an application invite.
Auth admin credentials live only in the constrained provisioning component, never
browser, normal database role, or ordinary GraphQL resolvers. Protect cookie-based
endpoints with origin/CSRF checks; apply budgets before privileged/provider calls.

Return the same generic response for existing/new accounts and provisioning
uncertainty; never publish an email-existence endpoint. Existing users sign in or
use ordinary recovery. Repeated/interrupted provisioning never links accounts by
email or enables a disabled application identity. Provider-side duplicate handling
must be tested locally; a provisioned orphan is harmless to group access. Recheck
invitation/eligibility at final #79 admission even if Auth creation succeeded first.
Revocation between eligibility check and Auth creation may leave an Auth account,
never membership. Recovery sets a password through the normal reusable page;
verification remains mandatory and recovery alone cannot admit/reactivate.

Use a random server-side onboarding context bound to the browser, containing the
invitation capability encrypted at rest; expire after 15 minutes and allow reopening
the invitation to restart. Fixed allowlisted callback origins/paths, no arbitrary
return URL, token in query analytics or user-supplied group grant. Keep invitation
context out of Auth metadata. Validate state and supported callback token/type;
clear one-time callback material and replace URL before rendering external assets.
Use no-store, no-referrer and no third-party analytics on capability/callback pages.
A fragment-based application invitation entry minimizes access-log leakage; exchange
fragment via POST, scrub it immediately, and never consume on GET/email prefetch.
Explicit Join is still required after Auth verification; a recovered context is not
an admission proof. On context expiry reopen the original invitation, not a forged
redirect. Callback/provider integration must prove local stable behavior.

Request-scoped SSR clients; current-session credentials on every request; no shared
user caches. Account change/logout clears private state and replaces request epoch;
late previous-epoch responses cannot restore it. Persist only operation key/kind and
safe recovery context in tab sessionStorage, clear on logout/account switch; tokens,
passwords and recipient email are excluded. Cross-device/tab-close recovery is not
promised. Ordinary logout explicitly uses current-session scope and explains other devices
may remain signed in. Use the approved 15-minute access-token lifetime; engineering
selects and validates clock tolerance, refresh and independent Auth token durations.

The proposed thin contract uses #76 typed public IDs, OperationKey, explicit union
outcomes, 401 for invalid authentication and 503 for unavailable verification. Add
Invitation and InvitationAction ID types through reviewed contract extension; these
IDs never grant permission. The authoritative implemented SDL lives in `packages/schema`; these sketches are explanatory examples.

| Operation sketch                                                    | Authorization and result                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| previewInvitation(token)                                            | Public valid capability: groupName and inviterDisplayName only. Otherwise UNAVAILABLE_LINK, no names/recipient/account status; malformed and unknown indistinguishable.                                                                                                                                                   |
| ownerInvitations(groupID, first, after)                             | Current enabled owner; safe ID/kind/lifecycle/expiry/targeted recipient and action send status. Paginated max 50, stable createdAt/ID cursor, no link/token.                                                                                                                                                              |
| createTargetedInvitation(groupID,email,key)                         | Current owner; SAVED or EXISTING, invitation state and separate delivery state. Duplicate does not send.                                                                                                                                                                                                                  |
| resendInvitation(id,key) / revokeInvitation(id,key)                 | Current owner; APPLIED, ALREADY_ACCEPTED, ALREADY_REVOKED, RATE_LIMITED, KEY_REUSED or safe denial/unavailable.                                                                                                                                                                                                           |
| createSharedInvitation(groupID,key) / renewSharedInvitation(id,key) | Current owner; lifecycle result, NOT_REQUESTED delivery; duplicate create does not renew.                                                                                                                                                                                                                                 |
| copySharedInvitation(id)                                            | Current owner, explicit sensitive no-store response; no expiry change or application email. Expired link may be copied with expiry warning, revoked cannot.                                                                                                                                                               |
| acceptInvitation(token,key)                                         | Verified actor/evidence; ADMITTED, ALREADY_MEMBER, HISTORICAL_ACCEPTANCE_NO_ACCESS, WRONG_ACCOUNT, VERIFY_EMAIL, UNAVAILABLE_LINK, NEW_TARGETED_INVITATION_REQUIRED, ACCESS_DISABLED or UNAVAILABLE. No group projection until currently admitted.                                                                        |
| ownerInvitationAction(key,kind) / retryInvitationDelivery(actionID) | Same actor and current management authority; original result plus current state, no sensitive snapshot/token; retry never extends expiry.                                                                                                                                                                                 |
| admissionAction(key)                                                | Same verified Auth subject as original acceptance, including an unprovisioned actor after rollback; historical result plus current access, no group projection while inactive/disabled. No owner role or renewed email-match requirement just to recover the historical result. Another subject/account gets safe denial. |

Preview invalidity is generic publicly; current owners get exact lifecycle states.
WRONG_ACCOUNT/VERIFY_EMAIL never echo the target address. Accepted targeted link
alone gets no preview; the accepting authenticated actor may recover a safe historic
outcome, with current access independently checked. Former/disabled users cannot
read group data through that receipt. the current [onboarding guide](../../onboarding.md) and authoritative SDL define adapter operations; names here remain explanatory sketches.

## Primary-source checks and limits

Checked 2026-09-30: [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser)
uses a server request, [admin invitation](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail)
provides invitation email, and [Auth configuration](https://supabase.com/docs/guides/auth/general-configuration)
controls signup/confirmation. [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)
is time-bounded, motivating durable application action records.
[Supabase signout](https://supabase.com/docs/guides/auth/signout) supports explicit
scope and does not instantly invalidate already-issued access tokens. These sources
support API selection, not a claim that the combined flow or proposed settings have
passed integration tests. Pin stable SDKs and verify the exact disabled-signup,
existing-user, invite callback, pending-email and recovery behavior in the local
Supabase stack before shipping; no hosted provisioning is authorized here.
