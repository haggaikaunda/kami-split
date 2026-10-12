# Historical refresh verification (#243)

This records the #243 implementation before #269 removed routine in-app Refresh
controls. Current gesture/reload behavior is described in
[workspace loading](workspace-loading.md#refresh-and-loading-continuity-243); the
updated browser suite verifies native reload and gesture/foreground boundaries.

The opt-in `scripts/refresh-browser.cjs` suite runs inside the existing
`navigation-browser.cjs` synthetic Auth/GraphQL harness. It exercises rendered
production Group and Household Expenses on the actual LAN HTTP origin, with
700ms response delays and a long expense fixture. No live account or financial
records are accessed.

| Viewport | Root text | Saved appearance | System appearance | Result |
| -------- | --------- | ---------------- | ----------------- | ------ |
| 390px    | 100%      | Light            | Light             | Passed |
| 320px    | 200%      | Dark             | Light             | Passed |
| 1440px   | 100%      | Dark             | Light             | Passed |
| 1440px   | 200%      | System           | Dark              | Passed |

Each Group and Household run verifies:

- A single labeled non-header refresh action, keyboard activation and retained focus.
- Repeated Enter coalescing, pending/completion status and prior loading height.
- Browser-dispatched touch input from the document top, one request and no document reload.
- Ordinary downward scrolling below the top does not refresh.
- Applied filter URL remains unchanged through refresh and retry.
- Offline failure hides rows, shows an error and permits a successful retry.
- Unsaved expense description survives foreground authorization revalidation.
- Revoked reads expose neither cached expense rows nor a fabricated empty result.
- No horizontal overflow, including doubled root text; Light/Dark/System token application.

The runner writes JSON evidence and rendered screenshots to `OUTPUT_DIR`. Final
head, command outcomes and independent testing/review are recorded on the PR.
Unit/component tests additionally cover WebKit/unsupported fallback, cancellation,
multitouch/horizontal/interactive/nested-scroll exclusions, actual Relay disposal,
account/source isolation, original-attempt recovery and pending/failed filtered
Activity status.

## Evidence limits

Browser input runs in desktop Chromium with touch enabled. It establishes browser
hit testing and application gesture behavior, not physical iOS/Android native
pull behavior. Safari/WebKit deliberately uses native refresh with no app gesture
listener, plus the same keyboard/tap fallback. Native hardware, hardware assistive
technology, real provider availability and backend authorization are outside this
synthetic browser suite. Existing server authorization checks are unchanged.
