# Tonal migration verification

Issue [#223](https://github.com/haggaikaunda/kami-split/issues/223), implementation
[PR #225](https://github.com/haggaikaunda/kami-split/pull/225).
These are production-build captures with **synthetic test identities and financial
values**, not reference mockups or production user data. Very large amounts and
long names intentionally exercise wrapping. Browser fixtures prove presentation
and client interaction; real restricted-role API/database tests separately prove
authorization and persisted financial behavior.

## Acceptance and parity evidence

The pre-implementation inventories remain the action/state index:
[workspaces](../material-parity-workspaces.md),
[foundation](../material-parity-foundation.md),
[expenses](../material-parity-expenses.md),
[read model](../material-parity-read-model.md).

| Criteria  | Retained/new behavior and verification                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1–A4     | Central semantic tokens, shared tonal primitives, category/navigation colors, pale Light cards and white Dark money. `appearance-palette.test.ts` computes actual token contrast; material browser checks computed legend contrast through the CSS cascade.                                                                                                                                                                                                                                         |
| A5        | Original Household/Trip PNG artwork, theme overlay and responsive crop; overview screenshots below and browser width matrix.                                                                                                                                                                                                                                                                                                                                                                        |
| A6        | Existing account-bound Light/System/Dark persistence/prepaint/sign-out lifecycle. Appearance component tests and `appearance-browser.cjs`: explicit save, OS changes only in System, reload/focus/error/reconciliation, disposal.                                                                                                                                                                                                                                                                   |
| B1, B5    | Original four destinations and five workspace tabs; discovery/create, loading, unavailable, denied and source-return semantics remain. Navigation/lifecycle tests; browser normal and doubled text at narrow widths.                                                                                                                                                                                                                                                                                |
| B2–B3     | Three ordered overview cards, complete viewer paid/share excluding repayments, net includes repayments. Workspace summary test and real `material_totals_integration_test.go` plus dashboard tests. No partial-page derivation.                                                                                                                                                                                                                                                                     |
| B4        | Desktop overview balances panel; mobile omits it and keeps dedicated Balances. `navigation-browser.cjs` checks computed visibility and canonical destinations.                                                                                                                                                                                                                                                                                                                                      |
| C1–C3, C7 | Desktop native modal with full-viewport scrim; mobile full screen with heading/Back; same mounted editor across resize. Presentation/overview/ledger tests and material browser outside-header click, inside click, Escape, close, focus, history/direct fallback and layout checks.                                                                                                                                                                                                                |
| C4–C6     | Original Equal/Exact/Percentage fields, participant/payer validation, zero allocations, durable drafts/frozen operations, expectedVersion/revisions/conflicts/locks. Existing editor/recovery/domain/integration tests retained; added overview Back/Forward and committed-save/failed-refresh regressions. Browser draft resize/dismiss/reopen/discard verifies no mutation. Real edit browser verifies persisted save/history in aggregate, original Household, ordinary Group and Trip contexts. |
| D1–D5     | All five AND filters, payer-or-explicit-allocation including zero, dates, source/member incompatibility, active chips and draft Reset/Apply. Existing structured ledger/filter and cross-space restricted-role tests; URL/back/paging/drilldown browser checks.                                                                                                                                                                                                                                     |
| E1–E2     | Secondary URL-backed List/Breakdown and basis, constant-radius/thickness category geometry, subtle selected translation and stable category identity. `breakdown.test.tsx`, ledger tests, material browser.                                                                                                                                                                                                                                                                                         |
| E3–E5     | Complete anchored filtered category/allocated/payer sums, textual amounts/counts/percentages, zero/empty/single/tiny/large cases, keyboard legend/drilldown. Checked int64/bigint until final bounded geometry. Real aggregate tests use a page smaller than the dataset, repayment exclusion and old-anchor/fresh-edit comparison; overflow fails the whole read.                                                                                                                                  |
| F1–F4     | Compact Profile/Appearance/Session, read-only email, unchanged guarded separate saves, profile conflict/check/discard and real session cleanup. Profile/onboarding/appearance suites plus account browser width/text and real API profile coverage.                                                                                                                                                                                                                                                 |

## Captures

- Household [Light](household-light.png), [Dark](household-dark.png),
  [phone](household-phone.png); [Trip tablet](trip-tablet.png),
  [ordinary Group phone](ordinary-group-phone.png).
- [Groups](groups-dark.png), [Trips](trips-dark.png),
  [Balances](balances-dark.png), [Activity](activity-dark.png),
  [Members](members-dark.png), [Invitations](invitations-dark.png).
- Expense [desktop filters](filters-desktop.png), [desktop detail](detail-desktop.png), [mobile detail](detail-phone.png),
  [mobile Breakdown](breakdown-phone.png),
  [recovered edit](expense-edit-desktop.png).
- Disposable real API: [persisted expense detail](real-expense-detail.png),
  [persisted repayment detail](real-repayment-detail.png).
- [Account](account-dark.png), [loading](account-loading.png),
  [failure](account-error.png).

## Observed verification

Implementation `93e4bec` passed 335 web tests, formatting/lint/type/build and
independent server/expense tests. Appearance and Account captures use that build;
those surfaces are unchanged by the later expense-specific corrections.
Implementation `6d40a1c` also passed 335 tests and the full sequential web checks,
Relay drift, `make api-check` (regular/race/vet/build/gqlgen) and sqlc drift.
Shipped query maximum is 198 against the unchanged 200 budget. The restored
overview edge cursor preserves the existing real wire-contract test.

Fresh material captures use `6d40a1c`. Browser-computed legend secondary text
contrast is 5.57:1 unselected / 5.70:1 selected in Light, and 8.92:1 / 8.07:1 in
Dark. Mobile detail viewport captures assert top=0 and height=viewport; full-page
screenshots of a scrolled native dialog can otherwise misleadingly include inert
background content. Draft recovery captures demonstrate retained fields without
submitting a mutation. Final database/browser reports and exact-head independent
signoffs are recorded on the PR after completion.

## Reproduction and evidence boundaries

Use Node 24 and pnpm 11.25.0. Run Relay drift, formatting, lint, type checking,
tests and build sequentially; stop the preview before rebuilding. Run
`make api-check`, `make db-generation-check`, `make db-test`. Browser scripts
accept `PLAYWRIGHT_MODULE`, `CHROME_PATH`, `PORT`, `OUTPUT_DIR` and
`TESTED_COMMIT`; see the [navigation guide](../../navigation/workspace-loading.md).
`material-browser.cjs` runs 320/390/768/1280/1440px, Light/Dark, doubled root text
at 320/1280, reduced motion, navigation/detail/filter/chart checks. The delivery
also used the machine's actual LAN HTTP origin. `appearance-browser.cjs` checks
System transitions and persisted theme behavior; `account-browser.cjs` checks
four widths at normal/doubled text. Set `EDIT_BROWSER_ORIGIN` and
`EDIT_PLAYWRIGHT_MODULE` for `make db-test` to run the opt-in production-web
journey against disposable authenticated real API fixtures. Its Auth transport
is fixture-local; it does not claim hosted-provider login verification.

Physical phone hardware, spoken assistive technology and hosted provider
rehearsal were not performed. The actual tested commits, command outcomes,
independent testing/review and remaining CI/merge gates are recorded on PR #225.
GitHub initially refused to start required CI because of account billing or
spending limits; local passing checks do not bypass that gate. Issue #223 remains
open until all required checks, actual merge and canonical closeout are complete.
