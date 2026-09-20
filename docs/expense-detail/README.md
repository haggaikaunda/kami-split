# Expense detail

Issue #20 renders the same current expense and immutable revision history in the shell's contextual desktop panel or full-page destination. It consumes the session `AppDataProvider` snapshot through the replaceable async data port. It never imports fixture arrays into screen code.

`/expenses/:id` is a direct full page. `?revision=N` identifies a selected audit snapshot while the current revision or deletion state remains explicit. `ExpenseLink` accepts an optional numeric `revision`; ordinary activation captures a fresh visit, while modified activation retains a canonical shareable URL. “Open full page” preserves the selected revision and visit using replace semantics.

Every revision has complete comparable values: description, amount/currency, expense date, payer, explicit participants and allocations (including zero), split, category, trip association, note, original creator, creation/update timestamps, editor and reason. Audit timestamps are displayed in UTC; expense dates are date-only. Deleted records remain readable and excluded from mutation intent hooks. Unavailable IDs disclose no record fields.

`ExpenseDestination.renderActions(record)` is an integration hook for subsequent editing/deletion issues. It is called only for current, loaded, non-deleted records. Until those journeys are connected, no misleading mutation buttons are rendered. Stale/offline values are explicitly labeled and cannot expose mutation actions. Denied/expired states suppress financial values even if an outdated snapshot is present.

## Verification

Component tests exercise actual adapter-created exact allocations, edits, different actors and tombstones. Independent requirements tests check complete selected snapshots, changed current values, identity-based labels, zero shares, unavailable trip association, literal note rendering, revision-aware navigation, and native summary keyboard ordering within dialogs.

Destination tests cover initial loading, missing records, denied/expired/unavailable/error states, retained offline values and retry, mutation-hook suppression, selected-revision full-page replacement, and modified-click canonical links. The shell's existing tests continue to verify per-visit origins, responsive boundaries, Back/Forward and freshness barriers.

Live browser results are recorded below after integration. The UI is a session-only simulation: reload restores fixtures and session-created IDs can become unavailable. This is not real authentication or durable audit storage.
