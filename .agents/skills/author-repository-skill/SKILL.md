---
name: author-repository-skill
description: Create or revise a focused Kami Split skill for an authorized recurring workflow improvement. Use when establishing reusable agent procedure; do not use for one-off run reports, ordinary implementation, or a workflow already adequately covered by existing guidance.
---

Read the [authoring guide](../../../docs/agents/skill-authoring.md) and the
approved goal first. Use the installed skill-creator too when available. Keep
the [canonical delivery workflow](../../../docs/agents/delivery-workflow.md)
as the sole delivery authority.

1. Inspect existing skills, linked guides and actual code. Choose skill, guide,
   regression test or deterministic helper based on repeated need; explain the
   choice on the issue. An already-covered procedure gets a focused revision.
2. Define observable outcome, precise trigger/non-use, inputs, existing authority,
   resources and owner. Predeclare bounded baseline, negative and held-out trials
   before writing. Use the guide's evaluation procedure, not author self-grading.
3. Adapt the [template](assets/skill-template.md). Link canonical policy, keep
   optional detail in resources, preserve automatic discovery and the owner's
   end-to-end intent. Do not install third-party skills or modify global settings.
4. Run the guide's objective checks and independent behavioral trials. Record
   actual attempts and limitations on the issue/PR. Stop tuning at the declared
   budget; diagnose, revise the plan or defer instead of looping silently.
5. Deliver through normal independent gates. If interrupted, leave the current
   draft/revision, trials completed, unresolved findings, owner and next action
   on GitHub. A later context refreshes them before resuming. Adopt only when
   measured usefulness justifies coordination and maintenance cost.
