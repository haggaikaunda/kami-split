---
name: start-task
description: Start or explicitly take over approved Kami Split work with a fresh baseline, owned isolated resources and an actionable GitHub handoff. Use for authorized implementation or continuation, not an assessment-only request, an unapproved goal or an implicit takeover of another session's resources.
---

Use the [canonical start procedure](../../../docs/agents/delivery-workflow.md#task-start-synchronization-and-post-merge-closeout),
[task map](../../../docs/agents/README.md), [routing](../../../docs/agents/model-routing.md)
and [current handoff contract](../../../docs/agents/delivery-records.md).

1. Refresh the live issue, approved scope/revision, dependencies, decisions and
   active PR/handoff. Use [prepare-issue](../prepare-issue/SKILL.md) for missing
   outcome detail. Preserve useful completed/in-flight work; a status note or
   old chat does not override live requirements or transfer resource ownership.
2. Inspect the expected repository, primary/worktrees, refs, locks and operation
   state. Confirm ownership before shared operations. Perform the canonical
   fetch/prune and clean-primary fast-forward synchronization; record exact
   local/remote main equality. If blocked, preserve the primary, record why and
   use a fresh isolated worktree from freshly fetched origin/main when safe.
   Wrong repository identity blocks dependent operations; never reset or stash
   someone's work to obtain a clean start.
3. Establish a feature branch and explicit owners for its checkout, build output,
   ports, services and disposable database. Use the [execution preflight](../../../docs/agents/execution.md)
   and applicable area checks before substantive work. Missing tools or
   configuration need actionable setup, not fabricated success. Do not reveal
   configuration values or reclaim unowned resources; a worktree isolates files.
4. Inspect relevant source and state a short plan including
   [affected journeys, checks and runner maintenance](../../../docs/agents/delivery-workflow.md#plan-verification-before-final-review).
   Route only useful independent roles. Verify actual launch support, explicitly
   select model/effort and supply compact authoritative assignments with resource boundaries. Keep the original
   coordinator selected; record unavailable optional capabilities honestly.
5. Publish one concise start/current handoff on the owning issue/PR: scope,
   attempt, owner, branch/base/head, resource ownership, preflight observations,
   blockers and next action. Refresh before writing and preserve concurrent
   contributions. Proceed within standing authority through implementation and
   the existing independent gates; no separate invocation or routine approval
   is needed for each stage.

For continuation, reread GitHub and current refs/resources before acting. Reuse an
eligible owned checkout or obtain an explicit transfer; timestamps are not locks.
After one focused retry of a diagnosed setup failure, hand off the remaining
blocker with owner/action and continue unaffected work. Record what actually ran,
including blocked starts; never infer fresh remote equality from an old record.
