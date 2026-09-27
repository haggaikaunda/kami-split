# Kami Split Agent Instructions

## Mission

Build a trustworthy personal expense-sharing application through small, independently verified pull requests. GitHub is the source of truth.

## Required workflow

Follow the canonical [delivery workflow](docs/agents/delivery-workflow.md) for every area of the repository. Application instructions add implementation and verification requirements, not separate PR lifecycles.

1. Start from an approved, acceptance-criteria-driven GitHub issue.
2. Inspect relevant code and documentation before editing.
3. State a short implementation plan.
4. Work on a feature branch or isolated worktree; never push directly to `main`.
5. Implement the smallest complete change and meaningful tests.
6. Run formatting, linting, type checking, tests, and build verification.
7. Open or update a draft pull request and document assumptions, trade-offs, verification, and risks.
8. Obtain an independent requirements-focused testing pass and a final-diff review.
9. Resolve substantive findings and rerun required checks.
10. An agent may merge only when required CI passes, independent testing and review are recorded, all blocking conversations are resolved, and the PR is no longer a draft.

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
- The PR is small enough to review and contains no unrelated changes.

## Review priorities

Prioritize financial errors, authorization flaws, data loss, database inconsistency, races, duplicate requests, missing meaningful tests, private-data exposure, breaking changes, and unnecessary complexity over style preferences.

## Area guidance

See [agent documentation](docs/agents/README.md) for area-specific instructions. Future API work must follow [apps/api/AGENTS.md](apps/api/AGENTS.md); [application documentation](docs/application/README.md) distinguishes current behavior from planned architecture.
