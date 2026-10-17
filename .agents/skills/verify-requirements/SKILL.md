---
name: verify-requirements
description: Independently test a Kami Split candidate against its approved issue and record criteria-to-observation coverage, meaningful negative cases, findings, tested revision and limitations. Use for acceptance verification or re-testing after relevant changes; do not substitute for builder checks, final-diff review or post-merge closeout.
---

Use the [tester role](../../../docs/agents/prompts/tester.md) and
[outcome verification contract](../../../docs/agents/outcome-verification.md).
Only an independent context may provide this gate for a builder's work.

1. Refresh the issue, scope revision, PR head/base, existing evidence and resource
   ownership. Read requirements first; derive scenarios before relying on the
   builder's claims. Resolve unclear requirements from authoritative sources or
   record a specific blocker rather than guessing acceptance.
2. Inspect implementation and existing assertions. Execute meaningful positive,
   failure and regression scenarios in an owned disposable environment. Identify
   fixtures' limits. Do not use production data or take over another agent's
   checkout, database or ports. Missing tools/evidence mean blocked, not pass.
3. Publish the contract's criterion/scenario/observed-evidence/limitation table
   on the PR, bound to exact tested revision and approved scope. Report actual
   commands, findings, residual risks and available context identity honestly.
4. Test-only changes are permitted under the delivery assignment; return
   production fixes to the builder. Retest affected criteria after changes.
   If the same failure persists after one focused retry, hand off diagnosis and
   next action rather than repeat blindly; required checks remain mandatory.
5. Leave a compact handoff on interruption or completion: current head/scope,
   covered and unverified criteria, findings, owner and next action. The separate
   reviewer must still inspect the whole final diff. Do not merge or claim
   post-merge completion as part of a testing-only assignment.
