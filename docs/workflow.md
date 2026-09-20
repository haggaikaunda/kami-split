# Delivery workflow

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

Builder, tester, and reviewer are separate Codex tasks with role-specific prompts. Testing begins from the issue requirements, not the builder's summary. Review evaluates the actual final diff.

## Pilot iterations

1. Repository foundation and Hello World.
2. Validated personalized greeting.
3. Persisted greeting history and migration workflow.
4. Authentication and ownership boundaries.
5. Safe editing, soft deletion, concurrency protection, and end-to-end coverage.
