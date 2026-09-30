# Testing strategy

Tests demonstrate behavior rather than mirror implementation. Financial browser previews use an asynchronous in-memory adapter; real onboarding uses configured Auth/API services. The Go API separately implements verified authentication, persisted expense creation/recovery and authorized balance/read operations, plus internal targeted invitation/admission/delivery recovery. These paths have real Supabase/PostgreSQL integration coverage. [Public onboarding](application/onboarding.md) has actual provider/HTTP integration and browser coverage. The [authenticated Relay journey](application/relay-expenses.md) adds real financial browser integration (#83); mock financial UI tests do not demonstrate its completion. See [API verification](../apps/api/README.md) and [database development](application/database-development.md).

## Current coverage

- **Domain tests:** exact minor-unit parsing/allocation, multi-member conservation, direct obligations, repayment effects, currencies, effective dates, trip aggregation and truthful chart buckets.
- **Adapter tests:** access simulations, immutable snapshots/audits, atomic mock commands, versions/conflicts, same-request idempotency, duplicate payload rejection, before/after-commit failures, membership and setup boundaries.
- **Component integration tests:** React/jsdom with actual providers for navigation/drafts, forms, revisions, deletion, repayment, filtered history, charts, trips, entry and household management. Mocks replace browser/framework facilities where necessary; these are not real browser tests.
- **Automated accessibility:** 24 axe-backed cases in `apps/web/src/components/accessibility.test.tsx`. Only color contrast is disabled because jsdom cannot evaluate rendered layout. Contrast calculations, real focus behavior, target geometry and reflow have separate evidence.
- **LAN compatibility:** helper and actual-provider tests remove `crypto.randomUUID` while retaining cryptographic `getRandomValues`; verify UUID format, distinct visits, stable draft IDs and duplicate-safe deletion/household recovery.
- **API behavior:** HTTP lifecycle/readiness, verified JWT/JWKS request identity, safe errors, exact-money rules, canonical operation inputs, signed cursors and authenticated GraphQL operations.
- **Real database integration:** migration upgrade/fresh replay and desired-schema/ACL comparison, runtime-role and cross-user/group denial, transaction-local identity cleanup, revocation/ownership locks, atomic expense/allocation/audit/result writes, duplicate and mismatch recovery, complete balances, pagination, rollback and response/COMMIT uncertainty, and financial dump/replay.
- **Internal invitations:** capability preview/eligibility, actor-bound admission, current provider email evidence, lifecycle races, durable delivery recovery, and maintenance cleanup against actual local Supabase/PostgreSQL. The onboarding suite additionally connects actual provider emails, callback state, owner HTTP operations and admission.
- **Manual browser acceptance:** actual app interactions recorded in feature PRs and the [final report](accessibility/README.md), with a [criterion matrix](accessibility/criterion-matrix.md) for P01–P10/N01–N07. The LAN origin was additionally verified through rendered overview and add/preserve/resume/save in [PR #51](https://github.com/haggaikaunda/kami-split/pull/51).

The web baseline after PR #51 is **325 passing tests in 54 files** (September 26, 2026). Earlier reports retain their at-the-time counts. There is no checked-in automated browser E2E runner; `pnpm test` runs Vitest, not the manual acceptance walkthroughs.

## Required commands

Use Node 24 and the pnpm version pinned in `package.json`, then run sequentially:

```bash
pnpm relay:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For a focused regression, use `pnpm test src/lib/ledger.test.ts` (paths are relative to `apps/web`). Avoid running type checking and build concurrently because Next.js generates types. Stop a production preview before rebuilding its `.next` output; restart and reload before continuing browser verification.

For the API and persistence baseline, also run from the repository root:

```sh
make api-check
make db-generation-check
make db-test
```

`make api-check` verifies Go formatting, module integrity, vet, regular/race tests, build and gqlgen drift. `make db-generation-check` verifies sqlc output. `make db-test` creates a disposable Supabase stack, verifies migrations and permissions, runs integration-tagged tests with the race detector, and verifies financial dump/replay. Packages run serially because permission probes temporarily mutate cluster-global login-role state; concurrency scenarios still run within their tests. Do not replace these checks with a regular Go run that excludes integration-tagged tests. CI also verifies the container, Compose readiness and live health GraphQL response; see the [delivery workflow](agents/delivery-workflow.md).

## Browser evidence and limits

Use equivalent seed/clock and viewport when comparing the frozen reference with the app. Exercise actual mutations and inspect totals/revisions/events; a toast, screenshot or HTTP 200 alone is not sufficient. Verify localhost and the actual LAN HTTP origin for phone-preview changes. Default seed clock is September 20, 2026, independent of the wall clock.

The final pass covers 320/390/768/1280px, actual 200% root text, keyboard dialogs and focus restoration, dirty resizing, exact data tables, filtered origins, Back/Forward, repeated record sources, chart mutation return and unavailable/tombstone routes. Physical iOS/Android keyboard/notch and spoken VoiceOver/TalkBack output were not tested. Browser accessibility-tree review, reduced-height simulation and safe-area CSS inspection are explicitly scoped substitutes. Reduced-motion CSS was inspected; OS preference emulation was not claimed.

## Remaining integration and feature coverage

Financial browser Relay acceptance under #83 is recorded on its delivery PR; onboarding acceptance is documented in its guide. Expense editing/deletion, settlements, imports, and hosted production operations remain outside the implemented API baseline and require their own approved tests. Existing UI simulations do not satisfy those future security or durability gates. Percentage splits are not implemented; test them only if separately approved and added.

Every change still requires independent acceptance-criteria testing and a separate final-diff review, with findings resolved and current-head CI passing as described in the [workflow](agents/delivery-workflow.md).
