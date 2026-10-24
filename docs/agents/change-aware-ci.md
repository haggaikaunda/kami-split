# Change-aware CI and production releases

`scripts/ci/changes.mjs` is the single trusted affected-path contract, established
in [#214](https://github.com/haggaikaunda/kami-split/issues/214) and refined in
[#296](https://github.com/haggaikaunda/kami-split/issues/296). It returns four
literal booleans: `verify_web`, `verify_api`, `deploy_web`, and `deploy_api`.
CI uses only verification decisions; production uses deployment decisions over
its cumulative release range. Deployment implies verification for that consumer.
Missing, non-boolean or inconsistent decisions cannot authorize a skipped release.

## Dependency contract

Repository validation and the required `Verify` gate always run. Rules below are
ordered; a test exemption precedes its application's production rule.

| Paths / rule                                                                                                                         | Verification    | Deployment | Dependency evidence                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proven inert documentation / `inert-documentation`                                                                                   | Repository only | Neither    | `AGENTS.md` at any depth; root README/CONTRIBUTING; app/schema READMEs; issue/PR templates; Markdown/static images under `docs/`. No production imports/build inputs.                                                                                                                                                               |
| Explicit synthetic browser inventory / `web-verification-tooling`                                                                    | Web             | Neither    | `playwright.config.mjs` starts `scripts/browser/auth-server.mjs` and the web preview; `tests/browser/{data,fixtures,smoke.spec,activity.spec,members.spec}.mjs` use synthetic GraphQL/Auth. Exact known runners/helpers in `changes.mjs` are consumed by local frontend browser passes; new filenames retain fallback until traced. |
| Explicit `docs/primitives-preview` gallery files / `web-verification-tooling`                                                        | Web             | Neither    | Root ESLint and `tsconfig.docs.json` check TypeScript examples/shims. The standalone Vite gallery imports web primitives/public assets; the production app does not import the gallery. Other executable documentation remains conservative.                                                                                        |
| `apps/web/src/**/*.test.ts(x)` outside `src/pages/`, `src/lib/relay/test-queries.tsx`, `apps/web/vitest.config.ts` / `web-unit-test` | Web             | Neither    | Vitest, lint and type checking consume these files; production routes/modules and Relay generation must not consume them. Pages Router filenames can be runtime routes even with test suffixes and remain deployable. Boundary tests enforce current literal runtime references and GraphQL tags; see below.                        |
| `apps/api/**/*_test.go`, `supabase/tests/*.sql` / `api-test`                                                                         | API             | Neither    | Go excludes test source from `go build ./cmd/server`; SQL assertions are read by `scripts/db-test.sh`, outside migration/schema/sqlc inputs. Docker copies API source but its runtime stage builds only the server. Embed guards prevent test source from becoming binary data.                                                     |
| `scripts/{edit-real-browser,percentage-real-browser,browser-auth-fixture}.cjs` / `api-browser-integration`                           | Both            | Neither    | Go integration tests invoke the real-browser runners against disposable API/database fixtures; the shared Auth helper also serves synthetic runners. Preserve API coverage; opt-in live-browser passes still need their documented local environment.                                                                               |
| `apps/web/src/lib/relay/__generated__/*.graphql.ts` / `relay-wire-contract`                                                          | Both            | Web        | API transport-budget and workspace integration tests read checked-in wire operations. These artifacts ship in web, not the Go server image.                                                                                                                                                                                         |
| Other `apps/web/**`, `scripts/relay/**` / `web-production`                                                                           | Web             | Web        | Next build/runtime and Relay generation. Authored operations/config are web inputs; `relay:check` requires changed compiled output to be committed, then the wire-contract rule selects API verification. Ownership-only moves with unchanged wire output need no API verification.                                                 |
| Other `apps/api/**`, `supabase/**`, Compose, sqlc, `.dockerignore`, Go module/workspace files / `api-build-runtime`                  | API             | API        | API build, database schemas/migrations and local runtime configuration.                                                                                                                                                                                                                                                             |
| Database/tool installation/Cloud Run traffic scripts and `scripts/tool-versions.env` / `api-build-runtime`                           | API             | API        | Some are verification-only today, but these broader runtime/tool families retain conservative deployment treatment; no blanket script/test-name exemption.                                                                                                                                                                          |
| `packages/schema/**`, root dependencies/workspace/lock/config, `Makefile` / `shared-input`                                           | Both            | Both       | Shared authoritative contracts, generation and installation/build entry points. Schema testdata stays conservative.                                                                                                                                                                                                                 |
| Workflows, deployment/classifier/gate scripts, Vercel promotion tooling / `delivery-tooling`                                         | Both            | Both       | Trusted selection, release orchestration and safety checks.                                                                                                                                                                                                                                                                         |
| Everything else / `unknown-path`                                                                                                     | Both            | Both       | Unresolved dependencies select all consumers.                                                                                                                                                                                                                                                                                       |

The Activity browser spec imports only Playwright test fixtures and the existing
synthetic GraphQL data helper. It is discovered by the required Chromium suite;
Next, Relay generation, the Go API and production release tooling do not import it.
Its test-only edits therefore select web verification without deployment.

The exact synthetic/gallery inventory lives only in the classifier; workflows do
not maintain competing glob lists. Naming something `test`, `browser`, or `fixture`
is not enough to exempt it. Before extending a rule, trace imports, generators,
package commands, Docker copy/build stages and all verification consumers, add
regressions, and update this dependency rationale. Deployment paths or generators
must never load exempt test/tooling files. `test-boundaries.test.mjs` checks literal
web imports/re-exports/dynamic imports/requires/file URLs (including `@/`), rejects
Relay tags in exempt test files and checks Go embed patterns against exempt files.
These guards cover current loaders, not arbitrary dependency analysis: new dynamic
loaders, aliases, generators, embed conventions or runtime imports require an audit
and appropriate boundary coverage before keeping an exemption.

The exact known skill Markdown/template (including `evaluate-deliveries`), native role TOML, optional stage-event JSON and
Python validator/requirements files in `agent-validation-resource` require only
repository validation. Skills/profiles are agent-runtime inputs; Python validation
reads the skills, schema and example, and its tests run in the repository job.
None is imported by Next, Relay generation, the Go server or release tooling.
`agent-execution-tooling` selects web verification for the two JavaScript helper
files because root ESLint consumes them; their deterministic tests also run in
the always-on repository job. Neither rule selects deployment. Unknown adjacent
files stay conservative, including new skills, profile names and executable
resources. There is no blanket `.agents/**` exemption.

The API Dockerfile copies only API/schema source before compiling the server;
the root `.dockerignore` excludes agent tooling. Boundary tests guard actual
production references and Docker COPY inputs. New copy syntax/loaders require
review before preserving these exemptions. Changes to the classifier, workflows
or deployment scripts themselves still select all checks and deployments.

Deletions and both sides of renames are classified (`--no-renames`, NUL-delimited).
Empty comparisons, unavailable commits, non-ancestor push history, first pushes,
and classification exceptions select all four decisions. No GitHub API file-list
pagination or changed-file count limit can silently truncate the diff.

## Decision diagnostics

Existing classification jobs emit one JSON diagnostic with the four decisions,
compared SHAs, PR merge base or cumulative release range, authenticated baseline
and target, matched rule/path samples, aggregate rule counts, and fixed fallback
reasons. Release planning identifies `workflow_run.head_sha` and the carry-forward
range before examining transitions. At most 60 events and 240 characters per path
are retained; omitted-event counts and all fallback reasons remain visible.
Diagnostics contain repository paths and commit identities, not file contents,
credentials, application records or raw subprocess errors. No reporting runner is
allocated. Unknown paths and unavailable history are distinguishable from known
frontend tooling and outstanding runtime work.

## Verification topology

`CI` still runs for every PR and every push to `main`, with read-only permissions.
PR comparisons use the event's actual base/head merge base; pushes use the actual
`before` and `after`, including every commit in a multi-commit push. Full checkout
history supplies the objects; missing history falls back to both consumers.
PR code runs only in unprivileged CI, never in `pull_request_target`.

The lightweight classification job runs alongside repository validation. The
repository job checks repository-wide formatting, runs
classifier/gate and execution-helper tests and the [pinned skill/resource validation](skill-authoring.md#objective-checks-from-a-fresh-checkout).
Skill validation uses an isolated Python environment; it does not execute skill
procedures. It installs pinned workspace dependencies with scripts
disabled; it does not build the web application or start Go, Docker, or databases.
The Web and API reusable workflows consume `verify_web` / `verify_api` in caller-level conditions, so an unaffected
branch never allocates its expensive runner jobs. The API source/database/runtime
checks stay together: this change does not narrow verification within a service.
A failed classification job also requests both consumers, while still failing `Verify`.
Repository validation can fail independently while application verification runs;
its success remains mandatory at the final gate.

`Verify` retains its exact required name and runs with `always()`. It requires a
successful classification and repository jobs, a literal applicability boolean, and either success
for applicable work or an intentional `skipped` result for inapplicable work.
Failure, cancellation, missing outputs, and unexpected skips cannot pass. PR
concurrency cancels superseded runs; main runs remain non-canceling. Results are
scoped to the same workflow run, never reused from an earlier head.

The classifier must precede dependent jobs, while `Verify` must follow them.
Application jobs begin after lightweight classification without waiting for
repository formatting, Python setup or skill validation. The small final gate
still requires every applicable result from the same run.

## Production boundary and #161

`Production deployment` starts only after successful main-push CI. Its classifier
and status publisher are checked out from `github.workflow_sha` (trusted workflow
code), never from a candidate or a CI artifact. The deployment target is always
`workflow_run.head_sha`; ambient `GITHUB_SHA` is not the target. A stale queued
run whose target is no longer main fails selection, preventing a delayed older
CI completion from rolling back a newer release. Retry the newest successful
main CI when selection fails; do not force promotion of an old target.

Production unions `deploy_web` / `deploy_api` from every first-parent transition since the nearest
ancestor whose
latest `kami-split/api-release` commit status is an authenticated
`github-actions[bot]` success with a recognized description. That status is
published only after **both applicable release branches** succeed. Collecting
intermediate changes also catches reverts of a failed release that had already
promoted one service; a net endpoint diff would incorrectly omit that restoration.
Test-only transitions still select their verification consumers but do not add
release obligations. A no-deployment success is a baseline only after cumulative
planning has excluded all pending runtime work and both release results match
the explicit plan. This retains
unreleased API changes after a failed API release and unreleased web changes after
a failed legacy-web release. The search is bounded to 100 ancestors; absent
history, no baseline, API lookup failures, or ambiguous classification selects
both releases. The first deployment of this implementation therefore releases
both services to establish a baseline. Commits after an outstanding failure can
require deployment even if their own immediate diff is documentation-only.

The existing API workflow still owns ordered migrations, immutable images,
zero-traffic candidates, readiness probes, and promotion. No release mechanics or
production credentials are weakened. The production concurrency group remains
serialized and non-canceling, shared with rehearsal and cleanup.

The exact-target status is pending during selection, then:

- `success` / `API release succeeded`: the required API release and any applicable
  legacy web release succeeded;
- `success` / `API release not required`: classification explicitly excluded API
  deploy-affecting changes and any applicable legacy web release succeeded;
- `failure`: selection or any required release failed, cancelled, or unexpectedly
  skipped. A hard cancellation that prevents publication leaves pending, never
  success.

#161 is still open: Vercel Git integration and its Deployment Check are **not
configured by this change**. The current GitHub-owned web deployment remains until
that migration is proven. It runs only when affected and accepts
`PRODUCTION_API_ORIGIN` when the API release is intentionally skipped. That
Production variable must be configured before a web-only release; omission fails
closed. There is no fake Cloud Run deployment to unblock web.

When #161 removes the legacy web job, consume the same `deploy_web` decision for
provider filtering and `deploy_api` for the exact-SHA gate; never substitute
verification booleans. Update the final status dependencies to cover only
selection and API. Establish separate authenticated web-success/baseline ownership
before that change: API-only status success must not erase pending failed Vercel
work. Retain cumulative transitions and revert restoration per service without
making the API status wait for Vercel's status-dependent promotion. Vercel's
check must require this context on its own deployment SHA; missing/pending/failure
must hold domain assignment. An explicit not-required success is sufficient for
a web-only build. Vercel-native filtering remains #161's responsibility; this
change does not install a competing Vercel ignore command.

## Verification

Run `node --test scripts/ci/*.test.mjs` locally. Tests cover path dependencies,
real Git histories, adversarial job results, authenticated baselines, and failed
release carry-forward. These tests do not constitute hosted runner-allocation or
provider deployment evidence.

Hosted allocation and deployment results belong on the owning issue ([#214](https://github.com/haggaikaunda/kami-split/issues/214) or [#296](https://github.com/haggaikaunda/kami-split/issues/296)) and its PRs. Local classifier tests do not prove provider configuration or complete the separate #161 migration.

The integrated browser inventory also includes `scripts/banking-detail-real-browser.cjs`, driven by its opt-in Go private-detail HTTP/database fixture.
