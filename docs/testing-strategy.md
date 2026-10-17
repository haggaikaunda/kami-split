# Testing strategy

Tests demonstrate current behavior rather than mirror implementation. The web has one authenticated Relay/GraphQL runtime; configured onboarding connects real Auth/API services. The seeded adapter, snapshot model and simulation-only component tests were retired in #184. See [API verification](../apps/api/README.md) and [database development](application/database-development.md).

## Current coverage

- **Financial contracts:** exact decimal-string/minor-unit parsing, allocation validation, complete group balances, persisted expense/repayment and original-attempt recovery.
- **Component integration:** real production Group/Trip/Household workspaces, structured Expenses and source-aware details, Activity, onboarding, repayment forms and actor-scoped session cancellation. Framework/network mocks in jsdom do not prove server authorization or real browser layout.
- **Shared accessibility:** primitive keyboard/dialog/focus tests and workspace semantic tests; production rendered browser evidence covers responsive layout and text resizing. Retired axe cases for the seeded application are historical evidence only.
- **LAN compatibility:** cryptographic session-ID fallback remains tested and used by current scoped navigation and production financial forms.
- **API/database:** verified JWT identity, runtime-role cross-user/group denial, migrations/permissions, lifecycle races, exact-money conservation, atomic audit/results, signed cursors, concurrent recovery and dump/replay against disposable Supabase/PostgreSQL.
- **Real-browser acceptance:** feature delivery PRs record current route and interaction evidence. Historical seeded acceptance lives on [#31](https://github.com/haggaikaunda/kami-split/issues/31).

`pnpm test` runs Vitest. `pnpm test:browser` builds and runs the required isolated Chromium smoke suite; install its managed browser as described in [browser verification](browser-verification.md). CI reuses its immediately preceding production build. Default-deny proxy and browser-boundary suites cover cold HTML/Flight denial, cookies, failed/expired verification, safe return paths, logout and history restoration. The opt-in `scripts/auth-boundary-browser.cjs` adds desktop/mobile synthetic end-to-end checks; see [web authentication routing](application/web-auth-routing.md#verification). The opt-in `scripts/navigation-browser.cjs` production-browser regression harness uses synthetic Auth/GraphQL fixtures; run instructions and limitations are in the [workspace loading guide](navigation/workspace-loading.md). It complements real API/database authorization tests and is not part of the default test command. Optional harnesses and their synthetic-versus-real-service limits are explained in [browser verification](browser-verification.md).

## Required commands

The [local execution entry point](agents/execution.md) checks prerequisites and
runs these commands serially, adding classifier-selected browser/API checks and
always retaining repository validation. It does not replace isolated container CI
or independent acceptance testing/review.

Use Node 24 and the pnpm version pinned in `package.json`, then run sequentially:

```bash
pnpm relay:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For a focused regression, use `pnpm test src/lib/relay/money.independent.test.ts` (paths are relative to `apps/web`). Avoid running type checking and build concurrently because Next.js generates types. Stop a production preview before rebuilding its `.next` output; restart and reload before continuing browser verification.

For the API and persistence baseline, also run from the repository root:

```sh
make api-check
make db-generation-check
make db-test
```

`make api-check` verifies Go formatting, module integrity, vet, regular/race tests, build and gqlgen drift. `make db-generation-check` verifies sqlc output. `make db-test` creates a disposable Supabase stack, verifies migrations and permissions, runs integration-tagged tests with the race detector, and verifies financial dump/replay. Packages run serially because permission probes temporarily mutate cluster-global login-role state; concurrency scenarios still run within their tests. Do not replace these checks with a regular Go run that excludes integration-tagged tests. CI also verifies the container, Compose readiness and live health GraphQL response; see the [delivery workflow](agents/delivery-workflow.md).

## Browser evidence and limits

Exercise real authenticated routes and inspect persisted results, source context and fresh access checks; a toast, screenshot or HTTP 200 alone is insufficient. Verify 320/390px, actual 200% root text, keyboard/focus, Back/Forward, source filters, group repayment, account switch, and retired-route not-found behavior. Use the actual LAN HTTP origin for phone-related changes. Physical assistive technology and provider/production limitations must be recorded explicitly.

## Remaining integration and feature coverage

Financial browser Relay acceptance under #83 is recorded on its delivery PR; onboarding procedures are documented in its guide; actual acceptance lives on its delivery PR. Expense editing coverage includes version/recovery, immutable Activity, former-member locks and real restricted-role/race scenarios. Expense deletion, imports and hosted production operations remain separate work. Historical UI simulations do not satisfy those future security or durability gates. Percentage splits are implemented under #199; shared Go/TypeScript vectors, domain properties, real database persistence/replay constraints and independent form tests cover the [percentage contract](application/percentage-splits.md). Required final-head browser and CI evidence is recorded on the delivery PR.

Every change still requires independent acceptance-criteria testing and a separate final-diff review, with findings resolved and current-head CI passing as described in the [workflow](agents/delivery-workflow.md).

## Invitation onboarding regression coverage

The onboarding component suite preserves account-switch/unmount cancellation, same-request recovery, cross-tab digest binding, and owner delivery uncertainty. Issue #164 adds anonymous targeted preview, explicit new/existing target continuation, password confirmation, shared email-only account start, automatic account group loading, and direct real-group success navigation. Provider and restricted database tests remain the authorization evidence; component mocks do not prove mailbox ownership or live eligibility. Browser acceptance additionally exercises real callback restoration, keyboard/focus, 320/390px layouts, doubled text and reduced motion.

Issue #164 onboarding verification covers modern/legacy Auth headers, targeted `generate_link`/OTP continuation without extra mail, shared-link Mailpit verification and callback recovery, explicit admission, and durable concurrent claim/replay/resend denial. The disposable Supabase tests use synthetic recipients and do not substitute for authorized hosted rehearsal evidence.

Run outputs belong in ignored `test-results/` or an external temporary directory. Do not commit screenshots, logs, exact-head reports or frozen pass totals. Physical-device/screen-reader coverage and live-provider checks are not implied by synthetic browser or jsdom tests; record the actual limits on each PR.
