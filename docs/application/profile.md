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

`Profile.appearance` is `LIGHT`, `SYSTEM`, or `DARK`; existing and new accounts
default to `LIGHT`. `updateMyAppearance(appearance, expectedAppearance)` changes
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

A small local presentation cache is bound to the Auth session's account ID; it is
not an identity or authorization source. The document-head bootstrap currently
requires matching legacy `kami-auth` local storage before applying that cache.
Supported cookie-only sessions therefore begin with Light even when the account
has a cached Dark or System preference. Once the authenticated account scope
resolves, the provider applies its matching cache and refreshes the preference
from the API. A device without a cache remains Light until that read completes.
Failed background reads retain the last known theme, while sign-out and account
switching reset presentation to the new account's cache or Light.
The approved dark palette is defined once in shared semantic tokens; automatic
OS-wide and Account-only dark palettes have been removed.

## Browser editing and navigation

`/account` is the full-page Profile destination, reached through the shared header
avatar on phones and desktop. It loads no group list or financial overview. Its
Back link uses the actor-scoped source visit; direct entry falls back to Groups.
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
