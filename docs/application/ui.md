# Shared UI behavior

Kami Grow uses shared semantic tokens, system fonts and accessible primitives. Global tokens/themes live in `apps/web/src/app/tokens.css`; intentional document defaults live in `base.css`. Components own their presentation in colocated styles; original visual references are indexed in the [design guide](../design/README.md). Approved sample data and screenshots are not financial authority.

## Shared ownership and composition

Import neutral controls, fields, members, modal dialogs and feedback from `components/ui/primitives`. These components have no expense or server-data dependency. `components/workspace/patterns` owns workspace headers, route navigation, source chips and privacy copy; `components/workspace/shell.module.css` owns application chrome and content width. `components/financial/presentation` owns exact formatted money, summary metrics, charts and financial rows. Financial components accept ordinary props and never parse formatted amounts or fetch data.

Shared component styles use colocated CSS Modules. Keep base styles, variants, interaction states and responsive rules with the owning component. The root layout anchors the shared module imports in their existing order; components import those same deduplicated sheets. Import the component before a caller's customization stylesheet, and preserve the root order when moving dependencies so Next's production chunks retain the established cascade. A caller may compose exported layout classes for its own elements, such as `actions`, `summary-row` or `member-palette`; component internals remain private.

Existing cross-component customization uses explicit `data-ui` styling slots. The attribute is a whitespace-separated set of slot and variant names, independent of generated CSS Module class names. Use the smallest owning feature selector plus the required slot; do not select private class names or infer internal markup from tags. Current contracts are:

| Owner                  | Public styling slots                                                                                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neutral UI             | `button` and `button--<tone>`; `field`, `field-label`, `field-control`, `hint`, `error`; `member`, `avatar`, `member-copy`, `member-name`, `member-detail`; `status`, `loading`, `skeleton`, `icon`                                                         |
| Workspace              | `workspace-header` and its appearance/compact variants, `workspace-context`, `banner-action`, `space-chip`; shell `workspace-brand`, `workspace-content` and navigation parts                                                                               |
| Financial presentation | `money`, `money--long`, `money-value`, `currency`; `summary-row`, `summary-metric` and tone variants, `metric-heading`, `metric-icon`, `metric-label`, `metric-value`, `metric-detail`; `signed-balance` and position variants, `balance-row`, `row-detail` |

For example, Account customizes `field-label` and `field-control` while Field continues to own labeling, errors and descriptions. Member layouts customize `member-copy` and `member-name` instead of depending on a last-child span or a nested `strong`. Prefer an existing component variant or root `className` for new consumers; extend this slot contract only when a real consumer needs a distinct layout. Slots do not transfer behavior or financial ownership to CSS.

Account and appearance presentation belongs to `onboarding/account.module.css`; authentication/join screens use `onboarding/onboarding.module.css`. Invitation management and member-list layouts share `onboarding/invitations.module.css`, with an explicit `members-panel` class composed by workspace consumers. Activity feed and immutable event detail share `activity/feed.module.css`; anchored help owns `rich-help.module.css`. These modules customize shared controls through the public slots above. Semantic roles/labels remain the first choice for tests; stable `data-ui` parts support structural layout assertions without exposing generated class names.

The remaining production owners are:

| Presentation                                                                 | Colocated owner                                                                                                       |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Discovery and group/trip cards                                               | `groups/discovery.module.css`                                                                                         |
| Workspace panels/settings/balances, overview rows, Household source balances | `groups/workspace.module.css`, `overview.module.css`, `household-workspace.module.css`, `balance-sections.module.css` |
| Expense/repayment and group/trip creation forms                              | `groups/forms.module.css`; current expense facts use `groups/expense-detail.module.css`                               |
| Ledger rows, responsive filters and Breakdown                                | `expenses/ledger.module.css`, `filter-form.module.css`, `breakdown.module.css`                                        |
| Native expense/filter dialog frame and expense viewport behavior             | `expenses/dialog.module.css` and `presentation.module.css`; neither imports ledger row styles                         |
| Category artwork and refresh feedback                                        | `financial/category.tsx` with `category.module.css`, and `workspace-refresh.module.css`                               |

`ui/form-layout.module.css` provides the opt-in neutral `form-scope` layout class. Existing native controls declare `form-label`, `form-control`, `form-checkbox`, `form-radio`, `form-fieldset` or `form-button` slots; `form-region` declares a shrinkable region. Field's existing `field-label`/`field-control` slots also participate. A scope no longer styles arbitrary descendant controls. The shared sheet is anchored before feature overrides, and can be used without importing financial styles. Native expense presentation composes the scope itself. Feature form classes own their floating labels, split controls, recovery content and sticky action rows. `Skeleton size="workspace"` owns the taller workspace loading geometry, independently of a feature wrapper.

Filter presentation uses an explicit `filterLayout` contract: Group/Trip retains its spaced fieldsets and larger checkboxes; cross-space Household and its original ledger retain compact fieldsets and grid field labels. Group/Trip field labels retain their block layout. URL filtering and submitted values are unchanged. These explicit variants do not depend on stylesheet load order. `ExpensePresentation` accepts the same Group/Household layout distinction; mobile Household creation supplies the canvas split-control surface through `--expense-split-control-background`, while feature form geometry remains in the form owner. Household balance states use `data-position`; member-list avatar palettes are an explicit shared composition class. Remaining document selectors are intentional: token/theme roots, base element/focus/accessibility defaults, and the temporary pull-refresh class on `html`/`body` that controls the document gesture. There are no feature-global stylesheets.

## Tokens and responsive rules

`tokens.css` owns Light defaults and the explicit Dark override. Color roles distinguish document canvas, surfaces, separators, interactive borders, text, actions, exact-balance positions, category geometry, banners and summary metrics. Keep positive/negative financial presentation separate from destructive/error colors. The system font stack owns both body and display text; tabular numerals belong to money. Spacing tokens cover repeated gaps; control/card radii, minimum target size, focus ring and panel shadow describe their own roles. A matching literal value alone is not a reason to merge roles. Unused aliases are removed only after checking production styles, dynamic use, palette tests and the executable gallery.

Use viewport queries for application chrome and modal presentation, and container queries for the width available to ledger rows, charts or panel contents. Preserve content-specific thresholds: the shell and expense presentation change at 600 CSS pixels (matching their JavaScript measurements), generic Dialog changes between 759/760px, and ledger rows use the `workspace` container at 48em with a 16em fallback. Breakdown has a 760px content-stack transition and a `breakdown-chart` container fallback at 14em; overview columns retain their 820px content threshold. Measure the actual named container when checking its boundary, because navigation and padding reduce available width. `rem`/`em` support enlarged text where the existing layout intends it; retain approved fixed pixel values when they encode artwork, geometry or target sizes. Do not normalize every breakpoint to one value.

Safe-area padding remains with the owning shell/dialog. At phone widths and viewports no taller than 40rem, the identity header scrolls in document flow so enlarged controls remain reachable above the fixed navigation. Measured header scroll clearance becomes zero while it is in flow, and returns to its occupied height when sticky positioning resumes. The expense presentation follows the unscaled visual viewport for the keyboard, keeps one mounted form, and releases sticky actions for a short viewport or enlarged text. The document remains the scroll owner for source restoration. Shared CSS does not create a second scroll container or replace that navigation contract.

## Appearance and navigation

Light, System and Dark are private account preferences. A selection applies immediately and saves in the background with serialized, guarded writes; uncertainty requires a fresh read before retry. Only System follows the OS. See [profile/appearance](profile.md) for cache isolation and conflict handling.

Persistent navigation links Household and Groups, which includes ordinary groups and trips. Phones place a raised, labeled Add expense action between them; desktop retains a labeled creation action. The Profile avatar opens `/account` as a full page with the same global navigation. Groups stays selected inside trips; Profile uses its avatar selection. Overview, Expenses and Balances are direct workspace links; More discloses native Activity and Members links and visibly identifies either current destination. These are route links, not ARIA tabs. Escape closes More and restores its trigger focus.

## Workspaces and expenses

The compact illustrated header places bold Kami Grow above the current destination, with query-owned Group/Trip names, readable wrapping and a softly shaded illustrated background. Household and Group/Trip scope help remains labeled and dismissible. The global Add expense action uses a currently authorized workspace source; global contexts open an explicit eligible-source chooser. Original Household ledger access remains distinct from the cross-space Household summary. Do not invent a source for a write. Current summaries use complete server totals; visible or loaded rows cannot establish totals or settlement.

Expense lists use compact rows with payer at left and amount at right, description/category context, and counts below month/year headings. Filters sit beside List/Breakdown. Their single mounted modal uses a mobile bottom sheet and desktop right drawer, with an independently scrolling body and reachable header/footer. Filters and expense presentations share document scroll-lock ownership through overlapping browser-history transitions and access loss; only the final owner restores the document’s prior overflow when closing or being disposed. The redundant summary strip above the ledger is absent; monthly totals/counts and per-row share remain. Structured filters combine scope, category, dates, Involving and Paid by; exact date/amount sorting, incremental scrolling, and authorized source restoration preserve URL state. Breakdown's Spending by category retains the server's complete dataset. See [ledger behavior](expenses-ledger.md).

Creation/editing preserves exact Equal, Exact and Percentage intent, dirty drafts and frozen recovery attempts. The responsive form/detail presentation keeps actions reachable with long content and larger text. Activity distinguishes original creation, later edits and repayments, with immutable before/after facts.

## Balances, help and refresh

Balance copy distinguishes what a person owes/is owed from expense spending. Repayments record transfers without moving money and never affect spending totals. Household net zero can contain offsetting source balances; retain the explicit warning and original-space explanation. Every individual must be zero within a source group for that group to be settled. Failed or incomplete reads cannot imply zero.

Household Balances initially collapses each source independently, keeping its name,
kind, exact personal balance and truthful settlement/unavailable copy visible.
Source icons stack above names in narrow text-relative containers so long names
retain a readable text column at enlarged sizes.
Expanded sources expose explicit obligations and links to complete member positions
and repayment history. Group/Trip Balances separates member positions from
who-owes-whom suggestions with the same native keyboard disclosures. Selecting a
member position opens its expense/repayment calculation; it never infers a
counterparty from a net. Eligible obligation rows are one native link with explicit
parties, exact suggested amount and source; ineligible rows explain why recording
is unavailable. General actual transfers remain a separate source-owned entry.
Expansion metadata belongs to the account's financial scope and is erased on
scope disposal. It contains no balances or member payloads.

Rich help is anchored and keyboard accessible with explicit dismissal, focus restoration and viewport bounds. Routine Refresh buttons are absent; pull-to-refresh, foreground reauthorization and actionable error retries preserve continuity. See [workspace loading](../navigation/workspace-loading.md) for request ownership and refresh behavior.

## Verification

Check narrow layouts, actual doubled text, long exact amounts/names, Light/System/Dark, keyboard/focus and reduced motion on the rendered application. Synthetic fixtures establish client behavior only; API/database tests establish authorization and durability. Store outputs outside tracked documentation and record limits on the delivery PR. See [browser verification](../browser-verification.md).

## Loading presentations

`components/ui/loading` provides `ScreenLoading` for initial account/session
resolution and `ContentLoading` for a pending destination below the workspace
tabs. The screen accepts no private data: public Kami Grow branding, three quiet
dots, “Getting things ready” and “Opening your account…” are its entire content.
Content layouts are `overview` (summary metrics and recent rows), `expenses`
(month/count/amount placeholders and rows), `balances` (summary cards and positions), `activity`
(event rows), `members` (avatar/name rows and state placeholders), and `cards` (discovery). A caller may
supply a specific public label such as `groups`; never pass a private name, amount
or inferred count. Shapes reuse the neutral `SkeletonBlock` primitive.

Both compositions delay visible status/geometry by 150 ms and change to “Still
getting things ready” or “Still loading …” after eight seconds. These are
presentation timers, not request timeouts or minimum display durations. Page hide
cancels them and foreground return starts a fresh wait, so time spent away does
not immediately trigger slow copy. Mount
only while the owning read is pending; immediately replace with ready content,
the owner's error/retry, or access denial. The status is one atomic polite live
region outside the busy content region; all shapes/dots are decorative. Timers
never move focus. Reduced motion makes dots and skeletons fully static; theme
tokens supply contrast. The shell remains the document scroll/safe-area owner.

Workspace route links reserve a fixed cue beside each label. Next's
`useLinkStatus` marks only the latest pending link, keeps `aria-current` on the
committed route, and clears the cue when navigation commits. The reserved surface
responds immediately; its small dot waits 150 ms. This decorative route cue does not add a
second spoken loading message. The destination's content presentation then owns
data-pending feedback. Public shell/navigation persists; private Group/Trip
headers stay inside their authorized query and are replaced with a generic
Group/Trip banner during that query's pending state.

Read owners retain all Relay caching, request, cancellation and authorization
responsibilities. `WorkspaceLoading` preserves only measured layout height across
refresh, never previous private values. A foreground/access invalidation removes
protected content immediately, including during the 150 ms quiet interval. No
new cached-display or background-refresh policy is implied by these components.
`WorkspaceRefresh contentPending` leaves the pending announcement to the content
loader and retains refresh completion/failure feedback. Its explicit error retry
coalesces with the existing pull gesture and invokes the owner's read callback;
it does not retry a mutation or manufacture a timeout.

## Unified directory

Groups uses the shared header identity, an accessible body heading and a compact
segmented All/Groups/Trips toolbar with the authorized Create action. Native card
links group source identity, active-member count and trip destination/dates beside
a decorative icon and chevron; a divider separates paired spending and balance
columns. Desktop keeps two equal columns even for a solitary card. Complete Total spend and Your balance are separate labeled
values in the source currency. Positive, negative and zero balances use explicit
words; zero never labels the entire source settled. Names and exact amounts wrap
within shrinkable card columns at narrow widths and enlarged text. When a card
is narrow relative to its text size, its icon stacks above the name and member
label so ordinary words retain usable line width. The directory
uses the shared cards loading presentation, URL-backed type/date links and the
existing native Dialog for the authorized Group/Trip creation choices. Current
Group and Trip workspaces also expose complete Total spend in Overview.
