# Shared UI primitive examples

Issue [#16](https://github.com/haggaikaunda/kami-split/issues/16). This standalone development gallery exercises controls and states without adding application routes or implying that example buttons persist records.

Run `pnpm --package=vite@8.3.0 dlx vite docs/primitives-preview --host 127.0.0.1 --port 4210`, then open `http://127.0.0.1:4210`. This fetches the pinned development server (matching the lockfile’s Vite version) into pnpm’s tool cache. Vite is a transitive Vitest dependency, so a clean install does not expose it through `pnpm exec vite`; the explicit command adds no application runtime dependency. Use the labeled **Example text size** selector to switch between 100% and 200% root text size directly in the gallery. No application runtime dependency was added; jsdom is a development dependency for component interaction tests.

## Contract

- `Field` / `SelectField` provide visible labels and combine caller descriptions, hints and inline errors. Pass `inputMode="decimal"` for money, `type="date"` for dates, and stable member IDs as select values. `ErrorSummary` focuses the first invalid field when its first field changes; its links also focus the matching control.
- `Button` defaults to `type="button"`. Forms explicitly opt into submit. Pending disables repeat activation; operation IDs and mutation correctness belong to the adapter.
- `Money` accepts exact domain-formatted text and a visible currency. It performs no arithmetic or rounding. `ChartTable` likewise preserves exact text; its magnitude controls geometry only. Pass values and magnitudes from the same domain record. The table is equivalent to the bars, and zero bars remain selectable.
- `Dialog` uses the native modal top layer with an explicit Tab/Shift+Tab edge loop. It initially focuses its heading, or a supplied initial focus ref. Escape requests controlled closure. Cleanup restores a supplied surviving return target, the original trigger, or the surviving main/body fallback. Confirmation defaults to its safe action. Consumers own dirty-draft and pending-operation policy.
- Dialogs become full-screen below 760px; panels align to the right on larger screens. Phone padding respects safe areas and content scrolls inside the viewport. On-screen keyboards must still be checked during journey integration on target mobile devices.
- `Member` uses initials on missing or failed photos. Manrope and DM Sans variable fonts are bundled with their SIL Open Font Licenses. The application uses `next/font/local` with swap display and system fallbacks; the standalone gallery loads the same files with `@font-face`. No visitor request goes to a font provider.
- Status labels explicitly distinguish pending, error, stale and unavailable states; color is supplementary. Skeletons announce loading without fabricated financial values. Toasts announce feedback, but are not proof of a mutation.

## Verification recorded September 20, 2026

Component interaction tests cover field/error associations, summary focus, duplicate pending clicks, dialog naming/Escape/Tab wrapping, safe confirmation focus, trigger removal and focus restoration, failed photos, zero-period selection, and exact chart/table text.

Headless installed Chrome rendered 320px, 390px and 1280px at both 100% and 200% root text size. All six combinations had document width equal to viewport width; visible buttons/fields were at least 44px and had no internal content overflow. Exact tables use a labeled, keyboard-focusable scrolling region at narrow sizes. Screenshots were inspected for readable content, wrapping, and usable fallback typography/photos:

- [320px at 200% text](screenshots/320-200-percent.png)
- [390px](screenshots/390.png)
- [1280px](screenshots/1280.png)
- [390px dialog / keyboard focus](screenshots/dialog-390.png)

In Chrome, twelve successive Tab and Shift+Tab presses each remained inside the dialog; Escape closed it and restored the opening button. Confirmation focused Keep editing. The intentionally missing photo showed AM initials.

Manual token review with WCAG relative-luminance calculations: ink/white 13.42:1, muted/white 6.29:1, white/primary 7.92:1, white/destructive 7.52:1, error/error-surface 6.78:1, focus/white 6.41:1, control-border/white 3.10:1. Disabled controls remain semantically disabled. Screenshots exercise the system-font fallback without a font service and a failed photo request.

The gallery does not cover authentication, transport, concurrency, persistence, or complete journeys. The implemented application journeys have separate feature tests and the [integrated accessibility report](../accessibility/README.md); this gallery remains a standalone primitive demonstration.

## Quietly Warm workspace patterns (#167)

The gallery demonstrates the shared patterns for the [redesign tracker #166](https://github.com/haggaikaunda/kami-split/issues/166). Layout separators use `--color-separator`; interactive controls retain the stronger `--color-border`. Static surfaces have no elevation. Positive balances use forest/sage, negative balances use clay, and destructive red remains for failures/destructive actions.

`WorkspaceHeader` supplies people/space context. `WorkspaceTabs` uses the same Overview, Expenses, Balances, Activity, Members route links for Household and Trip/Group, with `aria-current`; these are navigation links rather than in-page ARIA tabs. Callers supply authorized routes. `SummaryMetric` and `SignedBalanceMetric` preserve exact money text and explicit owed/owe/settled labels. Use `ui-summary-row` for two equal-width horizontal metrics even at 320px and doubled text. The Household aggregate must supply its informational/open-space explanation: `scope="household"` labels zero as “Net zero across spaces” rather than “Settled”; a zero aggregate does not establish settlement.

`ExpenseRow`, `MonthSection`, `FilterBar`, and `SpaceChip` provide ledger structure without enclosing every record in a card. `BalanceSpaceRow` and `MemberBalanceRow` explain source/member positions. `RecommendedRepaymentRow` requires group, sender, recipient and exact amount context; callers own authorized settlement entry. Summary components expose no settlement action. Existing `Dialog panel` provides a desktop side panel and mobile full-page detail with the same focus and safe-area behavior.

These components do not introduce production reads, routes, categories, or mutations. Integration belongs to the child workspace issues. Existing loading, empty, unavailable, pending, error, focus/hover, exact large money, long names, and 200% text examples remain available.

### Verification for #167

Builder browser pass on October 4, 2026, in the Codex in-app browser at `http://127.0.0.1:4210`: 320/390/768/1280px had viewport-width document reflow and two summary cells with identical vertical origins. At 320px and 200% root text with the long Trip name, the metrics remained horizontal and document width remained 320px. Navigation uses contained horizontal scrolling. Rendered buttons, fields, and workspace links met 44px minimum height. The 320px detail occupied the full 320×900 viewport; at 1280px it occupied the rightmost 608px. Tab/Shift+Tab wrapped, Escape closed the detail, and Add expense regained focus. Keyboard focus was visibly blue. Reduced-motion and safe-area CSS were inspected; physical mobile keyboards, spoken assistive technology, and OS motion emulation were not exercised.

Bundled font sources: [Manrope](https://github.com/google/fonts/tree/main/ofl/manrope) and [DM Sans](https://github.com/google/fonts/tree/main/ofl/dmsans), each retaining its upstream OFL license in `apps/web/src/app/fonts`. The production Next build packages both font assets locally.
