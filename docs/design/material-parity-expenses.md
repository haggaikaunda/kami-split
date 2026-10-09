# Expense parity inventory for #223

Inventory captured before runtime edits from the implementation checkout at the
coordinator's recorded `origin/main` baseline. Current production contracts take
precedence over the sample reference. Read the commit-pinned reference README,
its extracted walkthrough, current ledger/edit/percentage guides and component tests.

| Current entry/action/state                                  | Retained entry and behavior                                                                                                                   | Verification evidence target                                |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Household `/household/expenses`; Group/Trip `?tab=expenses` | Same authorized ledger, ordered months, complete server totals/counts, anchored Load more                                                     | Existing ledger independent tests; aggregate API tests      |
| Five URL filters: groupId/category/memberId/from/to         | Draft Reset/Apply; AND filtering; original Membership ID; chips remove individual criteria; List/Breakdown share URL                          | Ledger tests; original filter authorization tests           |
| Expense row `?expense=&expenseGroup=`                       | Desktop viewport drawer/mobile full screen; Back, direct-entry fallback, preserved mounted traversal and scroll/focus                         | Presentation tests; ledger navigation tests; browser matrix |
| Overview recent expense and direct expense routes           | Same authorized expense, shared responsive presentation wired by workspace owner                                                              | Workspace tests and browser matrix                          |
| Add expense/source choice                                   | Existing ExpenseForm with Equal/Exact/Percentage, explicit zero and payer independent from creator/participants                               | Existing form/percentage/recovery tests                     |
| Detail/Edit/Recover expense edit                            | Existing ExpenseDetail/ExpenseEdit; retained category/date/note/payer/splits/audit; original actor/source/expense/operation drafts            | Existing edit/detail tests; dismissal and reopen tests      |
| Save/conflict/lock/unknown result/no-op                     | Existing guarded mutations, expectedVersion, frozen attempt and original-key recovery; no presentation-triggered mutations                    | Existing edit/recovery/server tests                         |
| Loading/error/denial/stale refresh/account replacement      | Existing fail-closed scope/contextVersion, cancellation and unavailable states; never fabricated zero                                         | Existing independent ledger/lifecycle tests                 |
| New category Breakdown                                      | Complete server authorized/anchored category amounts, viewer share/paid and count; exact text and bounded chart geometry; category drill-down | New breakdown tests; complete API dataset beyond one page   |

Evidence rows are targets until executed; the delivery evidence records actual
commands, browser results, tested head and limitations. No historical seeded
runtime, unsupported search/status/delete, or financial write policy is added.

## Builder verification

The implementation retains `ExpenseForm`, `ExpenseEdit`, and `ExpenseDetail`
mutation/recovery ownership. The presentation only changes visibility and focus;
its cleanup never mutates or clears a draft. Expense List/Breakdown/basis are URL
state (`view=breakdown`, `basis=share`); view-only transitions retain the mounted
ledger and loaded pages. Category drill-down changes only category/view, retaining
other criteria. Aggregate values come only from `ExpenseView`, never its edges.

Focused checks executed in the shared implementation checkout: 36 tests passed
across all expense components and the existing expense-detail/edit suites. New
checks cover exact large ratios, tiny slices, zero-share counts, complete category
amounts beyond loaded rows, retained drill-down filters, single-chip removal,
backdrop versus inside gestures, focus/scroll-lock cleanup and mounted draft
preservation across resize. Focused ESLint passed. These are jsdom/unit checks;
parent delivery browser evidence remains necessary for native modal inertness,
viewport scrim behavior, mobile focus/layout, real data and all requested widths.
