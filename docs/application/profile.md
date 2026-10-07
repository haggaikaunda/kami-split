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

## Browser editing and navigation

`/account` is a personal destination inside the existing shared navigation; it
loads no group list or financial overview. Profile loading and failure leave
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

See [rendered browser evidence](account-browser-evidence.md) for before/after
images and acceptance coverage. Successful explicit local sign-out replaces the
route with `/sign-in` after private state cleanup; invitation Switch account
retains its separate continuation.
