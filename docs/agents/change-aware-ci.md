# Change-aware CI and production releases

Issue [#214](https://github.com/haggaikaunda/kami-split/issues/214) owns the
GitHub classifier. `scripts/ci/changes.mjs` is the shared affected-path contract;
CI and trusted production selection call the same implementation.

## Dependency contract

| Paths                                                                                                                                | Required consumers                    |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `apps/web/**`, `scripts/relay/**`                                                                                                    | Web                                   |
| `apps/api/**`, `supabase/**`, `compose*.yaml`, `sqlc.yaml`, `.dockerignore`, Go module/workspace files                               | API                                   |
| Database/tool installation/Cloud Run traffic scripts, `scripts/tool-versions.env`                                                    | API                                   |
| `packages/schema/**`, root dependency/workspace/lock/config files, `Makefile`                                                        | Both                                  |
| Workflows, deployment scripts, classifier/gate scripts, unknown paths                                                                | Both (conservative)                   |
| `AGENTS.md` at any depth, root README/CONTRIBUTING, app/schema READMEs, issue/PR templates, Markdown and static images under `docs/` | Repository validation only            |
| Executable documentation, including `docs/**/*.ts(x)`                                                                                | Both (root TypeScript/lint consumers) |

The documentation exceptions are evaluated first. File extensions outside those
explicit locations do not establish non-runtime status. Unknown paths require
both consumers; add narrower categories only after tracing imports, generation,
installation, Docker contexts, and verification commands. Add representative
regression cases to `scripts/ci/changes.test.mjs` with every contract extension.
Deletions and both sides of renames are classified (`--no-renames`, NUL-delimited).
Empty comparisons, unavailable commits, non-ancestor push history, first pushes,
and classification exceptions select both consumers. No GitHub API file-list
pagination or changed-file count limit can silently truncate the diff.

## Verification topology

`CI` still runs for every PR and every push to `main`, with read-only permissions.
PR comparisons use the event's actual base/head merge base; pushes use the actual
`before` and `after`, including every commit in a multi-commit push. Full checkout
history supplies the objects; missing history falls back to both consumers.
PR code runs only in unprivileged CI, never in `pull_request_target`.

The repository job classifies changes, checks repository-wide formatting, and
runs classifier/gate tests. It installs pinned workspace dependencies with scripts
disabled; it does not build the web application or start Go, Docker, or databases.
The Web and API reusable workflows have caller-level conditions, so an unaffected
branch never allocates its expensive runner jobs. The API source/database/runtime
checks stay together: this change does not narrow verification within a service.
A failed repository job also requests both consumers, while still failing `Verify`.

`Verify` retains its exact required name and runs with `always()`. It requires a
successful repository job, a literal applicability boolean, and either success
for applicable work or an intentional `skipped` result for inapplicable work.
Failure, cancellation, missing outputs, and unexpected skips cannot pass. PR
concurrency cancels superseded runs; main runs remain non-canceling. Results are
scoped to the same workflow run, never reused from an earlier head.

The classifier must precede dependent jobs, while `Verify` must follow them, so
combining those jobs would create a dependency cycle. Repository validation makes
the classification runner useful. Keep the small final gate despite minute
rounding; the primary savings come from avoiding unaffected runners.

## Production boundary and #161

`Production deployment` starts only after successful main-push CI. Its classifier
and status publisher are checked out from `github.workflow_sha` (trusted workflow
code), never from a candidate or a CI artifact. The deployment target is always
`workflow_run.head_sha`; ambient `GITHUB_SHA` is not the target. A stale queued
run whose target is no longer main fails selection, preventing a delayed older
CI completion from rolling back a newer release. Retry the newest successful
main CI when selection fails; do not force promotion of an old target.

Production collects paths from every first-parent transition since the nearest
ancestor whose
latest `kami-split/api-release` commit status is an authenticated
`github-actions[bot]` success with a recognized description. That status is
published only after **both applicable release branches** succeed. Collecting
intermediate changes also catches reverts of a failed release that had already
promoted one service; a net endpoint diff would incorrectly omit that restoration.
This retains
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
  changes and any applicable legacy web release succeeded;
- `failure`: selection or any required release failed, cancelled, or unexpectedly
  skipped. A hard cancellation that prevents publication leaves pending, never
  success.

#161 is still open: Vercel Git integration and its Deployment Check are **not
configured by this change**. The current GitHub-owned web deployment remains until
that migration is proven. It runs only when affected and accepts
`PRODUCTION_API_ORIGIN` when the API release is intentionally skipped. That
Production variable must be configured before a web-only release; omission fails
closed. There is no fake Cloud Run deployment to unblock web.

When #161 removes the legacy web job, update the final status dependencies to
cover only selection and API, and retain this exact-SHA status contract. Vercel's
check must require this context on its own deployment SHA; missing/pending/failure
must hold domain assignment. An explicit not-required success is sufficient for
a web-only build. Vercel-native filtering remains #161's responsibility; this
change does not install a competing Vercel ignore command.

## Verification

Run `node --test scripts/ci/*.test.mjs` locally. Tests cover path dependencies,
real Git histories, adversarial job results, authenticated baselines, and failed
release carry-forward. These tests do not constitute hosted runner-allocation or
provider deployment evidence.

Hosted allocation and deployment results belong on [#214](https://github.com/haggaikaunda/kami-split/issues/214) and its PRs. Local classifier tests do not prove provider configuration or complete the separate #161 migration.
