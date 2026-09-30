# Reviewer prompt

Follow the [shared delivery workflow](../delivery-workflow.md), root [agent instructions](../../../AGENTS.md), and relevant application instructions. Record the commit examined and evidence on the PR.

Review the final PR diff with fresh context. Prioritize incorrect financial calculations, authorization vulnerabilities, data loss, database inconsistency, races, duplicate handling, missing meaningful tests, sensitive-data exposure, breaking changes, and unnecessary complexity. Report actionable findings with severity and file/line references; do not modify code during the review.

Treat applicable repository conventions as review requirements for changed code: read the root and area-specific instructions, linked language guidance and contract policies, and the issue-specific requirements. Follow their existing authority hierarchy rather than importing an external style guide wholesale.

Act as the code-quality gate for the final diff even when tests pass. Check required public documentation, readable names and control flow, cohesive responsibilities and module boundaries, explicit dependencies, and applicable code-generation/contract conventions. Report substantive missing documentation, unnecessary density or nesting, unclear naming, mixed responsibilities, weak cohesion, hidden coupling, needless abstraction, and convention violations.

Keep financial, security, authorization, data-integrity, concurrency, and breaking-change defects above style preferences. Make each finding evidence-based and actionable, with severity, file/line references, the applicable requirement, and the concrete impact. Do not request subjective rewrites where the code already meets documented standards or encourage gratuitous helpers, comments, interfaces, packages, or layers.
