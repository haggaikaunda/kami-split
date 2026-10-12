# Issue #269 implementation evidence

[Issue #269](https://github.com/haggaikaunda/kami-split/issues/269) and
[draft PR #270](https://github.com/haggaikaunda/kami-split/pull/270) own scope and
final-head testing/review status. These are rendered production frontend captures
using synthetic Auth/GraphQL responses, not the approved static mockup or real
financial records. The final published head and independent evidence are recorded
on the PR. Baseline: `83990efff362f0ad7898defad4b6174adb4cc9e5`.

## Verification

Node 24.19.0, pinned pnpm, Chrome 155.0.8059.39. Relay drift, repository formatting,
lint, type checking, 62 test files / 435 tests and production build pass.
No API/schema/persistence or financial-policy changes; real API/database suites
were not rerun. Existing server authorization evidence remains distinct from
these frontend fixtures.

The committed `scripts/navigation-browser.cjs` harness ran against actual LAN HTTP
with `LEDGER_TESTS=1 ISSUE269_TESTS=1`. The layout matrix covers Household, Trip and
ordinary Group; every workspace tab; long descriptions/source/member names;
complete month aggregates before pagination; List/Filters alignment; 100% and
200% root text; filter URL/focus; pagination/retry; detail Back/Forward and saved
edit restoration; banner creation/cancel return; and rich-help placement,
non-overlap, one-at-a-time behavior, keyboard dismissal and focus continuation.
The final build additionally reran the complete 390px normal-text case.

| Width  | Root text | Appearance     | Result |
| ------ | --------- | -------------- | ------ |
| 320px  | 100%      | Light          | Pass   |
| 320px  | 200%      | Dark           | Pass   |
| 390px  | 100%      | Light          | Pass   |
| 390px  | 200%      | Dark           | Pass   |
| 440px  | 100%      | Light          | Pass   |
| 440px  | 200%      | System → Dark  | Pass   |
| 1440px | 100%      | Dark           | Pass   |
| 1440px | 200%      | System → Light | Pass   |

`REFRESH_TESTS=1 LEDGER_TESTS=1`, 700ms fixture delays, also passes Group and
Household at 390px/100% Light and 320px/200% Dark. Chrome CDP dispatches actual
browser touch input: top pull, below-top scrolling, pending/coalesced reads,
completion/failure, offline retry on the current error surface, revoked access,
URL retention and actor-scoped unsaved draft recovery after native document reload.
Desktop/keyboard refresh remains the browser's reload command, with no replacement
in-app button. WebKit's native fallback is covered by unit capability/UA tests;
physical iOS/Android gestures and assistive technology were not operated.

Independent tests cover authoritative counts/totals with incomplete loaded pages,
exact large money values, offsetting balances, personal zero versus other members,
unavailable/incomplete reads, source revalidation and late actor replies. Two
held-animation-frame regressions preserve a newer overlay origin and require fresh
reads before completing return restoration. Removing the new frame guard makes
the newer-origin test fail; the guarded suite passes.

## Preservation comparison

A separate production build from the exact baseline above ran with identical
synthetic inputs through `PRESERVATION_TESTS=1` at 390px/100% Light. This compares
actual before/after application output, not the mockup.

- Household and Trip computed banner background images, gradient overlays,
  background sizing/position and title colors are identical. Original artwork
  assets and their associations remain unchanged. Every tab now keeps that art.
- Spending by category dimensions, visible values, context, labels and share-basis
  text match before/after. Category selection and URL-backed basis switching work
  in both builds. Selected-category PNGs are byte-identical in Household and Trip.
  Initial PNGs differ at one pixel by one green-channel unit in each workspace;
  all dimensions and other pixels match. This small raster difference does not
  correspond to a chart source/style change.
- `breakdown.tsx`, its invocation, chart CSS rules and Overview Recent expenses
  markup remain unchanged. Summary-only exact-money wrapping does not select the
  chart or recent rows. Category icons now explicitly retain an accessible name
  when compact rows hide redundant category text.

[Before chart](preservation/category-before.png) ·
[After chart](preservation/category-after.png).

## Captures

The expense capture intentionally stresses long labels; its short Uber/Sasha row
shows the compact side-by-side presentation. The Balances capture has optional
explanations expanded after verifying they are closed initially.

- [Expenses, 390px](screenshots/expenses-390.png)
- [Overview, 390px](screenshots/overview-390.png)
- [Balances with optional explanations expanded](screenshots/balances-expanded-390.png)
- [Scope rich help and dismissal](screenshots/scope-help-390.png)
- [Trip banner and summary](screenshots/trip-overview-390.png)
- [Household Overview, 320px/200% Dark](screenshots/overview-320-enlarged-dark.png)

## Repeat

Build and start the app on a LAN-accessible HTTP origin. Supply installed Playwright
and Chrome paths as in [workspace loading](../../../navigation/workspace-loading.md).
Run `scripts/navigation-browser.cjs` with the matrix settings above and a dedicated
`OUTPUT_DIR`. For preservation, serve a baseline and final build separately and
run `PRESERVATION_TESTS=1` against each with identical width/text/theme inputs.
The preservation capture hides only fixed navigation to prevent screenshot
occlusion; chart content and styles are unchanged. Never point synthetic fixtures
at hosted services. Browser JSON/screenshots are local artifacts; selected captures
are archived here. CI failures are retained and recorded on the PR as requested;
this evidence does not authorize a protected merge or claim physical-device testing.
