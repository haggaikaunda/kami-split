# Final UX verification (#31)

Verified 2026-09-26 against the approved mock-only UX, after recovery PR #48. The [criterion matrix](criterion-matrix.md) maps every P01–P10 / N01–N07 requirement to actual regression tests and feature-level browser evidence. This report adds a final integrated pass; it does not replace those earlier mutation, conflict, and race checks.

## Scope and reproducibility

Use Node 24 and pnpm 11. Run `pnpm build` then `pnpm start --port 4200`; open `http://127.0.0.1:4200`. The default fixture is `household-demo`, Kaunda and Mizenin, USD, with injected clock **2026-09-20**. Reload resets session data. All recorded names and amounts are synthetic. Authentication, invitations, membership, and financial writes remain session-only simulations.

Browser checks used the Codex in-app browser via CUA, with accessibility-tree inspection, keyboard interactions, visible DOM geometry, and screenshots. The prototype ran independently on port 4201 from `docs/design/prototype`, at the same seed, clock, and viewport. Both showed debt 42.18, contributions 2,496.10 / 2,630.46, annual spend 3,666.56 and September 1,914.56. The implementation preserves the approved content, green/neutral visual hierarchy, rounded cards and phone bottom navigation, with explicit simulation language and fuller accessible labels. Pixel identity is not claimed.

## Changes found by verification

- Modal headers wrap when enlarged and Close buttons do not shrink into split words.
- Trip-card keyboard focus is drawn on the unclipped card boundary.
- Entry, repayment-history, and empty-trip action links have 44px minimum height. Phone navigation has sufficient inline room for Household at 320px.
- The trip-cover scrim guarantees at least 5.98:1 white-text contrast, including when enlarged text occupies the full image. `viewport-fit=cover` enables existing safe-area padding while retaining user zoom.
- Expense allocations and empty-page headings follow their actual section levels; trip chart landmarks have distinct names.

## Automated checks

`src/components/accessibility.test.tsx` runs **24 axe-backed tests** against the real shell and providers: overview/chart table, populated and empty history, trips, trip detail/charts, entry/invitation/setup, household management, expense add/edit/detail, validation, unknown recovery, repayment/detail, and destructive confirmations. All axe rules remain enabled except color contrast, which jsdom cannot evaluate without rendering. These checks detected the heading and landmark defects above before the fixes.

The complete suite passes **319 tests in 52 files**, along with formatting, lint, type checking, and production build. Separate independent passes covered 45 requirements/regression tests and 48 accessibility/navigation/chart tests. Final exact-commit approvals and CI are recorded on the PR.

## Fresh browser acceptance

| Check                                    | Observed result                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1280×900, 768×900, 390×844, 320×844      | Document width equals viewport width. At 768 contextual expense remains a panel; resizing to 320 makes it full-page, retains the same expense/visit, and Back restores the correct source.                                                                                                                                                                                                                                                  |
| P01–P04, 390px                           | Exact 40.00 with shares 15/20 shows 5.00 remaining and disables Save; 15/25 reconciles. Switching to Equal focuses safe Keep editing confirmation. Saved Coffee together 10.01 with 5.01/5.00 once: debt 42.18→37.18, all spending 5,136.57, Kaunda paid 2,506.11. Repayment defaults 37.18; preview and result settle, spending/contributions remain unchanged. One expense event and one repayment event appear, 27 total history events. |
| P05 / N01, 1280px                        | `/history?search=Juniper&type=created` → Dinner panel → Open full page → browser Back restores both filters and `history-event-event-2` focus. Forward restores the same full-page visit with expense heading focus. A new Overview→Dinner visit has its own ID; return focuses `overview-event-event-2`, not the prior history row.                                                                                                        |
| P06 / P09, 320px                         | Direct `/expenses/2` opens full-page with Back to history. Delete initially focuses Keep expense; Escape leaves revision 1 and returns Delete focus. Confirmation of this disposable seed record produces revision-2 tombstone at the same URL, retained original allocations/history, no edit/delete actions, and heading focus after View retained expense. `/expenses/missing` shows neutral unavailable text without financial details. |
| P07 / N05, 320px                         | Keyboard Tab reaches Maui card with visible 3px external focus ring. Upcoming→Porto shows an accessible Abstract trip cover, 0.00 totals, seven selectable zero-day bars and No expenses yet. All measured visible links/buttons/selects on that screen are at least 44×44px.                                                                                                                                                               |
| N07, 320px / actual 200% text            | Root computed size 32px, not browser zoom. Expense form and trip document remain exactly 320px wide; dialog inner width/scroll width both 318px. Input/select heights 66–76px, buttons ≥66px. Long input content scrolls inside its input. Trip hero grows with its text over the continuous contrast scrim. Transport dialog title and Close wrap onto separate rows without clipping.                                                     |
| N02 / N07, dirty resize                  | At 32px root, draft amount 10.01, description and note survive 320→390×420→1280. Focus remains on Note after the height reduction; dialog height is 420 and Save bottom 387, within the viewport. Escape preserves the draft and restores Add expense focus. No save occurs.                                                                                                                                                                |
| Keyboard / accessibility-tree equivalent | Enter opens forms/charts; dialog names, field labels, split groups, statuses, exact amounts/currency/counts and heading levels are exposed. At the Transport dialog, Shift+Tab from Close wraps to Back to chart and Tab wraps back. Escape returns to the exact Transport bar/visit. Background content is excluded from the modal accessibility tree.                                                                                     |

The enlarged-text pass used a temporary development-only checkbox and CSS `html:has(#qa-text-scale:checked) { font-size: 200%; }` on `http://localhost:4202`. The helper/import were removed before the final checks and production build. No verification control ships in the app. Production and development previews were stopped before rebuilding; final production checks use the rebuilt application.

## Evidence images

- Baseline comparison: [implementation 1280](screenshots/overview-1280.png), [prototype 1280](screenshots/prototype-overview-1280.png), [implementation 390](screenshots/overview-390.png), [prototype 390](screenshots/prototype-overview-390.png).
- [Tablet 768](screenshots/overview-768.png), [settled phone](screenshots/settled-390.png), [filtered desktop panel](screenshots/filtered-panel-1280.png).
- [200% expense form](screenshots/expense-320-200-percent.png), [200% trip](screenshots/trip-320-200-percent.png), [200% chart dialog](screenshots/chart-dialog-320-200-percent.png).
- [Trip-card focus](screenshots/trip-card-focus-320.png), [default trip cover](screenshots/trip-fallback-320.png), [retained tombstone](screenshots/tombstone-320.png).

## Practical limits

This is a browser accessibility-tree and keyboard review equivalent in scope to the documented manual checks, not a claim of testing VoiceOver or TalkBack speech on hardware. Physical iOS/Android soft keyboards and notches were not available: reduced viewport height, `100dvh`, zoom-permitting viewport metadata and safe-area CSS were verified instead. The reduced-motion stylesheet disables animation, transitions, and smooth scrolling by source inspection; an OS preference was not changed. Image-error behavior has component tests and Porto's default cover was verified live; network-wide asset failure was not simulated. Production authentication, durable storage, and real payments remain outside this approved phase.
