---
name: close-delivery
description: Assess or complete an approved Kami Split delivery through current independent gates, authorized merge and canonical checkout closeout. Use for finishing or resuming delivery; assessment-only requests stay read-only, partial PRs leave their issue open, and stale evidence or unsafe cleanup stops the affected action.
---

Use the [canonical workflow and gates](../../../docs/agents/delivery-workflow.md),
[guarded cleanup](../../../docs/agents/branch-cleanup.md),
[outcome contract](../../../docs/agents/outcome-verification.md) and
[stage records/current handoff](../../../docs/agents/delivery-records.md).
The coordinator retains [routing responsibility](../../../docs/agents/model-routing.md).

1. Refresh the live approved scope, issue/PR, current base/head, independent
   requirements testing, fresh whole-final-diff review, findings, actual CI
   runs/attempts and applicable protections. Bind evidence to scope and revision;
   explain synthetic-merge relationships. A familiar check name or a green older
   revision is insufficient. Trace each criterion to observed evidence/limits.
2. Identify partial delivery and unresolved criteria separately from PR gates.
   Return production fixes to the builder; after changes rerun affected checks,
   independent testing and a whole updated final-diff review. Do not waive missing
   evidence, substitute self-review or count post-merge cleanup as a pre-merge gate.
3. For assessment-only requests, report eligibility, missing evidence and next
   stages without mutation. For authorized completion, existing standing merge
   authority applies: when all current gates pass, mark ready and use the ordinary
   permitted merge method with an exact-head guard. Never bypass protections or
   invent an extra routine owner approval.
4. Confirm GitHub actually reports merged into main and retain source repository,
   branch, final merged head and merge SHA. Execute canonical closeout in the
   actual primary checkout: fresh fetch/prune, clean fast-forward synchronization,
   exact main equality/merge inclusion, owned disposable worktree and exact-tip
   branch cleanup, automatic-deletion setting and independent exact remote absence.
   Coordinate ownership explicitly; preserve advanced, dirty, locked or foreign
   resources. Follow the guarded procedure rather than deriving deletion from age,
   missing upstream or squash-head ancestry.
5. Publish actual outcomes or blockers with owners/next actions and retained check
   identities. Refresh the current index without rewriting valid prior attempts.
   Verify partial-delivery issues remain open after merge; reconcile accidental
   automatic closure with the approved remaining scope. Close the issue only
   after all its criteria and delivery/closeout obligations
   are satisfied; leave parent/remaining scopes open. Record deployment outcome
   when the owning issue requires it; a merged PR alone does not prove release.

On interrupted closeout, refresh GitHub and real checkout state and resume only
uncompleted safe operations. Skip already-absent resources only after successful
proof; network failure is not absence. Do not backdate missing pre-merge evidence.
After one focused retry of a diagnosed failure, leave an actionable handoff and
continue independent safe work. A record or skill never authenticates separate
credentials, authorizes new scope or turns an incomplete delivery into success.
