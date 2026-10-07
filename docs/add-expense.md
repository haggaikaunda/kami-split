# Add expense

> Historical seeded-preview evidence only. The executable preview, its routes, providers and tests were retired in #184. This document does not require their preservation or describe current production capabilities. Current behavior is documented in the [application guide](application/README.md).

Issue [#19](https://github.com/haggaikaunda/kami-split/issues/19) implements `/drafts/new-expense`. Expense editing, repayment and trip creation also use the shared session command and draft infrastructure. The form uses the shared session `DataPort` and does not move money or persist across reloads.

Defaults use the current actor, all active members, Equal, USD and the injected local date. A trip source (or explicit `trip` query) selects the trip and clamps the suggested date to its range. Dates remain editable, including dates before travel. Amounts parse to exact integer minor units; equal remainder order is by stable member ID. Exact amounts, including explicit zero shares, survive participant exclusion and switching modes. Moving from Exact to Equal asks first and retains the manual values for switching back.

Draft values and the operation ID live in the navigation session. Close, Escape and navigation preserve dirty values; the shell offers Resume or confirmed Discard, and native unload confirmation protects session changes. The same native dialog stays mounted while CSS changes between contained desktop and full-screen phone layouts, so resize does not reset values or the operation. Pending and unknown operations cannot be discarded or reset through demo controls.

`ExpenseCreationProvider` owns submissions above routes. It suppresses duplicate submission, retains a frozen command for unknown outcomes, looks up operation status before replay, and verifies the original actor/household/port after asynchronous recovery. A known precommit failure unlocks correction/retry with the same operation ID. A rejected transport promise is treated as unknown. Completed requests update the shared data query and show a View expense link. They return to the initiating (or explicitly resumed) source only while that exact visit is still active; a completion never pulls a user back from another screen. Source filters remain unchanged.

The add form stays read-only while existing data refreshes or is stale, and access failures hide financial fields while retaining the session draft. Inline blur/submission errors reference fields; the first invalid field receives focus. Reconciliation states show exact remaining/excess values and block an unbalanced save.

Verification includes pure validation/default/allocation cases and form/controller tests for focus, exact-value retention, actor changes during recovery, stale callbacks, pending duplicate suppression, unmounted completion, precommit retry and unknown completion lookup. Independent tests are kept beside the implementation. Browser verification covers the demo route separately; actual mobile soft keyboards still require target-device verification during broader journey integration.

## Recorded browser verification

Live CUA at desktop and phone sizes verified a $10.01 expense resolves to $5.01/$5.00 shares, returns to Overview with Add expense focused, updates debt to $37.18, contributions to $2,506.11/$2,630.46 and total expenses to $5,136.57, with one new activity. Exact $10.01/$0 manual shares survived excluding/reincluding a participant and a confirmed switch to Equal and back. Resizing with focus in Note preserved the field, all values and draft identity.

At an actual 320×844 viewport with a temporary verification-only selector setting root text to32px, the form dialog had318px client/scroll width; the native date input had284px client/scroll width, and the document remained320px wide. Exact values, date and actions remained readable. The selector was removed after testing.

The restored preview also passed timeout-after-commit recovery: fields/save locked, Leave preserved the operation, Resume retained the draft, and Check save status resolved the original record without a second expense or changed totals. The saved notice's View expense link opened a contextual panel showing the same $10.01 and $5.01/$5.00 allocations. This validates a committed result, not only a success toast.
