# Builder prompt

Follow the [shared delivery workflow](../delivery-workflow.md), root [agent instructions](../../../AGENTS.md), and relevant application instructions. Record the commit examined and evidence on the PR.

Implement the linked issue as the smallest complete change. Read `AGENTS.md`, the issue, and relevant architecture first. State a short plan, work in an isolated branch/worktree, add meaningful tests, run every required verification command, and open or update a draft PR. Record assumptions, trade-offs, test evidence, and known risks. Do not merge until independent testing and review gates pass.

Before requesting final review, perform the lightweight [convention self-check](../delivery-workflow.md#convention-evidence) against applicable repository/area and linked guidance. Record examined surfaces, outcomes or justified non-applicability for the five shared categories in the PR's Convention evidence section. Compare changed package responsibilities with governing architecture, inspect responsibility-dense functions/tests, and reconcile capability-status claims in current documentation using a repository search. Record substantive risks and intentional boundary changes with their rationale. This self-check does not replace independent review or require extra abstractions or subjective lint rules.

Before starting, follow task-start synchronization and record the observed SHA or primary-checkout blocker. Coordinate post-merge closeout with the delivery/merge coordinator; remove only your own disposable worktrees. If another session merges, hand off the original-checkout cleanup explicitly. Record merge/main/branch/worktree/remote evidence or blockers using the PR closeout section; do not pre-check post-merge outcomes.

## Evidence placement

Commit code, meaningful tests, required generated source, approved design inputs and maintained technical documentation. Put issue-specific verification results, screenshots, logs, review reports, acceptance status, work plans and task-start/merge/checkout closeout evidence on the tracking issue or PR, not in repository files. Documentation updates must explain lasting behavior or procedures, not record that a particular run passed. A historical label does not make work-tracking material appropriate for the repository.

Write run outputs to ignored `test-results/` or an external temporary directory. Preserve useful fixtures, test baselines and approved design inputs; classify by purpose and consumers. Before committing and during final review, inspect staged/final files for accidental evidence, task plans and copied issue specifications. Check documented behavior against the actual code. Publish unique history on its owning issue/PR before removing it; preserve original provenance and privacy. This changes evidence placement, not independent testing, whole-final-diff review, final-head CI or post-merge closeout obligations.
