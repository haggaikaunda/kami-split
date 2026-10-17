## Summary

<!-- What problem does this solve, and what behavior changes? Follow docs/agents/delivery-workflow.md and relevant area instructions. -->

<!-- Use a non-closing reference when acceptance criteria or post-merge closeout remain outstanding. -->

Refs #

## Acceptance criteria

- Approved issue / scope revision / approval provenance:
- Criteria covered by this PR and criteria remaining on the issue:
- [ ] Covered criteria are traced to observed evidence, including meaningful negative cases and limitations

<!-- Use docs/agents/outcome-verification.md. Link the independent criterion → scenario → observed result → status table below. A passing command, fixture success or written checklist alone does not prove the outcome. Refresh affected evidence after relevant scope/code changes. -->

## Verification

- [ ] `pnpm format:check`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] Applicable area checks recorded (web browser/accessibility evidence; Go/API and container checks)

<!-- Record commands, outcomes, commit SHA, and limitations. Explain non-applicable area checks; do not claim unavailable tooling was run. -->

## Convention evidence

<!-- Follow docs/agents/delivery-workflow.md#convention-evidence. Keep this as the single index: concise evidence here or links to detailed PR comments, without duplication. Each role names examined surfaces and outcomes for all five categories, or explains non-applicability. -->

- Builder self-check (commit, applicable guidance, evidence):
- Independent reviewer (final head SHA, base/diff, explicit fresh whole-diff confirmation, evidence):

<!-- Categories: architecture/module boundaries; readability/cohesion; documentation/current-state accuracy (status-search scope/terms and reconciliation); error/ownership boundaries; public contracts/generation. Record substantive risks and intentional boundary changes below. After fixes, link a new whole-final-diff review for the updated head; a finding-only re-review is insufficient. -->

## Independent gates

- [ ] Independent requirements-focused testing recorded, with evidence and commit examined
- [ ] Independent whole-final-diff review and convention evidence recorded, with findings and final commit/base examined
- [ ] Substantive findings and blocking conversations resolved; affected checks and reviews rerun
- [ ] Required CI passes on the current head

- Independent acceptance evidence (scope revision, tested SHA, coverage / limitations):
- Final-head CI (run/check identity, attempt, conclusion and head/base or synthetic-merge relationship):

<!-- Before merging: remove draft status and satisfy required GitHub approvals and branch protections. -->

## Assumptions, trade-offs, and risks

<!-- Include migrations, security/privacy impact, rollout concerns, or "None". -->

## Post-merge closeout (completion evidence, not pre-merge gates)

<!-- Coordinator owns this section after an actual authorized merge. Keep unchecked until performed. If another session merges, name the original-checkout owner and hand off execution. Record blocked steps with next action; never infer absence from a network/permission error. -->

- Coordinator / original-checkout owner and designated primary path:
- Task-start observed origin/main SHA and primary synchronization outcome:
- [ ] Fresh GitHub confirmation: repository, merged into main, source repository/branch, final merged head SHA, merge commit SHA
- [ ] Primary checkout clean on main; local and freshly fetched origin/main SHAs equal; merge inclusion verified
- [ ] Completed local branch and owned disposable worktree removed (before/after dispositions and SHAs)
- [ ] delete_branch_on_merge checked; exact source ref absent on remote server; final prune complete
- Outstanding blockers, retained candidates with reasons, owner / next action:

<!-- Use docs/agents/branch-cleanup.md for the inspection and guarded cleanup procedure. Synchronization describes observed remote state, not future commits. Close the issue only after full acceptance criteria and closeout are recorded. -->

## Evidence placement

Commit code, meaningful tests, required generated source, approved design inputs and maintained technical documentation. Put issue-specific verification results, screenshots, logs, review reports, acceptance status, work plans and task-start/merge/checkout closeout evidence on the tracking issue or PR, not in repository files. Documentation updates must explain lasting behavior or procedures, not record that a particular run passed. A historical label does not make work-tracking material appropriate for the repository.

Write run outputs to ignored `test-results/` or an external temporary directory. Preserve useful fixtures, test baselines and approved design inputs; classify by purpose and consumers. Before committing and during final review, inspect staged/final files for accidental evidence, task plans and copied issue specifications. Check documented behavior against the actual code. Publish unique history on its owning issue/PR before removing it; preserve original provenance and privacy. This changes evidence placement, not independent testing, whole-final-diff review, final-head CI or post-merge closeout obligations.
