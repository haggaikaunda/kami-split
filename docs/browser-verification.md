# Browser verification

Use rendered checks alongside API/database tests. Store outputs in ignored `test-results/` or an external temporary directory and publish relevant results on the delivery PR. Never commit captures or pass/fail reports.

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
marker before application work. Its explicit states exercise client expense/profile/appearance, group/trip creation,
repayment, invitation and onboarding success/failure flows. `no-workspaces`,
`write-success`, `owner-invitations`, `member`, `join-targeted`, `join-shared`,
`single-category` and `tiny-category` provide additional coverage. These are
controlled synthetic responses, not real persistence, delivery or authorization. Never use these
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
export. The runner preserves the original HTML doctype and asserts standards mode,
and supplies local Roboto and that dependency without rewriting reference visual
styles. Start with Household Overview in all four primary
combinations before extending `SURFACES` or removing it for the full supported
capture inventory:

```sh
export NODE_BIN="${NODE_BIN:-node}"
export EVIDENCE_DIR="${EVIDENCE_DIR:-/tmp/kami-visual-checks}"
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
keyboard/focus, failure/recovery and actual LAN startup as the affected feature requires.

The original reference pack and its checksums are linked from [issue #227](https://github.com/haggaikaunda/kami-split/issues/227). It is a design input; current typography, navigation and workspace rules are in the [UI guide](application/ui.md).
