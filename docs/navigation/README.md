# Responsive navigation and source restoration

Issue [#17](https://github.com/haggaikaunda/kami-split/issues/17) supplies the Next App Router shell, not financial journey implementations. Overview, History, Trips and Household are semantic links; account entry is explicitly simulated. Financial routes currently contain labeled navigation fixtures.

## Per-visit return context

`ExpenseLink` renders a canonical `/expenses/id` link. An ordinary activation captures a fresh serializable descriptor and pushes one URL with an opaque `visit` token. Modified-click/new-tab entry uses the canonical URL and therefore opens a standalone page. Descriptors contain source URL (including filters, trip tab and chart selections), source history-entry ID, window scroll position and logical focus ID. They contain no HTML, DOM objects or financial drafts.

Next intercepted routes retain the source React surface while rendering contextual detail in the `@detail` slot. At widths greater than 760px the detail is a focus-contained panel; at 760px or below it is a full page. Direct links remain full pages at all widths. `Open full page` replaces only the presentation query parameter, retaining the visit; resizing writes no history. Empty parallel-slot routes clear old detail when navigating elsewhere.

Every repeated record visit gets its own descriptor. Back/Forward use the descriptor belonging to that history entry. Explicit Close/Escape returns through Back only for an adjacent source created by this session. A direct/unknown visit has an explicit in-app History fallback. No browser-history-depth guess can navigate outside the app.

## Integration hooks

`NavigationProvider` is persistent in the root layout. Add the future application data provider inside it.

- `ExpenseLink({ expenseId, id, children })`: `id` is the stable logical return-focus target. It must be unique in the rendered source surface.
- `DraftLink({ draftId, id, children })`: starts a contextual draft route; form values never enter the URL.
- `useExpenseNavigation()`: `openExpense`, `openDraft`, `openContext`, `returnToSource`, `getSource`, `refreshVersion`, `markRouteReady`, and session-draft operations.
- `useRouteContext(route)`: returns the screen's own `href`, `searchParams`, `refreshVersion`, and `isActive`. Retained backgrounds **must use this instead of the foreground `useSearchParams()`**. It walks nested source descriptors so a chart bucket remains selected under an expense. Use `isActive` to suspend source-modal behavior while a foreground detail route is active; the source state remains retained.
- `useRouteReady(route, readyVersion)`: pass the generation of the freshly rendered query result, or `null` while waiting. A return increments `refreshVersion`; restoration occurs only when both the source URL and generation match. Errors/empty results also acknowledge their rendered generation so focus can fall back to the heading. Stale results must never acknowledge a newer generation.

A later async source screen should use this pattern (adapt the read call to its actual application service):

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

Later forms must reconcile pending/unknown adapter outcomes before discarding and must preserve their original operation ID on retries. The fixture only simulates pending state; it does not send or claim to commit financial mutations.

## Deterministic browser fixture

Run `pnpm dev`, or `pnpm exec next dev --hostname 127.0.0.1 --port 4177` for a dedicated test port. The ordinary app routes provide labeled fixtures until later issues replace them.

1. At 1280px, choose **Example search: Poke**, scroll to **Open expense 102**, enter the panel, choose **Open full page**, and use browser Back/Forward. Check the same query state, row focus and scroll.
2. Enter the same expense from `/trips/maui?tab=expenses&search=Poke`; repeat Back/Forward and confirm this independent source.
3. Select **September daily personal chart**, then **Inspect September 20 bucket**, then its expense. Test Close/Back at desktop and phone widths; the bucket reopens with its own source state and no obsolete modal blocking the detail page.
4. From detail choose **Edit draft example**, type description and note, then navigate away or browser Back. Resume it from the banner; fields remain, including during resize. Simulate pending, navigate, resume, then end the simulated request. Discard is blocked until pending ends and otherwise requires confirmation.
5. From a resumed nested draft choose **Leave and preserve draft**, then expense **Back to previous view**. Both original source levels remain correct; unrelated intermediate destinations do not replace the original filters.
6. In detail, **Simulate row removed from source** changes only navigation-fixture state. Return to the source: filters stay selected, the empty result re-renders, and its heading receives focus with an announcement.
7. Open `/expenses/102` directly: full page with a safe History link. Unknown IDs show unavailable fixture copy without financial details.

The browser fixture tests navigation without implementing real expense creation/editing, chart totals, trips, or authentication. Its removal simulation never mutates the financial adapter.

## Recorded verification

Independent live CUA checks on the actual Next router verified:

- At desktop width, filtered History → panel → Open full page → browser Back restores the same query, `list-expense-102` focus and captured scroll after the route settles.
- A dirty nested draft resumed from an unrelated Overview route explicitly returns to a newly rebased expense visit, then to the original filtered History with its row focus.
- At 390px, chart bucket → expense full page leaves no source dialog open. Removing the fixture row and going Back restores the same empty bucket; closing it restores `chart-bucket-20` focus and captured scroll.
- Pending state survives navigation/resume, and a focused draft field survives phone resizing without document overflow.

Provider/component tests separately cover stale readiness generations, canceled queued restoration, missing-row heading announcements, nested origins, cloned structured drafts, pending-discard protection, repeated IDs, source-query retention, full-page replace, the 760/761 boundary, and canonical modified-click links. These complement actual browser checks rather than claiming a mocked router is end-to-end verification.

Further live checks confirmed that returning through an older trip-origin expense visit preserves its independent trip filters; a direct desktop expense URL remains full-page with a History fallback; unknown expense IDs expose no financial fields; and crossing to exactly 760px changes panel to full-page without changing the URL or leaving a dialog open. The full-page skip link targets its visible expense heading.
