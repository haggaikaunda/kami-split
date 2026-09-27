# Testing strategy

Tests demonstrate behavior rather than mirror implementation. The current system is a browser UI over an asynchronous in-memory adapter; the Go API is a health-only scaffold without database, migrations, or real authentication. See [API verification](../apps/api/README.md) for HTTP/lifecycle tests and `make api-check`.

## Current coverage

- **Domain tests:** exact minor-unit parsing/allocation, multi-member conservation, direct obligations, repayment effects, currencies, effective dates, trip aggregation and truthful chart buckets.
- **Adapter tests:** access simulations, immutable snapshots/audits, atomic mock commands, versions/conflicts, same-request idempotency, duplicate payload rejection, before/after-commit failures, membership and setup boundaries.
- **Component integration tests:** React/jsdom with actual providers for navigation/drafts, forms, revisions, deletion, repayment, filtered history, charts, trips, entry and household management. Mocks replace browser/framework facilities where necessary; these are not real browser tests.
- **Automated accessibility:** 24 axe-backed cases in `apps/web/src/components/accessibility.test.tsx`. Only color contrast is disabled because jsdom cannot evaluate rendered layout. Contrast calculations, real focus behavior, target geometry and reflow have separate evidence.
- **LAN compatibility:** helper and actual-provider tests remove `crypto.randomUUID` while retaining cryptographic `getRandomValues`; verify UUID format, distinct visits, stable draft IDs and duplicate-safe deletion/household recovery.
- **Manual browser acceptance:** actual app interactions recorded in feature PRs and the [final report](accessibility/README.md), with a [criterion matrix](accessibility/criterion-matrix.md) for P01–P10/N01–N07. The LAN origin was additionally verified through rendered overview and add/preserve/resume/save in [PR #51](https://github.com/haggaikaunda/kami-split/pull/51).

The baseline after PR #51 is **325 passing tests in 54 files** (September 26, 2026). Earlier reports retain their at-the-time counts. There is no checked-in automated browser E2E runner; `pnpm test` runs Vitest, not the manual acceptance walkthroughs.

## Required commands

Use Node 24 and the pnpm version pinned in `package.json`, then run sequentially:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For a focused regression, use `pnpm test src/lib/ledger.test.ts` (paths are relative to `apps/web`). Avoid running type checking and build concurrently because Next.js generates types. Stop a production preview before rebuilding its `.next` output; restart and reload before continuing browser verification.

## Browser evidence and limits

Use equivalent seed/clock and viewport when comparing the frozen reference with the app. Exercise actual mutations and inspect totals/revisions/events; a toast, screenshot or HTTP 200 alone is not sufficient. Verify localhost and the actual LAN HTTP origin for phone-preview changes. Default seed clock is September 20, 2026, independent of the wall clock.

The final pass covers 320/390/768/1280px, actual 200% root text, keyboard dialogs and focus restoration, dirty resizing, exact data tables, filtered origins, Back/Forward, repeated record sources, chart mutation return and unavailable/tombstone routes. Physical iOS/Android keyboard/notch and spoken VoiceOver/TalkBack output were not tested. Browser accessibility-tree review, reduced-height simulation and safe-area CSS inspection are explicitly scoped substitutes. Reduced-motion CSS was inspected; OS preference emulation was not claimed.

## Future production coverage

A real backend needs additional authenticated API, cross-user/household denial, persistence, migration, transaction, concurrency, idempotency and durable-audit tests. Existing simulation coverage does not satisfy those production security gates. Percentage splits are not implemented; test them only if separately approved and added.

Every change still requires independent acceptance-criteria testing and a separate final-diff review, with findings resolved and current-head CI passing as described in the [workflow](agents/delivery-workflow.md).
