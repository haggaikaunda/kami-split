# GitHub delivery records

Use concise human-readable records at meaningful boundaries under the [delivery workflow](delivery-workflow.md):
attempt start, stage outcome, material blocker/intervention, ownership transfer,
merge and closeout. The issue owns the goal/current handoff; the PR description
is the current evidence index. Detailed outcomes live in issue/PR comments.
Do not record every tool call or commit actual run ledgers to source. Ordinary
issue/PR discussions with exact revisions, outcomes and source links are the
default. A separate JSON ledger is not required. Keep one current evidence index
and link detailed results instead of copying them into multiple reports.

For a retest or resumed stage, record the changed revision/scope, new observations,
finding disposition and next action. Link the earlier report and explain which
evidence remains applicable; do not republish the whole report or relabel retained
observations as new execution. Applicability includes relevant inputs (fixtures,
harness/environment and build identity), not only a commit SHA. Keep detailed
logs/artifacts behind the concise outcome and source links, preserving useful
failure history. Carry the [diagnosis owner and consumed retry budget](model-routing.md#bound-retries-and-hand-off)
into each affected delta/handoff; a fresh context does not erase failed attempts.

For a bounded retrospective, use
[evaluate-deliveries](../../.agents/skills/evaluate-deliveries/SKILL.md) to collect
existing discussions and assess outcomes, friction and adoption. It reads both
ordinary prose and existing structured records, with explicit coverage and
unknowns. Evaluation does not replace independent requirements testing, final-diff
review or the coordinator's current merge/closeout checks.

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
Records: attempt-start and latest stage/correction links; cohort only if evaluating
```

Refresh the live issue, PR, relevant decisions and recent comments before every
shared update. One coordinator serializes edits and ownership transfers. Reconcile
concurrent additions; if the premise changed, reread rather than overwrite. A
timestamp/label is not a lock or permission to reclaim someone else's resources.
After an uncertain write, check whether that outcome was already published before
retrying; use its source link or stable event ID when one exists.

## Optional version 1 stage event

Existing versioned records remain valid historical evidence. Use this optional
format when explicitly requested or when an identified consumer needs it; do not
backfill ordinary discussions merely to support an evaluation. For this format,
post one JSON object per fenced `json` block, preceded by a brief human outcome.
Use the [schema](records/stage-event.schema.json) and
[synthetic example](records/stage-event.example.json). The example is non-live;
replace its identifiers and observations, never publish it as delivery evidence.
The fixed `record_type: "kami_split.delivery_stage"` marker distinguishes these
events from unrelated fenced JSON. When using structured history, report marked
invalid records and unsupported versions rather than silently excluding them.

| Field                                             | Meaning                                                                                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record_type`                                     | Fixed discriminator `kami_split.delivery_stage`                                                                                                                  |
| `schema_version`, `event_id`, `supersedes`        | Version `1`; globally unique stable event ID (for example a UUID); IDs corrected by this replacement event                                                       |
| `goal`, `attempt_id`, `scope`                     | Owning issue URL, stable attempt ID, approved scope revision and approval/source links                                                                           |
| `stage`, `role`, `outcome`                        | Boundary and responsible role; `started`, `ongoing`, `passed`, `failed`, `blocked`, `cancelled` or `not_applicable`                                              |
| `revision`                                        | Repository, exact relevant base/head/tested SHA or null with a limitation; resource/branch identities belong in the human handoff                                |
| `execution`                                       | Configured model/effort, observed model/effort or null, available context ID or null, fresh/inherited/unknown context, routing reason                            |
| `evidence`                                        | Source links and compact observed checks: run ID, check-run/job ID, attempt, name, conclusion, workflow identity/revision, head SHA and synthetic-merge relation |
| `findings`, `limitations`, `owner`, `next_action` | Actionable outcome, honest unknowns and who continues; empty findings means none observed in stated coverage                                                     |
| `intervention`                                    | `planned_decision`, `rescue`, `none_observed`, `unknown` or `not_applicable`, reason/source links and observation coverage                                       |
| `correction_cycle` (optional)                     | Null/absent makes no assertion; declare `{id, source_stage, cause}` once, then reference the same cycle with `{id}`                                              |
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

Scope sources and evidence sources use the same HTTPS URL contract. Link the
authoritative issue/scope record even when approval originated in chat; describe
that provenance on the linked record rather than inventing an approval URL.

## Substantive correction cycles

In structured records, declare a cycle only when observed testing, review or CI findings require a
substantive correction round and subsequent verification. Use a globally stable
ASCII token ID (for example a UUID), `source_stage: testing | review | ci`, and a
short cause; link the finding through `evidence.sources`. Declare it once on the
owning attempt, then use `{id}` in later fix/retest/review reports for that same
round. Repeated reports, multiple commits and continuing work on unresolved
findings do not create new cycles. A new substantive finding after correction may
start a new cycle. Setup/billing failures, routine CI reruns, planned product
decisions and corrections to record wording are not substantive rework cycles.

An evaluator can use declared IDs to reconcile repeated reports and distinguish
substantive rounds. Ordinary prose can establish a round through the original
finding, correction and verification links; an ID is not required. Do not infer
counts from comments/commits. Null/absent means unknown/no assertion, not zero.
Record the observation coverage in limitations or linked testing/review evidence.
Even a complete set of retrieved comments cannot establish zero cycles without
explicit coverage of the relevant work; partial coverage remains unknown.

## Corrections, cohorts and limits

Append outcome comments. Correct a material error with a linked explanation that
identifies the replaced claim; for structured records use a new event ID listing
the superseded IDs. Do not silently edit/delete history. An index may change, but it must retain links to
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
waiting and is not active effort. Distinguish measured command duration from
waiting/interruption and unknown duration; do not infer active effort or time
savings from comment timestamps. Link confirmed regressions without inventing
causation. Missing cost remains unknown and never gates delivery. Keep secrets,
financial/authentication data and raw private conversations out of records.

The evaluation skill retrieves the relevant issue/PR discussions and reviews with
pagination, then follows precise check/run or supporting links needed to assess
the requested outcomes. Record retrieval gaps, edits, duplicates, contradictions
and unavailable sources; do not turn an incomplete observation into proof of
failure or success. No generic crawler or exhaustive historical-check sweep is
required. These records do not authenticate roles or add a merge gate; #305 owns
enforcement separately.

## Objective validation

For optional structured records, use the ignored environment from [skill validation](skill-authoring.md):

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
