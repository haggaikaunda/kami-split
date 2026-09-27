# Responsive navigation and source restoration

Issue [#17](https://github.com/haggaikaunda/kami-split/issues/17) introduced the Next App Router shell. Overview, History, Trips and Household now render the implemented shared-data journeys; account entry remains explicitly simulated. This document describes the current navigation contract and retains the original shell verification as historical evidence.

## Per-visit return context

`ExpenseLink` renders a canonical `/expenses/id` link. An ordinary activation captures a fresh serializable descriptor and pushes one URL with an opaque `visit` token. Modified-click/new-tab entry uses the canonical URL and therefore opens a standalone page. Descriptors contain source URL (including filters, trip tab and chart selections), source history-entry ID, window scroll position and logical focus ID. They contain no HTML, DOM objects or financial drafts.

Next intercepted routes retain the source React surface while rendering contextual detail in the `@detail` slot. At widths greater than 760px the detail is a focus-contained panel; at 760px or below it is a full page. Direct links remain full pages at all widths. `Open full page` replaces only the presentation query parameter, retaining the visit; resizing writes no history. Empty parallel-slot routes clear old detail when navigating elsewhere.

Every repeated record visit gets its own descriptor. Back/Forward use the descriptor belonging to that history entry. Explicit Close/Escape returns through Back only for an adjacent source created by this session. A direct/unknown visit has an explicit in-app History fallback. No browser-history-depth guess can navigate outside the app.

## Integration hooks

`NavigationProvider` is persistent in the root layout, with `AppDataProvider` and the session-owned command providers nested inside it.

- `ExpenseLink({ expenseId, id, children })`: `id` is the stable logical return-focus target. It must be unique in the rendered source surface.
- `DraftLink({ draftId, id, children })`: starts a contextual draft route; form values never enter the URL.
- `useExpenseNavigation()`: `openExpense`, `openDraft`, `openContext`, `returnToSource`, `getSource`, `refreshVersion`, `markRouteReady`, and session-draft operations.
- `useRouteContext(route)`: returns the screen's own `href`, `searchParams`, `refreshVersion`, and `isActive`. Retained backgrounds **must use this instead of the foreground `useSearchParams()`**. It walks nested source descriptors so a chart bucket remains selected under an expense. Use `isActive` to suspend source-modal behavior while a foreground detail route is active; the source state remains retained.
- `useRouteReady(route, readyVersion)`: pass the generation of the freshly rendered query result, or `null` while waiting. A return increments `refreshVersion`; restoration occurs only when both the source URL and generation match. Errors/empty results also acknowledge their rendered generation so focus can fall back to the heading. Stale results must never acknowledge a newer generation.

Current screens use `AppDataProvider.readyVersion` with `useRouteReady`. A separately queried source screen can use this equivalent readiness pattern (adapt the read call to its actual service):

```tsx
const { href, searchParams, refreshVersion } = useRouteContext('/history');
const [result, setResult] = useState<{
  href: string;
  generation: number;
  data: HistoryResult;
} | null>(null);

useEffect(() => {
  let current = true;
  const generation = refreshVersion;
  readHistory(new URL(href, 'https://kami.invalid').searchParams).then(
    (data) => {
      if (current) setResult({ href, generation, data });
    },
  );
  return () => {
    current = false;
  };
}, [href, refreshVersion]);

const fresh = result?.href === href && result.generation === refreshVersion;
useRouteReady('/history', fresh ? result.generation : null);
// Render result.data or the appropriate loading/error state. Do not fabricate zeros.
```

The replacement adapter's invalidation subscription should trigger the same source query path. The navigation layer deliberately does not call `router.refresh()`: its independent RSC focus lifecycle could race the client-data readiness barrier. Source records are re-read through `refreshVersion`, never restored from cached HTML. After the fresh render, a frame restores the logical row and window scroll; if that row is absent, the current dialog/page heading receives focus with an announcement. Tag page headings with `data-page-heading` and `tabIndex={-1}`.

## Draft preservation

`useSessionDraft<T extends DraftValue>(id)` exposes `draft`, `update(values, label?)`, `setPending(boolean)`, and `discard()`. `DraftValue` supports serializable JSON arrays/objects for participant IDs, allocations and comparison snapshots. Updating clones values. The operation ID is generated once and stays stable across updates, routes and viewport changes. Pending drafts cannot be discarded by the store or the banner.

All in-app exits, including Back/Forward and navigation links, preserve drafts in the layout session. The global Resume/Discard banner makes this explicit. Discard uses safe-action-first confirmation. `beforeunload` requests native confirmation for actual reload/close; memory is deliberately reset if the user confirms page loss. This is session preservation, not durable storage or server security.

Resume allocates a fresh visit and preserves the original source descriptor. Explicit Close (and a later successful-save return) replaces to that original source because it may no longer be the adjacent history entry. Browser Back from a resumed draft follows the actual invoking history entry while preserving the draft. If the original source was itself an expense or bucket visit, its descriptor is copied into a new nonadjacent visit; old history entries retain their original Back/Forward meaning. Never reuse an old visit's adjacency in a new history entry.

The implemented forms reconcile pending/unknown adapter outcomes before discarding and preserve their original operation ID on retries. They commit through the session-only mock adapter, without durable storage or real payments. Session/visit/operation IDs use `createSessionId`: native `crypto.randomUUID()` where available, otherwise UUID v4 from `crypto.getRandomValues()`, including plain-HTTP LAN previews.

## Current navigation checks

Run `pnpm dev`, or `pnpm dev --hostname localhost --port 4177` for a dedicated local test port at `http://localhost:4177`. The following routes use the shared session data:

1. Open `/history?search=Poke&type=created`, select the expense, choose **Open full page**, and use browser Back/Forward. Check the same filters, source row focus and scroll.
2. Open `/trips/maui?tab=expenses&search=Poke` and repeat the round trip. Its source visit must remain independent of History.
3. On Overview, select Daily and inspect a spending bar or its exact-table row. Open an expense, then return; the selected bucket and its refreshed records remain available.
4. Open Add expense or Edit expense, change values, and leave with Escape or navigation. Resume from the draft banner and check retained values through resize. Use the simulation controls for pending/unknown outcomes; do not discard an unresolved operation.
5. Open `/expenses/102` directly for a full page with a safe History fallback. A missing ID must expose no financial details.

For mutation, error, responsive and accessibility evidence, see the [recovery report](../recovery/README.md) and [final UX verification](../accessibility/README.md). The fixture-only controls named in the original evidence below no longer appear on application routes.

## Recorded issue #17 verification

The following observations were recorded against the original navigation fixture. They are preserved as historical evidence, not instructions for finding those fixture controls in the current application.

Independent live CUA checks on the actual Next router verified:

- At desktop width, filtered History → panel → Open full page → browser Back restores the same query, `list-expense-102` focus and captured scroll after the route settles.
- A dirty nested draft resumed from an unrelated Overview route explicitly returns to a newly rebased expense visit, then to the original filtered History with its row focus.
- At 390px, chart bucket → expense full page leaves no source dialog open. Removing the fixture row and going Back restores the same empty bucket; closing it restores `chart-bucket-20` focus and captured scroll.
- Pending state survives navigation/resume, and a focused draft field survives phone resizing without document overflow.

Provider/component tests separately cover stale readiness generations, canceled queued restoration, missing-row heading announcements, nested origins, cloned structured drafts, pending-discard protection, repeated IDs, source-query retention, full-page replace, the 760/761 boundary, and canonical modified-click links. These complement actual browser checks rather than claiming a mocked router is end-to-end verification.

Further live checks confirmed that returning through an older trip-origin expense visit preserves its independent trip filters; a direct desktop expense URL remains full-page with a History fallback; unknown expense IDs expose no financial fields; and crossing to exactly 760px changes panel to full-page without changing the URL or leaving a dialog open. The full-page skip link targets its visible expense heading.

The shell was also verified through CUA at an actual 320×844 viewport with 200% text (computed root font size 32px). A temporary fixture-only native selector changed root font size via a React effect; it was removed after verification and is not a product setting. Document width remained 320px. All four bottom-navigation labels wrapped fully without clipping; each link measured 78×142px with matching scroll/client width. The source expense row remained reachable above the bottom navigation. Keyboard Enter opened expense 102 as a full page while preserving 32px text and 320px document width, and activating Skip to content focused the visible expense heading.
