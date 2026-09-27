# Delivery workflow

This is the canonical process for all repository changes: web, API, schema, infrastructure, and documentation. The root [AGENTS.md](../../AGENTS.md) summarizes mandatory policy. Area instructions add verification requirements; they do not replace this loop.

## Pull request lifecycle

1. **Ready issue:** scope, acceptance criteria, exclusions, and test notes are clear.
2. **Builder:** implements the smallest complete solution in a worktree and opens a draft PR.
3. **CI:** deterministic formatting, linting, type checking, unit tests, and build checks pass.
4. **Tester:** independently compares the behavior and tests with the issue. The tester may add test-only commits; production changes return to the builder.
5. **Reviewer:** reviews the final diff with fresh context and records prioritized findings.
6. **Resolution:** findings are fixed or explicitly resolved; CI reruns after all changes.
7. **Merge:** an agent may squash-merge only when every gate below is satisfied.

## Merge gates

- The PR is linked to an approved issue and is not a draft.
- Required CI checks pass on the current head commit.
- Independent testing and review outcomes are recorded on the PR.
- No unresolved blocking conversations remain.
- No agent merges its own unreviewed work or bypasses protection.

## Independence

Builder, tester, and reviewer are independent roles with separate agent/task contexts and role-specific prompts. Testing begins from the issue requirements, not the builder's summary. Review evaluates the actual final diff.

## Role prompts and evidence

Use separate contexts with the [builder](prompts/builder.md), [tester](prompts/tester.md), and [reviewer](prompts/reviewer.md) prompts. Record the tested/reviewed commit, requirements coverage, commands and outcomes, findings, and limitations on the PR. After changes, rerun affected checks and obtain independent re-testing or re-review as appropriate so the evidence covers the final diff.

Use the [PR template](../../.github/pull_request_template.md) to collect evidence, not as a substitute for executing verification. Follow [web instructions](../../apps/web/AGENTS.md) or [API instructions](../../apps/api/AGENTS.md) for area-specific checks. Documentation-only work should validate links and accuracy without adding tests that merely mirror prose or file layout. Existing required repository checks still apply; future Go checks apply once the module/tooling exists.

Mark the PR ready only after findings are resolved. Satisfy required GitHub approvals and branch protections as well as independent testing/review. Never bypass protections or merge with failing or missing required checks. After an authorized merge, verify GitHub reports the merge and report the result.

## Historical pilot track

The original greeting pilots established the workflow. Issues #6–9 remain separate from the completed seeded UX tracker #13 and are not its prerequisites or a current production roadmap.

1. Repository foundation and Hello World.
2. Validated personalized greeting.
3. Persisted greeting history and migration workflow.
4. Authentication and ownership boundaries.
5. Safe editing, soft deletion, concurrency protection, and end-to-end coverage.
