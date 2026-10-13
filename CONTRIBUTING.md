# Contributing

Work begins with a GitHub issue containing clear acceptance criteria. Use a short branch name such as `codex/52-current-state-docs` or `codex/fix-duplicate-submit`.

Keep pull requests focused. Complete the PR template, keep the PR in draft while implementation changes are expected, and do not merge until all gates in the [delivery workflow](docs/agents/delivery-workflow.md) are satisfied.

Conventional commit prefixes are encouraged: `feat`, `fix`, `test`, `docs`, `chore`, and `refactor`.

Read the [current product scope](docs/product-scope.md) and [testing strategy](docs/testing-strategy.md) before changing behavior. The seeded UX is complete; new work needs its own approved issue. Historical design checklists are not authorization to reopen completed work.

## Repository content and run outputs

Commit code, meaningful tests, required generated source, approved design inputs and maintained technical documentation. Put issue-specific verification results, screenshots, logs, review reports, acceptance status, work plans and task-start/merge/checkout closeout evidence on the tracking issue or PR, not in repository files. Documentation updates must explain lasting behavior or procedures, not record that a particular run passed. A historical label does not make work-tracking material appropriate for the repository.

Write run outputs to ignored `test-results/` or an external temporary directory. Preserve useful fixtures, test baselines and approved design inputs; classify by purpose and consumers. Before committing and during final review, inspect staged/final files for accidental evidence, task plans and copied issue specifications. Check documented behavior against the actual code. Publish unique history on its owning issue/PR before removing it; preserve original provenance and privacy. This changes evidence placement, not independent testing, whole-final-diff review, final-head CI or post-merge closeout obligations.
