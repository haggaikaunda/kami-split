## Summary

<!-- What problem does this solve, and what behavior changes? Follow docs/agents/delivery-workflow.md and relevant area instructions. -->

Closes #

## Acceptance criteria

- [ ] Criteria are satisfied and traced to tests or appropriate documentation verification

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

<!-- Before merging: remove draft status and satisfy required GitHub approvals and branch protections. -->

## Assumptions, trade-offs, and risks

<!-- Include migrations, security/privacy impact, rollout concerns, or "None". -->
