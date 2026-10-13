# Browser verification

Use rendered checks alongside API/database tests. Store outputs in ignored `test-results/` or an external temporary directory and publish relevant results on the delivery PR. Never commit captures or pass/fail reports.

## Current authentication and component runners

Use Node 24 and pinned pnpm. Playwright resolves normally or through `PLAYWRIGHT_MODULE`; `CHROME_PATH` optionally selects installed Chrome. These are local test dependencies, not application dependencies. Run the normal checks and build sequentially; stop a production preview before rebuilding its output.

```sh
pnpm build
node scripts/auth-boundary-browser.cjs
```

The Auth-boundary runner starts its own synthetic Auth and production Next servers on loopback, default ports 3196 and 3195. It checks actual cookie/server routing, cold HTML/Flight denial, safe continuation, sign-out/history and onboarding on desktop/mobile. See [web authentication routing](application/web-auth-routing.md#verification) for setup and limits.

The account, appearance, navigation and percentage synthetic runners use `browser-auth-fixture.cjs`. Start an isolated production preview with `ONBOARDING_PUBLIC_SUPABASE_URL=http://localhost:3196` and `ONBOARDING_PUBLIC_SUPABASE_KEY=synthetic-public`, choose that runner's `PORT`/`ORIGIN`/`BROWSER_ORIGIN` as documented in its source, then run one fixture at a time. A custom `BROWSER_AUTH_ORIGIN` must be loopback and match the Next Auth URL. Never point these fixtures at production or a real account.

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
