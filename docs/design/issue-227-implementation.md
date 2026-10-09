# Issue #227 corrective design implementation

[Issue #227](https://github.com/haggaikaunda/kami-split/issues/227) is the current
visual authority and inherits the complete production-feature scope of #223.
Use the [pinned reference guide](https://github.com/haggaikaunda/kami-split/blob/3824ce6a878e00d6e417bff8b0e1f7d1988f33e7/docs/design/references/material3/README.md)
and both interactive exports, including their final source-fragment cascade.
The reference commit is `3824ce6a878e00d6e417bff8b0e1f7d1988f33e7`; the ZIP
SHA-256 is `26d02893c8bb6333076a772570c8775f9472d99fa95bf1f64ebf69963d0dad62`.
The [parity matrix](issue-227-parity-matrix.md) records routes, capabilities,
regressions and required evidence. Its rows remain pending. This document records
implementation intent and evidence procedures, not final-head acceptance or
completion of the issue.

## Causes of the earlier divergence

Source inspection at implementation baseline
`a3530b538746185507f6e908d968e1fa38d98d77` found several owning causes:

- #223 deliberately retained DM Sans/Manrope and approximate theme tokens. The
  font loader, semantic colors and typography therefore diverged before any
  individual screen styling was applied.
- The legacy 13rem navigation and 16rem content inset survived. Broad journey
  descendant selectors also affected nested sections, headings, navigation and
  buttons, overriding component intent and creating opaque nested banner panels.
- Workspace composition differed by owner: Group/Trip tabs preceded the banner,
  the overview banner lacked the real Add expense entry, and Account repeated
  identity inside broad nested sections.
- Responsive rules stacked overview metrics but squeezed ledger metrics into
  narrow columns. Global word-breaking and balance-value width limits then
  broke ordinary names and currency strings instead of fixing available space.
- Detail width/type and individually boxed chart legends were approximations;
  chart geometry and colors did not follow the reference's distinct roles.

The remedy belongs in the shared shell, tokens, primitives and owning components.
Adding later overrides around the same competing layout rules would retain the
cause. Historical #223 inventories retain their original findings and test
results, with notices distinguishing them from current authority.

## Corrective implementation

The application now loads local `Roboto.ttf` through `next/font/local` with its
OFL license, swap display, and Arial/sans-serif fallbacks. Body and display share
that font; the default body is 14px/1.5. Shared semantic tokens separately define
Light/Dark canvas, chrome, panel levels, text, accents, summary borders/icons,
category chart colors, and banner/scrim alpha values from the approved source.
Rendered computed values and actual font loading still require verification.

Shared navigation owns the 76px desktop app bar and 88px rail and the phone
header/bottom navigation. Destinations stay Household → Groups → Trips → Account;
workspace tabs stay Overview → Expenses → Balances → Activity → Members below
the banner. The original local artwork and real authorized banner actions remain.
Overview summaries, compact ledger tools/rows, detail/edit presentation, category
Breakdown, Account, forms, activity, members and recovery surfaces use the same
component roles. Production capabilities absent from a sample screenshot remain
required and must use those roles.

Overview requests and displays at most four recent expenses. Structured Household
and Group/Trip ledgers request six rows initially and on Load more. Complete
counts, month/category totals, share/paid values and balances remain authoritative
server projections; no amount is derived from the bounded visible page. Signed
cursor traversal, URL filters, source restoration, exact money, split modes,
account-scoped drafts and original-operation recovery retain their existing
owners. Generated Relay artifacts follow the handwritten query changes.

## Evidence boundaries

| Evidence                                                                       | What it can establish                                                                                                        | What it cannot establish                                                         |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Original interactive reference captures                                        | Exact target composition, theme states and source CSS roles                                                                  | Application behavior or acceptance                                               |
| `visual-parity-browser.cjs` through `visual-parity-fixture.cjs`                | Rendered application layout, fonts, computed styles, matched captures and descriptive overlays/diffs using controlled data   | Real authentication, API authorization, database persistence or final acceptance |
| `visual-parity-interactions.cjs` through the same fixture                      | Supported client filtering/paging, focus/history, theme, draft/recovery and responsive scenarios against synthetic responses | Provider delivery, real committed financial writes or server isolation           |
| Existing application/API/database tests and isolated real-service browser runs | Their recorded financial, authorization, persistence and recovery contracts                                                  | Exact visual parity without inspecting the rendered final build                  |

The fixture is a local development server, not an application route or deployment
mode. It proxies assets from a loopback Next server, terminates all API requests
itself, and maintains synthetic state. Browser runners check its synthetic health
marker before application work. Its expense/profile/appearance responses and
failure scenarios exercise client behavior; group creation, repayment and
onboarding mutations are not complete real-service simulations. Never use these
runners against production or the owner's account. A successful synthetic result
must be labeled accordingly.

## Reproducing development evidence

Use the repository's Node 24/pnpm toolchain. Run from the repository root; set
`NODE_BIN` and `PNPM_BIN` if the executables are not on `PATH`. Playwright and
Sharp may resolve normally or through `PLAYWRIGHT_MODULE` and `SHARP_MODULE`;
`CHROME_PATH` optionally selects an installed Chrome executable. These are local
runtime dependencies, not production application dependencies.

Run required repository checks sequentially. Stop any server using the build
output before building, then start the resulting production build in its own
terminal:

```sh
export NODE_BIN="${NODE_BIN:-node}"
export PNPM_BIN="${PNPM_BIN:-pnpm}"
"$PNPM_BIN" format:check
"$PNPM_BIN" lint
"$PNPM_BIN" typecheck
"$PNPM_BIN" test
"$PNPM_BIN" relay:check
"$PNPM_BIN" build
"$PNPM_BIN" start --hostname 127.0.0.1 --port 3227
```

In a second terminal, start the synthetic fixture. A non-loopback asset upstream
is rejected. Set a reachable host explicitly only for an isolated LAN test:

```sh
NODE_BIN="${NODE_BIN:-node}"
FIXTURE_HOST=127.0.0.1 FIXTURE_PORT=3228 \
FIXTURE_UPSTREAM=http://127.0.0.1:3227 \
  "$NODE_BIN" scripts/visual-parity-fixture.cjs
```

Extract the checksum-verified reference pack. Set `REFERENCE_DIR` to its directory
containing `desktop.html`, `mobile.html` and `source/`; set
`REFERENCE_LUCIDE_PATH` to the exact Lucide UMD dependency identified by that
export. The runner supplies local Roboto and that dependency without rewriting
reference visual styles. Start with Household Overview in all four primary
combinations before extending `SURFACES` or removing it for the full supported
capture inventory:

```sh
export NODE_BIN="${NODE_BIN:-node}"
export EVIDENCE_DIR="${EVIDENCE_DIR:-/tmp/kami-227-evidence}"
export BROWSER_ORIGIN=http://localhost:3228
export WIDTHS=1440,390 THEMES=light,dark SURFACES=household-overview
: "${REFERENCE_DIR:?Set the extracted reference directory}"
: "${REFERENCE_LUCIDE_PATH:?Set the exact reference Lucide UMD file}"
export REFERENCE_DIR REFERENCE_LUCIDE_PATH
REFERENCE_ONLY=1 OUTPUT_DIR="$EVIDENCE_DIR/reference" \
  "$NODE_BIN" scripts/visual-parity-browser.cjs
OUTPUT_DIR="$EVIDENCE_DIR/application" \
  "$NODE_BIN" scripts/visual-parity-browser.cjs
COMPARE_ONLY=1 APP_EVIDENCE_DIR="$EVIDENCE_DIR/application" \
REFERENCE_EVIDENCE_DIR="$EVIDENCE_DIR/reference" \
OUTPUT_DIR="$EVIDENCE_DIR/comparison" \
  "$NODE_BIN" scripts/visual-parity-browser.cjs
OUTPUT_DIR="$EVIDENCE_DIR/interactions" \
  "$NODE_BIN" scripts/visual-parity-interactions.cjs
```

Record the exact application head/build, fixture state, viewport/content bounds,
theme, font, reference state and artifact paths with each result. Comparisons use
unscaled shared extents and record excluded dimensions; numerical differences are
descriptive, not a pass threshold. Inspect screenshots and component styles;
viewport captures and internal scrolling are needed for fixed dialogs. Expand
coverage to 1280/768/320px, 200% text, long names/large amounts, System resolution,
keyboard/focus, failure/recovery and actual LAN startup as the matrix requires.

Final verification, real-service evidence, independent requirements/visual testing,
whole-final-diff review, current CI and canonical delivery closeout remain pending
until their exact evidence is recorded. Consult the [testing strategy](../testing-strategy.md)
and [delivery workflow](../agents/delivery-workflow.md); historical screenshots,
passing fixture assertions or this implementation description cannot close a row.
