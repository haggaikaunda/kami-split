# Kami Split Agent Instructions

## Repository content and run outputs

Commit code, meaningful tests, required generated source, approved design inputs and maintained technical documentation. Put issue-specific verification results, screenshots, logs, review reports, acceptance status, work plans and task-start/merge/checkout closeout evidence on the tracking issue or PR, not in repository files. Documentation updates must explain lasting behavior or procedures, not record that a particular run passed. A historical label does not make work-tracking material appropriate for the repository.

Write run outputs to ignored `test-results/` or an external temporary directory. Preserve useful fixtures, test baselines and approved design inputs; classify by purpose and consumers. Before committing and during final review, inspect staged/final files for accidental evidence, task plans and copied issue specifications. Check documented behavior against the actual code. Publish unique history on its owning issue/PR before removing it; preserve original provenance and privacy. This changes evidence placement, not independent testing, whole-final-diff review, final-head CI or post-merge closeout obligations.

## Mission

Build a trustworthy personal expense-sharing application through small, independently verified pull requests. GitHub is the source of truth.

## Required workflow

Follow the canonical [delivery workflow](docs/agents/delivery-workflow.md) for every area of the repository. Application instructions add implementation and verification requirements, not separate PR lifecycles.

1. Start from an approved, acceptance-criteria-driven GitHub issue.
2. Inspect relevant code and documentation before editing.
3. State a short implementation plan. Fetch/prune and synchronize the designated primary checkout with `origin/main` before starting, or record the blocker and use a fresh isolated worktree. Record the observed SHA.
4. Work on a feature branch or isolated worktree; never push directly to `main`.
5. Implement the smallest complete change and meaningful tests.
6. Run formatting, linting, type checking, tests, and build verification.
7. Open or update a draft pull request and document assumptions, trade-offs, verification, and risks.
8. Obtain an independent requirements-focused testing pass and a final-diff review.
9. Resolve substantive findings and rerun required checks.
10. An agent may merge only when required CI passes, independent testing and review are recorded, all blocking conversations are resolved, and the PR is no longer a draft.

11. The delivery/merge coordinator completes the canonical post-merge closeout: confirm the actual merge, synchronize clean primary `main`, remove proven completed branches and owned disposable worktrees, verify exact remote branch absence, and record evidence or explicit blockers. Each agent owns its disposable worktrees; hand off cleanup when the original checkout belongs to another session.

Never bypass branch protections, force-push shared branches, weaken tests to obtain a passing build, or merge with failing or missing required checks.

## Financial invariants

- Represent money using integer minor units or an exact decimal type, never binary floating point.
- For every expense, amounts paid and amounts owed must each equal the expense total.
- Across the system, all users' net balances must sum to zero.
- A settlement changes the payer and recipient by equal and opposite amounts.
- Preserve an auditable history of financial mutations.

## Security and privacy

- Enforce authentication and authorization on the server.
- Never commit secrets or log sensitive financial/authentication data.
- Test cross-user access denial and failure paths.
- Prefer safe, reversible database migrations and least privilege.

## Definition of done

- Acceptance criteria are met and traced to tests.
- Formatting, linting, type checking, tests, and build pass.
- Authorization, validation, error handling, duplicates, and concurrency were considered where relevant.
- Documentation and migrations are updated when behavior or schema changes.
- Post-merge closeout is recorded with observed local/remote main SHAs, branch/worktree and remote deletion outcomes, and explicit blockers. These are completion obligations, not pre-merge gates.
- The PR is small enough to review and contains no unrelated changes.

## Review priorities

Prioritize financial errors, authorization flaws, data loss, database inconsistency, races, duplicate requests, missing meaningful tests, private-data exposure, breaking changes, and unnecessary complexity over style preferences.

## Area guidance

See [agent documentation](docs/agents/README.md) for area-specific instructions. Future API work must follow [apps/api/AGENTS.md](apps/api/AGENTS.md); [application documentation](docs/application/README.md) distinguishes current behavior from planned architecture.
