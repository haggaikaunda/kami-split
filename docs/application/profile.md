# Application profile

The authenticated `currentProfile` read returns the enabled, provisioned caller's
stable `ks1:Profile` public ID (distinct from Viewer and unavailable through Node lookup), application display name, and persisted appearance independently of group
loading. `updateMyProfile(displayName, expectedDisplayName)` accepts no target ID,
email, ownership, or financial input. It updates only `app.users.display_name`
through a narrowly granted SQL function under the verified transaction identity.
No runtime table-write privilege or Auth metadata write is introduced.

Names trim Unicode White_Space at both ends (U+0009–000D, U+0020, U+0085,
U+00A0, U+1680, U+2000–200A, U+2028–2029, U+202F, U+205F, U+3000) and
must contain 1–120 Unicode codepoints after trimming. International names and
internal whitespace are preserved; U+200B and U+FEFF are not whitespace here.

The exact previous name is compared after locking the actor row. A stale change
returns `CONFLICT`; requesting the already stored canonical name succeeds without
another write, including retry after response loss. Other failures return safe
`INVALID_INPUT`, `FORBIDDEN`, `UNAUTHENTICATED`, or `UNAVAILABLE` results. A failed
transport may have committed: refresh the self profile before deciding whether to
retry. Refresh authorized current projections after success. Stable identities,
memberships, financial balances, audit events and recovery snapshots do not change.
Invitation admission preserves existing application names instead of resetting
them from Auth metadata.

## Appearance preference

`Profile.appearance` is `LIGHT`, `SYSTEM`, or `DARK`; newly created accounts
default to `SYSTEM`. Existing saved values remain unchanged, including legacy
Light defaults that cannot be distinguished from explicit choices. `updateMyAppearance(appearance, expectedAppearance)` changes
only the enabled caller's preference through a narrowly granted SQL function.
The actor row lock serializes concurrent edits. A stale expected preference returns
`CONFLICT`, while a same-value retry succeeds. Display-name and appearance guards
are independent, so saving one cannot overwrite or conflict with an edit to the
other. The preference is private: shared member/name projections do not expose it.
Refresh after an uncertain transport result before explicitly retrying.

The shared browser root resolves the preference into `data-theme="light|dark"`.
Only System follows live OS/browser color-scheme changes. Account settings offers
Light, System, and Dark that apply immediately and save in the background. Guarded
writes are serialized, with rapid selections coalesced to the latest choice.
Only confirmed preferences enter the reload cache. Background focus reads cannot
overwrite a pending selection. Uncertain or conflicting writes require checking
the saved value before explicitly applying the retained selection again; rereading
never automatically overwrites a concurrent change. Other devices read the account preference at
startup and when their window regains focus.

A small local presentation cache stores the confirmed preference mode, bound to
the supported Auth session cookie's account ID (including chunked cookies). It is
not an identity or authorization source. The synchronous document-head bootstrap
validates that binding before applying the cache; missing, malformed, inaccessible
or mismatched values follow System. Explicit Light/Dark override the current OS.
Light is only the technical fallback when device color preference is unavailable.
The authenticated account scope then applies its matching cache and refreshes the
preference from the API. A new device follows System until its actual saved remote
preference arrives; this fallback never writes a preference to the server.

Theme subscriptions live for the account scope, independently of transient session
loading. Background verification and failed profile reads retain known appearance;
System rechecks the device on foreground return. A temporary verification
transport/server failure still disposes private access, but retains the verified
actor’s confirmed paint preference in memory. An unconfirmed editor preview
is released on unmount or private-scope replacement. Same-actor recovery preserves it even when
presentation storage is unavailable; a verified different actor replaces it.
Verified presentation identity is also conveyed when private storage prevents a
financial scope, so the new actor cannot inherit the prior actor’s paint. That
identity has no authorization role and starts no profile read without a live
private scope. Confirmed sign-out still discards paint when storage cleanup fails. Confirmed sign-out/access loss
removes the departing paint cache and follows System. A different account applies
only its own matching cache or System; old responses cannot recolor that account.
Document/body/loading surfaces and browser theme-color use shared semantic tokens.
The static manifest remains public installation metadata: native OS launch screens
and captured snapshots run before account-aware application code and cannot be
promised to match a local preference. Installed iOS launch/resume needs separate
physical-device verification from browser first-paint checks.
The approved dark palette is defined once in shared semantic tokens; automatic
OS-wide and Account-only dark palettes have been removed.

## Browser editing and navigation

`/account` is the full-page Profile destination, reached through Account in the shared
phone navigation or at the desktop sidebar bottom. Account remains selected and global navigation stays available. The compact content uses an identity divider,
stacked read-only email and editable display-name fields, and a native Appearance
selector in a leading column bounded to 560px. Appearance still saves independently
and immediately. It loads no financial overview. Its return link uses the actor-scoped
source visit. Personal origins require a fresh authenticated response and retain the
exact local section, dates and filters before source content restores scroll and focus. Household and directory visits have descriptive labels; a Group/Trip
origin, including nested expense, repayment and activity routes, resolves its name from a fresh, retained authorized group-name query, which
is revalidated on foreground return. While that authorization is pending, the return
waits without offering an unconfirmed destination. Failed or missing access falls
back to **Go to Groups**, as do direct entry, missing visits and unavailable account
context. Static Activity and group/trip creation origins retain their own descriptive
return labels without being mistaken for group IDs.
Source restoration waits for current authorized content and preserves ledger
filters, loaded extent, scroll and logical focus. Opening Profile alone does not
invalidate valid financial projections; a confirmed display-name change does. Profile loading and failure leave
navigation available. Save requires an actual server-confirmed profile; entered
text survives failures. An uncertain or conflicting save requires **Check current
profile** before another explicit save. The reread preserves edits and supplies
the new expected name; it never automatically replays a setter. Discard restores
the last confirmed name. Successful saves invalidate current Relay projections
without disposing the actor's financial scope, drafts or unresolved attempts.
Every workspace visit still reads current authorized names; immutable historical
financial/recovery snapshots remain intentionally unchanged.

Invitations now live under Members in the current Household, Group or Trip.
Header actions open the same scoped section; Household membership discovery does
not depend on financial overview readiness. The existing owner controller retains
shared/targeted actions, pagination, delivery and original-operation recovery.
An unfinished action from another space links back to its authorized original
workspace and cannot be relabeled or retried as a current-space action. Legacy
untargeted `/invitations` explains the new home; an explicit authorized owner
target resolves to the canonical Members route without choosing a first group.

Successful explicit local sign-out replaces the
route with `/sign-in` after private state cleanup; invitation Switch account
retains its separate continuation.
