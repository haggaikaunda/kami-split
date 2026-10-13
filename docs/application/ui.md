# Shared UI behavior

Kami Grow uses shared semantic tokens, system fonts and accessible primitives. Global tokens/themes live in `apps/web/src/app/tokens.css`; intentional document defaults live in `base.css`. Components own their presentation in colocated styles; original visual references are indexed in the [design guide](../design/README.md). Approved sample data and screenshots are not financial authority.

## Shared ownership and composition

Import neutral controls, fields, members, modal dialogs and feedback from `components/ui/primitives`. These components have no expense or server-data dependency. `components/workspace/patterns` owns workspace headers, route navigation, source chips and privacy copy; `components/workspace/shell.module.css` owns application chrome and content width. `components/financial/presentation` owns exact formatted money, summary metrics, charts and financial rows. Financial components accept ordinary props and never parse formatted amounts or fetch data.

Shared component styles use colocated CSS Modules. Keep base styles, variants, interaction states and responsive rules with the owning component. The root layout anchors the four shared module imports in their existing order; components import those same deduplicated sheets. Import the component before a caller's customization stylesheet, and preserve the root order when moving dependencies so Next's production chunks retain the established cascade. A caller may compose exported layout classes for its own elements, such as `actions` or `summary-row`; component internals remain private.

Existing cross-component customization uses explicit `data-ui` styling slots. The attribute is a whitespace-separated set of slot and variant names, independent of generated CSS Module class names. Use the smallest owning feature selector plus the required slot; do not select private class names or infer internal markup from tags. Current contracts are:

| Owner                  | Public styling slots                                                                                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neutral UI             | `button` and `button--<tone>`; `field`, `field-label`, `field-control`, `hint`, `error`; `member`, `avatar`, `member-copy`, `member-name`, `member-detail`; `status`, `loading`, `skeleton`, `icon`                                                         |
| Workspace              | `workspace-header` and its appearance/compact variants, `workspace-context`, `banner-action`, `space-chip`; shell `workspace-brand`, `workspace-content` and navigation parts                                                                               |
| Financial presentation | `money`, `money--long`, `money-value`, `currency`; `summary-row`, `summary-metric` and tone variants, `metric-heading`, `metric-icon`, `metric-label`, `metric-value`, `metric-detail`; `signed-balance` and position variants, `balance-row`, `row-detail` |

For example, Account customizes `field-label` and `field-control` while Field continues to own labeling, errors and descriptions. Member layouts customize `member-copy` and `member-name` instead of depending on a last-child span or a nested `strong`. Prefer an existing component variant or root `className` for new consumers; extend this slot contract only when a real consumer needs a distinct layout. Slots do not transfer behavior or financial ownership to CSS.

## Tokens and responsive rules

`tokens.css` owns Light defaults and the explicit Dark override. Color roles distinguish document canvas, surfaces, separators, interactive borders, text, actions, exact-balance positions, category geometry, banners and summary metrics. Keep positive/negative financial presentation separate from destructive/error colors. The system font stack owns both body and display text; tabular numerals belong to money. Spacing tokens cover repeated gaps; control/card radii, minimum target size, focus ring and panel shadow describe their own roles. A matching literal value alone is not a reason to merge roles. Unused aliases are removed only after checking production styles, dynamic use, palette tests and the executable gallery.

Use viewport queries for application chrome and modal presentation, and container queries for the width available to ledger rows, charts or panel contents. Preserve content-specific thresholds: the shell and expense presentation change at 600 CSS pixels (matching their JavaScript measurements), generic Dialog changes between 759/760px, and ledger rows use the `workspace` container at 48em with a 16em fallback. `rem`/`em` support enlarged text where the existing layout intends it; retain approved fixed pixel values when they encode artwork, geometry or target sizes. Do not normalize every breakpoint to one value.

Safe-area padding remains with the owning shell/dialog. The expense presentation follows the unscaled visual viewport for the keyboard, keeps one mounted form, and releases sticky actions for a short viewport or enlarged text. The document remains the scroll owner for source restoration. Shared CSS does not create a second scroll container or replace that navigation contract.

## Appearance and navigation

Light, System and Dark are private account preferences. A selection applies immediately and saves in the background with serialized, guarded writes; uncertainty requires a fresh read before retry. Only System follows the OS. See [profile/appearance](profile.md) for cache isolation and conflict handling.

Persistent navigation links Household, Groups, Trips and Account. Desktop uses the shared rail/app bar and constrained content widths; phones retain reachable bottom navigation and safe areas. Workspace links are Overview, Expenses, Balances, Activity and Members. They are route links, not ARIA tabs. Account settings use the same shared navigation.

## Workspaces and expenses

The illustrated workspace banner retains source identity, readable overlays and the authorized Add expense action across tabs. Original Household ledger access remains distinct from the cross-space Household summary. Do not invent a source for a write. Current summaries use complete server totals; visible or loaded rows cannot establish totals or settlement.

Expense lists use compact rows with payer at left and amount at right, description/category context, and counts below month/year headings. Filters sit beside List/Breakdown. Structured filters combine scope, category, dates, Involving and Paid by; exact date/amount sorting, incremental scrolling, and authorized source restoration preserve URL state. Breakdown's Spending by category retains the server's complete dataset. See [ledger behavior](expenses-ledger.md).

Creation/editing preserves exact Equal, Exact and Percentage intent, dirty drafts and frozen recovery attempts. The responsive form/detail presentation keeps actions reachable with long content and larger text. Activity distinguishes original creation, later edits and repayments, with immutable before/after facts.

## Balances, help and refresh

Balance copy distinguishes what a person owes/is owed from expense spending. Repayments record transfers without moving money and never affect spending totals. Household net zero can contain offsetting source balances; retain the explicit warning and original-space explanation. Every individual must be zero within a source group for that group to be settled. Failed or incomplete reads cannot imply zero.

Rich help is anchored and keyboard accessible with explicit dismissal, focus restoration and viewport bounds. Routine Refresh buttons are absent; pull-to-refresh, foreground reauthorization and actionable error retries preserve continuity. See [workspace loading](../navigation/workspace-loading.md) for request ownership and refresh behavior.

## Verification

Check narrow layouts, actual doubled text, long exact amounts/names, Light/System/Dark, keyboard/focus and reduced motion on the rendered application. Synthetic fixtures establish client behavior only; API/database tests establish authorization and durability. Store outputs outside tracked documentation and record limits on the delivery PR. See [browser verification](../browser-verification.md).
