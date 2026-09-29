# Household setup and membership preview

## Accepted production policy

This page preserves issue #29’s seeded UX evidence. [ADR-003](../application/decisions/003-bootstrap-groups-and-invitations.md) instead specifies administrative first-account bootstrap into an empty USD Household, separate verified-email invitations, and exactly one active owner. The preview’s pending `Member` records, first-household screen and role toggles are not the production schema or transfer workflow. Operational bootstrap is #81; ownership transfer is low-priority deferred #84. Membership/profile visibility and returning-member behavior are separately tracked through #75/#79.

## Seeded preview

Issue #29 completes the first-household handoff from the sign-in preview. Setup validates a name, fixes the only enabled default currency to USD, and creates an actually empty dataset with one owner and a distinct household identity. A successful, freshly read setup selects that identity, clears previous sample drafts and advances the app session epoch. Validation failures do not discard drafts. Pending/unknown commands block setup and simulation reset. Unknown setup responses are checked using the original entry transition; stale responses after a source change or route unmount cannot redirect or overwrite the current scope.

Household owners can rename the household, invite a made-up member name, resend/revoke pending invitations, change roles and remove access. Ordinary members can only preview leaving their own household. The adapter enforces these permissions. Invitations retain a deterministic ID and send count; acceptance binds the identity shown in the preview and activates that pending member once. No email address or delivery is required.

The last active owner cannot leave or be demoted until another active member becomes an owner. Removal is blocked by outstanding net balances or direct obligations in each supported currency, including a net-zero intermediary who still owes/is owed by different people. Removal sets status inactive, retaining IDs, names, expense snapshots and audit attribution. Existing expense currencies are never changed.

Membership commands use frozen operation identities, serialize duplicate clicks, and retain unknown results above routes. One narrow receipt exception prevents an uncertain self-removal from becoming unrecoverable: the same still-signed-in simulated actor may look up only their own completed self-removal result. The receipt contains that member's nonfinancial fields. It does not grant household reads, financial operation receipts, commands, or another actor's receipts. Denied/expired entry and different/reset household scopes still deny access. Recovery of this receipt never retries a write without a ready authorized context.

All of these are session-only domain/UI simulations. There is no real identity provider, invitation email, database, persistent membership, or production authorization guarantee. Adapter and UI tests exercise setup/scoping, roles, invitations, stale completions, duplicate and unknown outcomes, last-owner/balance guards, and preserved attribution. Independent review and browser acceptance are recorded in the PR.

## Independent acceptance

Three independent adapter probes verify delayed invitations recheck owner authority, concurrent demotions preserve at least one active owner, and a departed actor's self-removal receipt contains only their member fields while financial reads/receipts and old household scopes remain denied.

Browser verification on 2026-09-26 passed at 1280px, 390px and 320px. Outstanding-balance removal is blocked; the removal confirmation initially focuses its safe action. Creating and resending Sam Preview's invitation keeps one pending identity with send count 2; the entry screen names that same identity, and acceptance makes it an active ordinary member without owner controls. A last-owner departure is blocked with an ownership-transfer explanation. The document fits 390px and 320px exactly.

Retesting the final setup corrections confirmed blank submission focuses Household name. Completing the first-household flow with Coast House automatically opens `/household` with heading focus and only its owner. Overview shows that distinct household with zero spending, no expenses and no activity; prior sample members are absent. The setup callback runs before the expected session-provider remount, while lifetime/scope guards still reject genuine stale completions. Delayed membership responses and self-removal receipts cannot complete into a replacement port or selected household.
