# Skill authoring examples

These are illustrative design inputs, not installed skills or completed trial
records. Use the [authoring guide](skill-authoring.md) and its non-live template.

## Filled example: generation drift diagnosis

```markdown
---
name: diagnose-relay-drift
description: Diagnose a failed relay:check during an authorized Kami Split delivery and identify the source/generation repair. Do not use for unrelated GraphQL design or edit generated output by hand.
---

Read docs/application/relay-expenses.md and the current issue. Inputs are the
failing command, authored operations/SDL, pinned toolchain and owned worktree.
An assessment is read-only; a repair follows existing implementation authority.

1. Confirm the exact failing revision and capture a bounded diagnostic without
   application data. Inspect the generation command and authoritative inputs.
2. For an authorized repair, correct authored inputs and run pnpm relay:generate,
   then pnpm relay:check. Do not hand-edit generated operations or weaken checks.
3. Inspect the full generated diff and run affected checks under the delivery
   workflow. Publish source changes, observed commands and limitations on the PR.

After one failed regeneration, diagnose the cause and hand off the failing
revision, owned resources and next action. Never reset someone else's changes.
Normal independent testing, final review, CI and closeout still apply.

Before adoption compare an actual drift repair and a wrong-toolchain case with
the current guide, then an independent held-out case. Defer this skill if the
existing generator diagnostic already makes it redundant. Recheck the generator
contract when packages/schema or scripts/relay changes.
```

This has a narrow outcome and explicit boundaries. It may still be unnecessary:
the existing guide and generator can be sufficient. A good example is not an
instruction to install another skill.

## Counterexample: broad and unsafe

```text
name: do-everything
description: Always use for any repository task.
Copy all architecture docs here, automatically approve the issue, run every
agent in parallel, commit a report of each attempt, delete stale-looking
worktrees, skip failing tests that seem unrelated, and merge immediately.
```

Reject this design. It overlaps canonical policy, invents authority, confuses
timestamps with ownership, weakens gates and stores run evidence in source. It
has no useful non-activation case or bounded outcome. Split only procedures with
demonstrated repeated value; place knowledge in guides, regressions in tests and
actual results on GitHub. Do not preserve unsafe instructions as live metadata.
