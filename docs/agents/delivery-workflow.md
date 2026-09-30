# Delivery workflow

This is the canonical process for all repository changes: web, API, schema, infrastructure, and documentation. The root [AGENTS.md](../../AGENTS.md) summarizes mandatory policy. Area instructions add verification requirements; they do not replace this loop.

## Pull request lifecycle

1. **Ready issue:** scope, acceptance criteria, exclusions, and test notes are clear.
2. **Builder:** implements the smallest complete solution in a worktree, opens a draft PR, and records the convention self-check below before requesting final review.
3. **CI:** deterministic formatting, linting, type checking, unit tests, and build checks pass.
4. **Tester:** independently compares the behavior and tests with the issue. The tester may add test-only commits; production changes return to the builder.
5. **Reviewer:** reviews the whole final diff with fresh context and records prioritized findings and convention evidence below.
6. **Resolution:** findings are fixed or explicitly resolved; CI reruns after all changes.
7. **Merge:** an agent may squash-merge only when every gate below is satisfied.

## Shared source-of-truth updates

Before updating issue bodies, PR descriptions, decision records, or equivalent collaborative source-of-truth content, refresh the current live issue, PR, and relevant decision state. Reconcile the intended edit with that state and preserve newer concurrent changes; never overwrite them from a stale snapshot.

## Partial issue delivery

A PR may merge while its linked issue remains open. Merging a partial, design, or foundation PR does not by itself close the issue: use a non-closing issue reference and explicitly record remaining work on the issue. Close an issue only when its full acceptance criteria and required gates are satisfied.

## Merge gates

- The PR is linked to an approved issue and is not a draft.
- Required CI checks pass on the current head commit.
- Independent testing and whole-final-diff review outcomes, including applicable convention evidence below, are recorded on the PR.
- No unresolved blocking conversations remain.
- No agent merges its own unreviewed work or bypasses protection.

## CI ownership and required check

`.github/workflows/ci.yml` owns pull-request and main-push triggers, read-only
permissions, cancellation of superseded runs, and the single required **Verify**
check. It calls `web.yml` and `api.yml` in parallel on every event, including
documentation-only PRs. Both reusable workflows use only `workflow_call`; they
have no path filters, inherited secrets, or child concurrency groups.

`web.yml` owns pnpm/Node setup, the root-lockfile cache, repository-wide formatting
(exactly once), lint, type checking, web tests, and the Next.js build, in order.
`api.yml` owns Go setup and the Go-module cache, pinned database tool setup,
sqlc generation drift, isolated Supabase migration/permission/integration checks,
`make api-check` (formatting,
module integrity, vet, regular and race tests, build, generation drift), Docker
Compose validation, the Docker verification stage, Compose readiness, and the live
GraphQL response assertion. It also checks coordinated database/API startup.
Compose and local Supabase cleanup always run, including after failure.
Each child checks out the repository on its own runner and has a 15-minute limit.

The one-minute **Verify** job waits for both calls with `always()`, then explicitly
requires both results to equal `success`. Failure, cancellation, or skipping of
either dependency cannot produce a passing gate. Child checks have distinct names;
branch protections should continue to require **Verify**. Do not change protections
to accommodate this layout.

## Independence

Builder, tester, and reviewer are independent roles with separate agent/task contexts and role-specific prompts. Testing begins from the issue requirements, not the builder's summary. Review evaluates the actual final diff.

## Role prompts and evidence

Use separate contexts with the [builder](prompts/builder.md), [tester](prompts/tester.md), and [reviewer](prompts/reviewer.md) prompts. Record the tested/reviewed commit, requirements coverage, commands and outcomes, findings, and limitations on the PR. After changes, rerun affected checks and obtain independent re-testing or re-review as appropriate so the evidence covers the final diff.

Use the [PR template](../../.github/pull_request_template.md) to collect evidence, not as a substitute for executing verification. Follow [web instructions](../../apps/web/AGENTS.md) or [API instructions](../../apps/api/AGENTS.md) for area-specific checks. Documentation-only work should validate links and accuracy without adding tests that merely mirror prose or file layout. Existing required repository checks still apply; Go and real-database integration checks are documented in the API instructions.

### Convention evidence

The PR template's **Convention evidence** section is the single index for the builder self-check and independent reviewer evidence; link detailed PR comments there instead of duplicating them. Keep evidence concise and proportional to the diff. The builder performs a lightweight self-check against applicable root/area instructions and linked architecture, language, and contract guidance before requesting final review, recording substantive architecture, readability, and documentation risks under **Assumptions, trade-offs, and risks**.

The independent reviewer records the exact head commit and base/diff reviewed, explicitly confirms examining the whole final diff with fresh context, and supplies an outcome for each category below. Name changed surfaces and governing guidance with a short reason for conformance or a finding; if a category does not apply, explain why. A generic “conventions checked” assertion is insufficient.

| Category                               | Required examination when applicable                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture / module boundaries       | Identify packages/modules whose responsibilities changed and compare those responsibilities with governing architecture and area instructions. Explain intentional boundary changes and their justification; flag unjustified deviations.                                                                                                                                                 |
| Readability / cohesion                 | Inspect responsibility-dense changed functions and tests, including large handlers and multi-scenario harnesses. Explain whether decisions and effects remain cohesive or need decomposition by responsibility, without arbitrary line-count limits.                                                                                                                                      |
| Documentation / current-state accuracy | For implemented, retired, or materially changed capabilities, search the repository for stale planned/deferred/implemented claims and reconcile current guides, instructions, and operational documentation. Record search scope/terms and disposition of relevant matches. Distinguish historical ADRs/design/evidence from current-state guidance; do not mechanically rewrite history. |
| Error / ownership boundaries           | Trace where unexpected failures are consumed and identify one safe owning diagnostic boundary, preserving reporting without duplicate logging or sensitive-data exposure. Examine retained mutable values and dependencies where relevant, including copying depth and explicit ownership.                                                                                                |
| Public contracts / generation          | Check exported handwritten documentation and authoritative SDL descriptions against caller contracts; verify generated-source ownership and applicable regeneration/drift checks rather than hand-editing generated output.                                                                                                                                                               |

After fixes, the final reviewer must examine the whole updated final diff, not just previously reported findings, and record evidence for the new head. A finding-only re-review cannot satisfy the final gate. Independent requirements testing remains distinct: it proves issue acceptance criteria rather than substituting for convention review.

Preserve the existing review priorities: financial, authorization, privacy, data-integrity, concurrency, and breaking-change defects outrank maintainability/style findings. Require actionable reasoning under repository policy, not speculative interfaces, generic repository layers, gratuitous helpers/packages, comment noise, or wholesale external style-guide adoption. Add automation only for useful objective checks (such as exported documentation or generation drift); architecture and readability remain review judgments, never architecture-by-regex or function-size linting.

Mark the PR ready only after findings are resolved. Satisfy required GitHub approvals and branch protections as well as independent testing/review. Never bypass protections or merge with failing or missing required checks. After an authorized merge, verify GitHub reports the merge and report the result.

## Historical pilot track

The original greeting pilots established the workflow. Issues #6–9 remain separate from the completed seeded UX tracker #13 and are not its prerequisites or a current production roadmap.

1. Repository foundation and Hello World.
2. Validated personalized greeting.
3. Persisted greeting history and migration workflow.
4. Authentication and ownership boundaries.
5. Safe editing, soft deletion, concurrency protection, and end-to-end coverage.
