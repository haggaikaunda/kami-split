# Shared UI primitive examples

Issue [#16](https://github.com/haggaikaunda/kami-split/issues/16). This standalone development gallery exercises controls and states without adding application routes or implying that example buttons persist records.

Run `pnpm --package=vite@8.3.0 dlx vite docs/primitives-preview --host 127.0.0.1 --port 4210`, then open `http://127.0.0.1:4210`. This fetches the pinned development server (matching the lockfile’s Vite version) into pnpm’s tool cache. Vite is a transitive Vitest dependency, so a clean install does not expose it through `pnpm exec vite`; the explicit command adds no application runtime dependency. Use the labeled **Example text size** selector to switch between 100% and 200% root text size directly in the gallery. No application runtime dependency was added; jsdom is a development dependency for component interaction tests.

## Contract

- `Field` / `SelectField` provide visible labels and combine caller descriptions, hints and inline errors. Pass `inputMode="decimal"` for money, `type="date"` for dates, and stable member IDs as select values. `ErrorSummary` focuses the first invalid field when its first field changes; its links also focus the matching control.
- `Button` defaults to `type="button"`. Forms explicitly opt into submit. Pending disables repeat activation; operation IDs and mutation correctness belong to the adapter.
- `Money` accepts exact domain-formatted text and a visible currency. It performs no arithmetic or rounding. `ChartTable` likewise preserves exact text; its magnitude controls geometry only. Pass values and magnitudes from the same domain record. The table is equivalent to the bars, and zero bars remain selectable.
- `Dialog` uses the native modal top layer with an explicit Tab/Shift+Tab edge loop. It initially focuses its heading, or a supplied initial focus ref. Escape requests controlled closure. Cleanup restores a supplied surviving return target, the original trigger, or the surviving main/body fallback. Confirmation defaults to its safe action. Consumers own dirty-draft and pending-operation policy.
- Dialogs become full-screen below 760px; panels align to the right on larger screens. Phone padding respects safe areas and content scrolls inside the viewport. On-screen keyboards must still be checked during journey integration on target mobile devices.
- `Member` uses initials on missing or failed photos. Production #237 uses system fonts; the historical #227 baseline bundled Roboto through `next/font/local`. The standalone gallery retains legacy Manrope/DM Sans `@font-face` declarations; it does not run the Next font loader or establish production typography parity. No visitor request goes to a font provider.
- Status labels explicitly distinguish pending, error, stale and unavailable states; color is supplementary. Skeletons announce loading without fabricated financial values. Toasts announce feedback, but are not proof of a mutation.

## Verification

Run the component suite and inspect the gallery at narrow widths, doubled text and keyboard focus. The gallery does not prove authentication, transport, persistence or complete journeys. Publish screenshots and results on the delivery PR, using ignored `test-results/` or temporary output directories.

## Quietly Warm workspace patterns (#167)

The gallery demonstrates the shared patterns for the [redesign tracker #166](https://github.com/haggaikaunda/kami-split/issues/166). Layout separators use `--color-separator`; interactive controls retain the stronger `--color-border`. Static surfaces have no elevation. Positive balances use forest/sage, negative balances use clay, and destructive red remains for failures/destructive actions.

`WorkspaceHeader` supplies people/space context. `WorkspaceTabs` uses the same Overview, Expenses, Balances, Activity, Members route links for Household and Trip/Group, with `aria-current`; these are navigation links rather than in-page ARIA tabs. Callers supply authorized routes. `SummaryMetric` and `SignedBalanceMetric` preserve exact money text and explicit owed/owe/settled labels. Use `ui-summary-row` for two equal-width horizontal metrics even at 320px and doubled text. The Household aggregate must supply its informational/open-space explanation: `scope="household"` labels zero as “Net zero across spaces” rather than “Settled”; a zero aggregate does not establish settlement.

`ExpenseRow`, `MonthSection`, `FilterBar`, and `SpaceChip` provide ledger structure without enclosing every record in a card. `BalanceSpaceRow` and `MemberBalanceRow` explain source/member positions. `RecommendedRepaymentRow` requires group, sender, recipient and exact amount context; callers own authorized settlement entry. Summary components expose no settlement action. Existing `Dialog panel` provides a desktop side panel and mobile full-page detail with the same focus and safe-area behavior.

These components do not introduce production reads, routes, categories, or mutations. Production integration lives in the current Group/Trip/Household workspaces. Existing loading, empty, unavailable, pending, error, focus/hover, exact large money, long names, and 200% text examples remain available.
