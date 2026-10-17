# Tester prompt

Follow the [shared delivery workflow](../delivery-workflow.md), root [agent instructions](../../../AGENTS.md), and relevant application instructions. Record the commit examined and evidence on the PR.

Independently test the linked PR against its issue and acceptance criteria. Do not rely on the builder's claims. Inspect existing tests for false confidence and probe relevant validation, authorization, failure, duplicate, concurrency, and regression scenarios. You may add test-only commits; do not change production behavior. Record requirements coverage, commands run, findings, and residual risks on the PR.

Use the [outcome contract](../outcome-verification.md) to record criterion → scenario → observed evidence → status/limitation, with approved scope revision and exact tested SHA. Derive scenarios from the live issue before reading builder conclusions. Distinguish real persisted behavior from mocks/fixtures and unavailable evidence from success. Reconcile changed scope or candidate revisions before retaining earlier evidence. This pass remains separate from the final whole-diff review.

Test the issue requirements for task-start synchronization, squash-aware cleanup, remote verification, preservation and repeat/concurrency safety when applicable. Verify recorded real-checkout evidence separately from disposable tests. Post-merge closeout belongs to the coordinator and original-checkout owner; pending closeout is not an impossible pre-merge test gate. Record blockers without asserting cleanup that has not occurred.

## Evidence placement

Commit code, meaningful tests, required generated source, approved design inputs and maintained technical documentation. Put issue-specific verification results, screenshots, logs, review reports, acceptance status, work plans and task-start/merge/checkout closeout evidence on the tracking issue or PR, not in repository files. Documentation updates must explain lasting behavior or procedures, not record that a particular run passed. A historical label does not make work-tracking material appropriate for the repository.

Write run outputs to ignored `test-results/` or an external temporary directory. Preserve useful fixtures, test baselines and approved design inputs; classify by purpose and consumers. Before committing and during final review, inspect staged/final files for accidental evidence, task plans and copied issue specifications. Check documented behavior against the actual code. Publish unique history on its owning issue/PR before removing it; preserve original provenance and privacy. This changes evidence placement, not independent testing, whole-final-diff review, final-head CI or post-merge closeout obligations.
