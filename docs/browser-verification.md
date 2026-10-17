# Browser verification

Use rendered checks alongside API/database tests. Store outputs in ignored `test-results/` or an external temporary directory and publish relevant results on the delivery PR. Never commit captures or pass/fail reports.

## Required Chromium smoke suite

Use Node 24 and pnpm 11.25.0 from `package.json`. Install the frozen workspace dependencies and the Chromium version paired with pinned `@playwright/test`:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
# Linux, including CI: install Chromium and required system libraries together.
pnpm exec playwright install --with-deps chromium
pnpm test:browser
```

The single command builds the current production app, starts owned loopback Auth and Next services, runs named Playwright tests at 390px and 1280px, and tears down both services. Stop any preview before rebuilding this checkout; do not run type checking concurrently with the build. Never share `.next` between worktrees. For a build just produced by the required checks, use `BROWSER_SKIP_BUILD=1 pnpm test:browser` (CI does this immediately after `pnpm build`). The caller must ensure that build matches the current source.

The suite covers cold HTML/Flight denial, sign-in continuation and logout/history, filtered multi-page expense detail/create restoration with fresh reads and focus, and a held private response across sign-out. Workspace-tab journeys also cover no financial requests on hover or keyboard focus, cold authorized activation, bounded recent-repeat and Back/Forward reuse, expiry and foreground denial, and native modified-click navigation. Each test owns a fresh browser context, cookies, request log and GraphQL fixture state. Auth requests from both Next and the browser reach the same synthetic service; there is no production bypass. Test tokens, profiles, groups and money are synthetic. Startup appearance cases sample root theme and rendered canvas/body on every animation frame while profile/Auth responses are held, capture before/after screenshots, and cover explicit Light/Dark overrides, System fallback, repeated foreground/history events, corrupt/unavailable presentation storage and logout. This proves frontend/Next behavior, not provider authentication, API authorization or persistence. Browser emulation does not establish native installed-iOS launch/snapshot behavior.

Ports default to 3295 (Next) and 3296 (Auth). Existing servers are never reused. For simultaneous runs in **separate worktrees**, choose a distinct pair of ports and output location in each:

```sh
BROWSER_PORT=3395 BROWSER_AUTH_PORT=3396 \
  BROWSER_OUTPUT_DIR=/tmp/kami-browser-other pnpm test:browser
```

The default ignored `test-results/browser/` contains the HTML report and failure screenshots/traces. Use only this ignored tree or an external temporary output directory. CI uploads failures for seven days. Named test/action failures and uncaught browser errors identify the failing journey. No tests, unexpected skips, focused-only declarations and failed attempts fail the suite; retries are disabled. The affected-web job runs one browser worker on its existing runner, behind the unchanged required `Verify` gate. New root browser tooling is conservatively classified as shared input.

```sh
pnpm test:browser --project=chromium-390 --grep 'expense navigation'
pnpm test:browser --project=chromium-390 --debug
pnpm exec playwright show-report test-results/browser/report
pnpm exec playwright show-trace test-results/browser/artifacts/<failed-test>/trace.zip
```

Focused/debug commands still start their own services and build unless explicitly reusing a fresh build with `BROWSER_SKIP_BUILD=1`. Missing dependencies/browser executables or occupied ports fail with setup diagnostics; install the pinned browser or choose unused ports, rather than pointing the suite at workstation Chrome.

## Broader opt-in authentication and component runners

The original broader scripts remain available. They resolve `playwright` through `PLAYWRIGHT_MODULE` or normal module resolution; use the repository-owned package after installation. `CHROME_PATH` remains an optional override only for these legacy runners.

```sh
pnpm build
PLAYWRIGHT_MODULE="$(node -p "require.resolve('@playwright/test')")" \
  node scripts/auth-boundary-browser.cjs
```

The Auth-boundary runner starts its own synthetic Auth and production Next servers on loopback, default ports 3196 and 3195. It checks actual cookie/server routing, cold HTML/Flight denial, safe continuation, sign-out/history and onboarding on desktop/mobile. See [web authentication routing](application/web-auth-routing.md#verification) for setup and limits.

The account, appearance, navigation and percentage synthetic runners use `browser-auth-fixture.cjs`. Start an isolated production preview with `ONBOARDING_PUBLIC_SUPABASE_URL=http://localhost:3196` and `ONBOARDING_PUBLIC_SUPABASE_KEY=synthetic-public`, choose that runner's `PORT`/`ORIGIN`/`BROWSER_ORIGIN` as documented in its source, then run one fixture at a time. A custom `BROWSER_AUTH_ORIGIN` must be loopback and match the Next Auth URL. Never point these fixtures at production or a real account.

For compact expense-filter coverage, run `FILTER_TESTS=1 LEDGER_TESTS=1 node scripts/navigation-browser.cjs` against that isolated preview. `WIDTH=320`, `390` or `1280`, `SCALE=2`, and `THEME=light`, `dark` or `system` select layout, enlarged-text and appearance checks (`COLOR_SCHEME=dark` exercises System in dark mode). The runner checks selection summaries, date bounds, draft-only Reset, Apply/dismissal focus, bottom-sheet/right-drawer geometry, bounded scrolling and footer reachability in Group/Trip and Household ledgers. Set `BROWSER_ORIGIN` to the actual LAN HTTP origin for phone-preview verification.

The optional `edit-real-browser.cjs` and `percentage-real-browser.cjs` additionally require their disposable Go/database integration setup and verified synthetic bearer. Their local Auth fixture models the web session boundary; actual financial transport still reaches the test API. Component-only synthetic GraphQL responses do not prove persistence, authorization or provider delivery.

## Reference captures and comparisons

The original Material reference pack and checksums are linked from [issue #227](https://github.com/haggaikaunda/kami-split/issues/227). It is an approved design input, not current implementation evidence. [Current UI rules](application/ui.md) supersede its older typography and navigation details.

The legacy `visual-parity-fixture.cjs` application proxy strips upstream cookies and seeds the retired localStorage session. Its application capture and interaction modes therefore do **not** support the current server-verified cookie boundary. Keep the fixture/reference tools for reuse, but do not treat those application modes as a working current acceptance command or weaken authentication to run them. A separate fixture adaptation is needed. Use the cookie-aware runners above for current client/auth checks.

Reference-only capture and comparison-only processing remain independent of application authentication. Extract the checksum-verified pack; `REFERENCE_DIR` must contain `desktop.html`, `mobile.html` and `source/`, and `REFERENCE_LUCIDE_PATH` must identify the exact Lucide UMD dependency from the export. Sharp resolves normally or through `SHARP_MODULE` for comparisons.

```sh
REFERENCE_ONLY=1 OUTPUT_DIR=/tmp/kami-reference \
  node scripts/visual-parity-browser.cjs
COMPARE_ONLY=1 APP_EVIDENCE_DIR=/tmp/kami-application \
  REFERENCE_EVIDENCE_DIR=/tmp/kami-reference \
  OUTPUT_DIR=/tmp/kami-comparison node scripts/visual-parity-browser.cjs
```

Set `REFERENCE_DIR` and `REFERENCE_LUCIDE_PATH` in the environment for the first command. The second requires compatible existing capture directories; it does not produce fresh application screenshots. Comparisons align shared top-left extents without scaling and record excluded dimensions. Numerical differences are descriptive, not an independent pass threshold. Inspect rendered layout and computed styles; fixed dialogs also need viewport captures and internal scrolling.

## Scope and limitations

Check 320/390/768/1280px as relevant, actual 200% root text, long names and large exact amounts, Light/System/Dark, keyboard/focus, reduced motion, failure/recovery and source restoration. Check the actual LAN HTTP origin for phone-preview changes. Record application head/build, fixture state, viewport, theme, font, reference state and limits with each result on the PR.

Fixture-rendered layouts establish client behavior only. Real API/database tests establish their own financial and access contracts. Neither proves hosted SMTP, real production configuration, physical iOS/Android safe areas/keyboards or spoken assistive technology. Do not infer a commit or authorization success from a toast, screenshot or HTTP 200.
