# GitHub delivery records

Use concise records at meaningful boundaries under the [delivery workflow](delivery-workflow.md):
attempt start, stage outcome, material blocker/intervention, ownership transfer,
merge and closeout. The issue owns the goal/current handoff; the PR description
is the current evidence index. Detailed outcomes live in issue/PR comments.
Do not record every tool call or commit actual run ledgers to source.

## Current handoff and evidence index

Keep this short human-readable outline current on GitHub:

```text
Goal / approval / scope revision / criteria: links and stable identifiers
Attempt / coordinator / stage / state: identifiers, owner and current outcome
Candidate: repository, branch, base/head, worktree and resource ownership
Evidence: links to builder checks, independent criteria coverage, whole-final-diff
  review and observed final-head CI; tested revisions and material limitations
Open findings / blockers: owner, exact affected action and next action
Next: next stage or explicit transfer; merge/closeout status and remaining work
Records: attempt-start and latest stage/correction comment links; cohort link
```

Refresh the live issue, PR, relevant decisions and recent comments before every
shared update. One coordinator serializes edits and ownership transfers. Reconcile
concurrent additions; if the premise changed, reread rather than overwrite. A
timestamp/label is not a lock or permission to reclaim someone else's resources.
After an uncertain write, search for the stable event ID before retrying.

## Version 1 stage event

Post one JSON object per fenced `json` block in a comment, preceded by a brief
human outcome. Use the [schema](records/stage-event.schema.json) and
[synthetic example](records/stage-event.example.json). The example is non-live;
replace its identifiers and observations, never publish it as delivery evidence.

| Field                                             | Meaning                                                                                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema_version`, `event_id`, `supersedes`        | Version `1`; globally unique stable event ID (for example a UUID); IDs corrected by this replacement event                                                       |
| `goal`, `attempt_id`, `scope`                     | Owning issue URL, stable attempt ID, approved scope revision and approval/source links                                                                           |
| `stage`, `role`, `outcome`                        | Boundary and responsible role; `started`, `ongoing`, `passed`, `failed`, `blocked`, `cancelled` or `not_applicable`                                              |
| `revision`                                        | Repository, exact relevant base/head/tested SHA or null with a limitation; resource/branch identities belong in the human handoff                                |
| `execution`                                       | Configured model/effort, observed model/effort or null, available context ID or null, fresh/inherited/unknown context, routing reason                            |
| `evidence`                                        | Source links and compact observed checks: run ID, check-run/job ID, attempt, name, conclusion, workflow identity/revision, head SHA and synthetic-merge relation |
| `findings`, `limitations`, `owner`, `next_action` | Actionable outcome, honest unknowns and who continues; empty findings means none observed in stated coverage                                                     |
| `intervention`                                    | `planned_decision`, `rescue`, `none_observed`, `unknown` or `not_applicable`, reason/source links and observation coverage                                       |
| `timing`, `cost`                                  | Observed start/end and elapsed seconds or null; attributable cost with currency/source or null                                                                   |

Use a new attempt ID for a restarted delivery attempt; keep it stable across its
stages and link the previous attempt in evidence. Stage retries remain the same
attempt, with distinct event IDs and check-run attempt identities. Scope revisions
identify approved requirements, not hashes of mutable progress checkboxes. Material
scope/head changes require applicable evidence to be refreshed under the canonical
workflow. A stage `passed` is not full-goal acceptance; only goal acceptance after
all criteria and closeout may be recorded as `stage: goal`, `outcome: passed`.
Partial PRs leave their owning issue open.

Use null for unavailable model identity, revisions, usage/cost or timing; state
why in limitations. Null does not mean zero or not applicable. An accepted launch
is configured execution, not attestation. Record applicable CI observations while
available, including rerun attempt and actual workflow/check identities, source
URL, SHA and relation to PR base/head. A familiar check name alone is insufficient.
Explain synthetic merge SHAs rather than requiring equality to the PR head.
Retained observations after source expiry are historical, not fresh verification.

## Corrections, cohorts and limits

Append immutable outcome comments. Correct an error with a new event ID that lists
the superseded IDs, explains the correction and links the original comment; do
not silently edit/delete history. An index may change, but it must retain links to
attempts and corrections. Duplicate identical IDs are duplicate publication, not
extra work; different payloads for one ID are a conflict to resolve explicitly,
never last-write-wins. A superseding record replaces the whole event, not selected
fields. Cross-link split issue/PR histories. If privacy requires redaction, remove
the sensitive material and leave a non-sensitive correction/provenance note.

Predeclare an explicit issue list/bounded cohort, comparable baseline/settings,
finite budget and eligibility before evaluation. Link its declaration from each
attempt-start record. Include every started goal and attempt, including ongoing,
blocked, cancelled and failed ones; never construct the denominator from merged
PRs alone. Link externally retained raw synthetic trials when appropriate without
copying private chats. Observe full-goal acceptance, planned decisions versus
avoidable rescue, substantive testing/review correction cycles and their causes,
blockers, elapsed delivery/closeout time and final-revision/closeout completeness.

Report coverage and unknowns per observation. Missing intervention records are
unknown, not zero; comments/commits are not rework counts. Elapsed time includes
waiting and is not active effort. Link confirmed regressions without inventing
causation. Missing cost remains unknown and never gates delivery. Keep secrets,
financial/authentication data and raw private conversations out of records.

The later read-only collector must retrieve the complete declared issue/PR/comment/
review/check history with pagination and cross-links, retaining source identities
and diagnosing missing, expired, edited, duplicate, conflicting or superseded
records and partial/API failures. This contract does not implement that collector,
authenticate roles, or add a merge gate; #305 owns enforcement separately.

## Objective validation

Using the ignored environment from [skill validation](skill-authoring.md):

```sh
.tools/skills-validator/bin/python scripts/agents/check_stage_event.py /tmp/event.json
.tools/skills-validator/bin/python -m unittest discover -s scripts/agents -p '*_test.py'
```

The pinned JSON Schema validator checks version/shape, enums, revision syntax and
explicit unknown fields. Narrow synthetic tests check malformed records, correction
identities and check attempts. Validation cannot establish truthful outcomes,
authorization, evidence freshness or complete retrieval; those remain independent
testing/review and coordinator responsibilities. Validation prints fixed diagnostics
without echoing submitted record data. Actual records stay on GitHub or in ignored
temporary storage.
