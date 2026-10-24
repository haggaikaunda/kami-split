# Browser verification

Use rendered checks alongside API/database tests. Store outputs in ignored `test-results/` or an external temporary directory and publish relevant results on the delivery PR. Never commit captures or pass/fail reports.

## Required Chromium smoke suite

Use Node 24 and pnpm 11.25.0 from `package.json`. Install the frozen workspace dependencies and the Chromium version paired with pinned `@playwright/test`:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
# Local Linux: install Chromium and required system libraries together.
pnpm exec playwright install --with-deps chromium
pnpm test:browser
```

Hosted web CI runs inside the version-pinned official Playwright Noble image in
`.github/workflows/web.yml`, which supplies browser binaries and OS libraries.
It still selects Node 24 and installs frozen workspace dependencies. Before each
browser partition, `scripts/browser/ci-environment.mjs` verifies the installed Playwright
version against the exact package pin and image metadata, then launches Chromium.
Missing or mismatched metadata, browser paths, binaries or libraries fail the job;
CI does not install browsers or run apt. Update the image tag together with the
Playwright dependency. Local browser setup remains as described above.

The single command builds the current production app, starts owned loopback Auth and Next services, runs named Playwright tests with two workers at 390px and 1280px, and tears down both services. Stop any preview before rebuilding this checkout; do not run type checking concurrently with the build. Never share `.next` between worktrees. For a build just produced by the required checks, use `BROWSER_SKIP_BUILD=1 pnpm test:browser` (CI verifies and restores its sealed build artifact before doing this). The caller must ensure that build matches the current source.

The suite also exercises collapsed Household balance sources, explicit repayment
rows in both directions, return focus/scroll, another authorized recorder,
overpayment confirmation, duplicate activation and fresh balances/history. Its
balance layout cases cover 320/390/440px and desktop with actual 200% root text,
ineligible parties, unavailable sources and exact long values. These fixture
transfers demonstrate client behavior, not server financial authorization.

The suite covers cold HTML/Flight denial, sign-in continuation and logout/history, filtered multi-page expense detail/create restoration with fresh reads and focus, and a held private response across sign-out. Workspace-tab journeys also cover no financial requests on hover or keyboard focus, cold authorized activation, bounded recent-repeat and Back/Forward reuse, expiry and foreground denial, and native modified-click navigation. Each test owns a fresh browser context, cookies, request log and GraphQL fixture state. Auth requests from both Next and the browser reach the same synthetic service; there is no production bypass. Test tokens, profiles, groups and money are synthetic. Startup appearance cases sample root theme and rendered canvas/body on every animation frame while profile/Auth responses are held, capture before/after screenshots, and cover explicit Light/Dark overrides, System fallback, repeated foreground/history events, corrupt/unavailable presentation storage and logout. This proves frontend/Next behavior, not provider authentication, API authorization or persistence. Browser emulation does not establish native installed-iOS launch/snapshot behavior.

Ports default to 3295 (Next) and 3296 (Auth). Existing servers are never reused. For simultaneous runs in **separate worktrees**, choose a distinct pair of ports and output location in each:

```sh
BROWSER_PORT=3395 BROWSER_AUTH_PORT=3396 \
  BROWSER_OUTPUT_DIR=/tmp/kami-browser-other pnpm test:browser
```

The default ignored `test-results/browser/` contains the HTML report and failure screenshots/traces. Use only this ignored tree or an external temporary output directory. CI uploads failures for seven days. Named test/action failures and uncaught browser errors identify the failing journey. No tests, unexpected skips, focused-only declarations and failed attempts fail the suite; retries are disabled. Hosted web verification overlaps Relay/lint/type/unit/helper checks with one
production build, then runs three browser partitions on separate runners. Each
partition retains two workers, zero retries and its own stateless services and
output directory. Playwright's built-in sharding preserves nonparallel file groups;
global `fullyParallel` remains false. `ci-build.mjs` packs hidden `.next` runtime
files in a tar archive (excluding build cache), retaining permissions. Its manifest
binds the archive, discovery inventory and Next build ID to the exact checkout
revision. Each partition verifies the archive/revision before extraction and uses
`BROWSER_SKIP_BUILD=1`.

The independent reviewed discovery check validates all required journeys and
viewport ownership and exercises all three actual shard selections. Each partition
records every execution and attempt. The `Web coverage` job requires successful
checks/build/matrix results and an exact disjoint union equal to the sealed full
discovery inventory, with matching revision/build identity. Missing, failed,
cancelled, unexpectedly skipped, duplicated or extra executions fail the reusable
workflow and the unchanged required `Verify` gate. Matrix fail-fast is disabled to
retain other partitions' diagnostics; per-partition reports and failure artifacts
are retained seven days. Build artifacts are scoped to the same workflow run and
retained one day. No build or report is reused across runs. Known synthetic browser inputs require web verification; unknown root tooling remains conservatively classified as shared input.

### Deterministic fixture facts and ordering

Keep facts for an immutable entity ID coherent across list/detail responses and
shared fixture builders, including type, ownership, version, amount and status.
Model a real transition explicitly; use distinct IDs for distinct entities. A
contradictory fixture can cause a valid cache or navigation assertion to fail, so
inspect both response facts and accepted state before attributing the failure.

Use explicit response gates and observable request/state checkpoints to control
asynchronous ordering. Release and drain held responses during teardown. Add
synthetic delays only when delay itself is required by the behavior under test;
do not use arbitrary sleeps to arrange ordering. Preserve the real-time boundary
cases documented below and the harness's existing timeout/retry settings. For
recurring failures, retain evidence and follow the shared
[diagnosis owner and retry budget](agents/model-routing.md#bound-retries-and-hand-off).

### Scheduling and coverage ownership

Global `fullyParallel` remains disabled. The audited independent cases in
`smoke.spec.mjs` opt into test-level parallelism so that this large file can use
both workers. Other files keep their within-file order. Each test owns its browser
context, cookies/storage, route handlers, mutable fixture data, request logs and
held responses; fixture teardown releases outstanding responses and drains route
handlers. The synthetic Auth service has no mutable account store. Screenshots,
attachments and traces use `testInfo.outputPath`, which isolates tests/projects.
Workers share only the production build and stateless loopback services. Do not
run competing builds, type checks or previews against those outputs.

Tests tagged `@owns-viewport` explicitly set their relevant dimensions and run
once under `chromium-390`; `chromium-1280` excludes that tag during discovery.
Their retained viewport/theme/text coverage lives inside the test:

| Owned cases                                | Retained dimensions / behavior                                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Enlarged Group/Trip headers                | Explicit 320/390px, doubled text, protected read/failure/retry geometry                                                                        |
| Activity row composition                   | 320/390/440/1280/1440px; Household/Group; Light/Dark/System; normal/doubled text                                                               |
| Creation page reachability                 | 320/390/440/1280px; Light/Dark/System; normal/doubled text and short viewport                                                                  |
| Members reflow                             | Household/Group/Trip; 320/390/440/1280px; theme/text/empty-state cases owned by the matrix                                                     |
| Brand presentation                         | Sign-in/workspace at 320/390/440/1280px; Light/Dark/System and normal/doubled text; public served icon/metadata checks                         |
| Account opening accessibility              | Normal 390/1280px privacy/axe checks, then 320/390/1280px in Light/Dark with doubled text; one held Auth response and real slow-state/recovery |
| Directory cards and shared shell           | Internal width/theme/text matrices, exact amounts, artwork failure and keyboard help                                                           |
| Balance/repayment layout                   | Internal narrow/desktop, text and appearance matrices; unavailable/ineligible sources and reachable controls                                   |
| Short expense filters and focus indicators | Explicit short mobile viewports, enlarged text, pointer/keyboard and forced-color checks                                                       |
| Creation recovery and Overview reflow      | Explicit fixed mobile or internal narrow/desktop matrices, exact amounts and readable secondary totals                                         |

All untagged journeys retain both project dimensions, including startup paint,
auth denial, account lifecycle, cache/navigation,
focus restoration and repayment/history behavior. A test whose initial checks
rely on project dimensions must remain untagged even if it later resizes.
`node --test scripts/browser/*.test.mjs` runs actual default discovery and rejects
missing required files/cases, missing desktop counterparts or unexpected tag
ownership. Update its reviewed inventory deliberately with coverage changes.
Focused commands remain diagnostic subsets; they do not satisfy full-suite gates.

The loading-handoff browser case installs Playwright's clock only after the
initial Overview is ready. Each held read must visibly commit its initial
`Loading balances…` status before advancing the browser clock by eight seconds;
the browser must then render the slow status before release. The retry repeats
that initial-to-slow transition independently. This keeps real route delivery,
held responses, rendering, focus and request-count assertions while removing the
wall-clock slow wait. Do not infer readiness from a timer registration, dispatch
application lifecycle events or change production delays to arrange the test.
Exact 149/150ms and 7,999/8,000ms boundaries, content-retry reset and timer cleanup
have deterministic component tests in `loading.test.tsx`. The existing
rapid-destination browser case owns navigation away and late-response disposal
checks. Account-opening slow feedback, startup-frame, cache-expiry and
interaction/paint synchronization retain real time for their behavioral
boundaries.

Use the same discovered workload with one worker for serial diagnosis:

```sh
pnpm test:browser --workers=1
# Reuse only a matching production build from this checkout:
BROWSER_SKIP_BUILD=1 pnpm test:browser --workers=1
```

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

### Real private transaction detail journey

`scripts/banking-detail-real-browser.cjs` is driven by the opt-in
`TestBankingDetailRealBrowserJourney` Go integration fixture. It forwards the
application's actual GraphQL operations to an owned HTTP/API/database service;
only Auth is synthetic. The fixture creates private current/archive facts and
more than one page of activity, then verifies persisted notes, exclusion and
classification totals, conflicts, original-attempt recovery after response loss,
archive ownership/provenance and foreign-member denial. It does not call Plaid.

Start a matching production preview from the owned checkout on port 3359 with
`ONBOARDING_PUBLIC_SUPABASE_URL=http://localhost:4359` and
`ONBOARDING_PUBLIC_SUPABASE_KEY=synthetic-public`. Stop other processes using its
`.next` output before building or starting that preview. With the documented
[disposable database prerequisites](application/database-development.md) and
owned restricted/admin test URLs, run from `apps/api`:

```sh
BROWSER_AUTH_ORIGIN=http://localhost:4359 \
BANKING_DETAIL_BROWSER_ORIGIN=http://localhost:3359 \
BANKING_DETAIL_PLAYWRIGHT_MODULE="$(node -p "require.resolve('@playwright/test')")" \
TEST_DATABASE_URL=<owned-disposable-restricted-role-url> \
TEST_DATABASE_ADMIN_URL=<owned-disposable-admin-url> \
go test -tags=integration -count=1 -run '^TestBankingDetailRealBrowserJourney$' ./internal/graph
```

Use Node 24 on `PATH`; choose distinct owned preview/Auth ports through the same
variables for concurrent worktrees. Keep captures/logs in ignored `test-results/`
or temporary storage. The fixture owns its HTTP/Auth service lifetime; the caller
owns its database and preview teardown. This opt-in journey supplements the
required Chromium suite and does not prove provider or live-release readiness.

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

## Existing bank-connection management against the API

The opt-in `scripts/banking-management-real-browser.sh` owns a unique disposable
Supabase project and invokes its integration-tagged Go/browser bridge. Start an
exclusively owned production preview first, configured with the same loopback
Auth origin as `BROWSER_AUTH_ORIGIN`. Supply the preview's
`BANKING_MANAGEMENT_BROWSER_ORIGIN` and resolve the pinned workspace Playwright
module into `BANKING_MANAGEMENT_PLAYWRIGHT_MODULE`. The runner uses managed
Chromium by default; `BANKING_MANAGEMENT_CHROMIUM` is an optional executable
override for local diagnostics.

The browser forwards GraphQL requests to the authenticated Go handler and real
restricted-role database; only the external provider and browser Auth boundary
are deterministic fixtures. It exercises canceled/finished repair, explicit
selection with a lost response, disconnect/deletion, version-checked replacement,
operation recovery, preceding-plan restoration, archive preservation, worker purge
and a same-group second actor. Its fixture checkpoints can advance only owned
pending work and inspect durable outcomes. They are unavailable in production.
This proves the controlled application contracts, not live provider ordering,
real-institution behavior, backup erasure or production enrollment authority.
Store captures and results outside source, and rerun against the exact candidate
build after relevant changes. Normal database integration runs compile this bridge
but skip its browser launch unless the opt-in environment is explicitly supplied.
