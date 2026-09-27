# Screen flows and navigation contract

## Route map

Production routes below are recommended names, not a requirement to copy hash routing. Use the existing Next.js router and semantic links. IDs are stable opaque data identifiers. A contextual panel and a standalone page must resolve the same expense identity.

| Screen               | Prototype route         | Suggested app route                                |
| -------------------- | ----------------------- | -------------------------------------------------- |
| H01/H02              | `#home`                 | `/`                                                |
| A01                  | `#history`              | `/history`                                         |
| T01                  | `#trips`                | `/trips`                                           |
| T02/T03              | `#trips/maui`           | `/trips/[tripId]` with tab/filter state            |
| E02                  | `#expenses/2`           | `/expenses/[expenseId]`                            |
| E02 forced full page | `#expenses/2?view=full` | same identity with explicit full-page presentation |
| U01                  | `#auth`                 | `/sign-in`                                         |
| U02                  | `#household`            | `/household`                                       |

New/edit forms can be router-aware dialogs or nested routes. The observable history and draft behavior below is binding; exact route syntax for forms is left to the shell issue. Shareable URLs must not contain notes, email addresses or financial draft contents. Filter state may use query parameters when appropriate, but no sensitive draft data in the URL.

## N01: Contextual expense entry and Back/Forward

1. Capture a serializable source descriptor: source route, history entry identity, filter/sort values, trip tab, chart period/mode/scope/drill-down selection, scroll position and logical focus target.
2. Desktop contextual entry opens a right-side panel over the retained working surface and pushes one expense detail history entry. Phone entry navigates to a full detail page. Direct/deep link entry is a full page at every width; do not manufacture a fake originating list.
3. Panel Close/Escape and detail Back return to the captured source. Browser Back has equivalent behavior. Forward reopens the same record and restores the correct presentation/context for that history entry.
4. “Open full page” changes presentation using replace semantics: one Back returns to the origin, not to an intermediate panel. Resizing does not add history entries.
5. Re-entering the same expense from a different source must remember each visit independently; never use a single global origin per expense ID.
6. Restore filters/tab/period before scroll. Requery data after mutations rather than restoring serialized HTML. Focus the logical source row; if deleted/filtered out, focus the list heading or nearest surviving item with a clear announcement.
7. If the user has no valid source entry, use a safe explicit Back to history link; never navigate outside the app by guessing browser history depth.

## N02: Add expense from multiple sources

Overview/History → Add expense uses standard defaults. Trip → Add expense preselects trip and suggested date. Source filters and scroll remain recoverable even when the new expense does not match the filter. Cancel clean form returns unchanged. Dirty cancel, Escape, browser Back, navigation links, resize transitions that would remount, and reload/close must preserve or explicitly confirm discard; native before-unload restrictions are acceptable for actual page unload.

Successful save closes once and returns to the source with current totals/activity and a concise success announcement. Keep filters; if the record is hidden by them, offer View expense instead of silently clearing filters. Pending requests cannot be submitted twice. Do not lose an in-flight operation or report success on an unknown outcome.

## N03: Detail, edit and deletion

Detail → Edit keeps expense identity and return context. Cancel returns to unchanged detail; successful save returns to the same panel/full-page presentation with current revision, allocations and activity. Validation/conflict/error stays in the form with draft intact. Refreshing a seeded detail URL shows that fixture; session-created records may be unavailable after a deliberately documented reset.

Detail → Delete confirmation → Keep expense returns to the same detail without a new history entry. Confirm → tombstone at the same URL, with audit information and mutation actions removed. Back returns to a refreshed originating list/chart, where deletion activity is visible but spending totals exclude the expense. If the record was concurrently deleted, explain this and do not recreate it from a stale draft.

## N04: Chart drill-down chain

Overview → select mode/scope/period → bar → contributing-records view → expense detail → Edit/Delete → Back → **the same selected chart bucket**, freshly calculated. Preserve empty drill-down when editing moves the last expense out of the selected bucket. Closing drill-down returns to the same chart period/scope and focuses the originating bar. A data-table alternative must lead to equivalent inspection. Forward and repeated visits must not swap source contexts.

## N05: Trip chain

Trips list filter → trip → Overview/Expenses tab → expense search/category filter → record → Back restores trip tab/filter/scroll. Expense's trip link navigates to the associated trip; browser Back returns to the expense rather than a random household screen. Create trip → new trip overview with empty state. Date filter/status changes use an injected clock so Upcoming/In progress/Past can be verified deterministically. Trip repayment action is explicitly household-scoped and returns to the initiating trip after save/cancel.

## N06: Repayment and account transitions

Overview or trip → repayment form → live preview → save → same source with updated balance/history. Cancellation preserves source. Read-only repayment detail from History closes back to the same list context; this phase does not require a separate repayment detail route.

Simulated sign-in → sent → first-time setup or invited-household acceptance → selected household. Wrong-account/expired/revoked invitation → appropriate retry/switch-account/ask-owner state. An unavailable financial record never leaks its former details. Account-state changes revalidate adapter access before resuming a retained draft.

## N07: Responsive and keyboard behavior

At <=760px detail is full-page; financial forms fill the viewport. At desktop width contextual detail is a panel; direct and explicitly full-page entry stay full-page. Resizing an open form must not reset fields, allocations, request ID or focus. Resizing a detail retains record and originating context. Panel/dialog focus is contained, detail heading gets route focus, and closing restores a logical trigger. Escape closes only the topmost layer and never bypasses dirty confirmation. Confirmation dialogs focus the non-destructive action initially.

## Verification matrix

For N01–N07 exercise 390px phone and 1280px desktop, keyboard-only entry, Back/Forward, direct navigation and repeat visits to the same ID from different sources. At least one 320px/200% text check and one resize during dirty editing are required. Test source restoration after data changes, not only read-only round trips. Record deterministic expectations and browser evidence in the implementation PR; see [prototype-verification.md](prototype-verification.md).
