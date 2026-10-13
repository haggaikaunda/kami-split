# Shared UI behavior

Kami Grow uses shared semantic tokens, system fonts and accessible primitives. Current style ownership is in `apps/web/src/app/styles.css`, component styles and `apps/web/src/components/primitives.tsx`; original visual references are indexed in the [design guide](../design/README.md). Approved sample data and screenshots are not financial authority.

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
