# Reviewer prompt

Follow the [shared delivery workflow](../delivery-workflow.md), root [agent instructions](../../../AGENTS.md), and relevant application instructions. Record the commit examined and evidence on the PR.

Review the final PR diff with fresh context. Prioritize incorrect financial calculations, authorization vulnerabilities, data loss, database inconsistency, races, duplicate handling, missing meaningful tests, sensitive-data exposure, breaking changes, and unnecessary complexity. Report actionable findings with severity and file/line references; do not modify code during the review.

Treat applicable repository conventions as review requirements for changed code: read the root and area-specific instructions, linked language guidance and contract policies, and the issue-specific requirements. Follow their existing authority hierarchy rather than importing an external style guide wholesale.

Act as the code-quality gate for the final diff even when tests pass. Check required public documentation, readable names and control flow, cohesive responsibilities and module boundaries, explicit dependencies, and applicable code-generation/contract conventions. Report substantive missing documentation, unnecessary density or nesting, unclear naming, mixed responsibilities, weak cohesion, hidden coupling, needless abstraction, and convention violations.

Keep financial, security, authorization, data-integrity, concurrency, and breaking-change defects above style preferences. Make each finding evidence-based and actionable, with severity, file/line references, the applicable requirement, and the concrete impact. Do not request subjective rewrites where the code already meets documented standards or encourage gratuitous helpers, comments, interfaces, packages, or layers.

Use the [shared convention evidence requirements](../delivery-workflow.md#convention-evidence) for architecture/module boundaries, readability/cohesion, documentation/current-state accuracy, error/ownership boundaries, and public contracts/generation. For each category, name changed surfaces examined and governing guidance with the conformance reasoning or findings, or explain non-applicability. Trace consumed unexpected errors to their safe diagnostic owner; check retained mutable values/dependencies where relevant. For capability changes, verify the repository status-claim search and reconciliation of current guides separately from historical records.

Record the exact final head commit and base/diff reviewed, and explicitly confirm a fresh whole-final-diff pass. After any fixes, repeat that whole-diff pass on the updated head, including surfaces unrelated to earlier findings; merely verifying known fixes is insufficient. Record this evidence in the PR's Convention evidence section or a linked review comment. Requirements testing and builder self-checks do not substitute for this independent code-quality gate.

Check that task-start synchronization and coordinator-owned post-merge closeout preserve active/dirty work, use exact merge/head evidence and guarded deletion, explicitly check main equality, and verify remote absence independently of pruning. Review closeout evidence or execution handoff as applicable; pending post-merge outcomes must not be pre-checked or treated as pre-merge gates. Each agent remains responsible for its own disposable worktrees.
