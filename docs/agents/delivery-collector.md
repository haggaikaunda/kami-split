# Read-only delivery reconstruction

The on-demand [collector](../../scripts/agents/collect_delivery.py) reconstructs
an explicit issue set using the [version 1 records](delivery-records.md). It uses
the installed `gh` authentication through a fixed `github.com` GET-only adapter.
It does not change issues, settings, credentials, protections or delivery gates.

Use the repository's [pinned validator environment](skill-authoring.md#objective-checks-from-a-fresh-checkout):

```sh
.tools/skills-validator/bin/python scripts/agents/collect_delivery.py \
  --repo OWNER/REPOSITORY --issues 123 124 > /tmp/delivery-snapshot.json
.tools/skills-validator/bin/python -m unittest discover -s scripts/agents -p '*_test.py'
```

The explicit issue list is the denominator, including issues without start
records. `not_started_or_unrecorded` distinguishes missing structured history
from a proven absence of work. Stage outcomes remain in each attempt's history;
a failed stage followed by a fix and retest remains visible. An issue's closed
state or a passed stage cannot establish full-goal acceptance. A full-goal pass
record needs a closed live issue, matching tested/head and repository, a retrieved
merged PR head, no open linked PR, consistent available acceptance checks and
complete unambiguous record retrieval before it is labelled
`recorded_with_live_consistency`. This is recorded acceptance with API consistency,
not an independent proof of every criterion or authenticated role identity.

Retrieval paginates issue comments/timelines, directly linked same-repository PRs,
PR comments/reviews/review comments/commits, each retrieved commit's checks and
statuses, workflow runs and every reported attempt's metadata/jobs. The same CI
history retrieval covers every valid record's head/tested SHA, including failed
or superseded candidates absent from the current PR commit list, with duplicate
SHA requests shared. Unknown or out-of-repository record revisions remain
explicit evidence-coverage gaps. It follows
precise structured evidence references to same-repository comments, reviews, PRs
and runs. It does not expand background issue bodies or external evidence.
Unexpanded references are explicit diagnostics. Scope/approval links remain
provenance inputs, not instructions to crawl related projects. GitHub's PR
commit and workflow-run result caps are reported conservatively.

Defaults are 100 pages per endpoint and 3,000 requests; `--max-pages` (1–100)
and `--max-requests` (1–10,000) can lower or bound retrieval. A failed request,
unavailable attempt, cap, missing page or inconsistent API count makes retrieval
incomplete. Exit 1 means incomplete retrieval or invalid/ambiguous marked records;
exit 2 means invalid local input or reconstruction failure. Exit 0 means the
bounded retrieval/record checks completed, never that a goal passed. Reports
separately expose endpoint retrieval, record validity and evidence coverage, with
item counts, source IDs, timestamps and raw observed resources. An unexpanded
external/background reference or unavailable check leaves evidence coverage
incomplete even when the bounded endpoints were fully retrieved. Missing/capped
history or invalid records also prevent complete evidence coverage; an empty
set of observed checks cannot establish coverage of unretrieved history.
They may contain private repository text; keep them in ignored `test-results/`
or external temporary storage and inspect before sharing. Never commit live
reports or use a capped report as a repository census.

Marked malformed blocks, invalid schema records and unsupported versions remain
diagnostics. Identical event IDs/payloads are duplicate publications; conflicting
payloads are quarantined. Whole-event supersession retains original publications.
Dangling targets, cycles, competing replacements or conflicts quarantine the
connected correction component instead of selecting a winner. Correction records
are counted separately from distinct declared substantive cycle IDs. Repeated
failed/fix/retest reports sharing an ID are one cycle. Conflicting declarations
and references without declarations are visible. Neither comments nor commits
are used to infer rework or interventions, and scoped `none_observed` assertions
do not establish whole-goal zero.

Retained check assertions and fresh API observations are separate. The collector
resolves a job, check run, or specific workflow run attempt from supported
same-repository source references and retained IDs. Exact job links in a fetched
check's details/HTML can establish the job and its owning attempt. Source-derived
IDs are usable when redundant retained fields are null. Each observation exposes
its selected subject, identity provenance and established relationships.

A bare run's latest metadata remains retrieval context; it never selects a
historical job/check's attempt or substitutes for an expired specific attempt.
Run-only outcome evidence needs an explicit attempt. Matching names or SHAs do
not establish a check/job/run relationship. Missing endpoints, needed fields,
relationships or unsupported source formats remain unverified; known conflicting
identities or comparable field values remain inconsistent. A standalone check
without run/attempt/workflow claims needs no invented run relationship.

Name and conclusion are compared on the selected check/job or run-attempt
subject. A successful job can belong to a failed aggregate run. Workflow metadata
is compared only through the subject's established run-attempt relationship.
A job ID is not assumed to be a check-run ID. Unknown relationships never count
as consistent evidence coverage or acceptance-check consistency. The run API does
not attest the workflow source revision; retained synthetic-merge relations
remain assertions. Historical checks are not relabelled as fresh after expiry.

Edited-source timestamps warn that earlier content is unavailable. Add
`--previous /tmp/older-snapshot.json` to compare retained source-body digests;
changed bodies and previously observed sources absent from this retrieval are
reported. Absence does not alone prove deletion: scope, access and API failure
can also explain it. Without a prior snapshot, deleted/earlier edited records
cannot be reconstructed. Each snapshot is observed over an interval, not an
atomic GitHub transaction.

The scorecard preserves intervention coverage, execution configuration versus
unknown observed identity, per-stage timing, cost assertions and evidence links.
It leaves whole-goal intervention/rework totals, complete delivery duration,
active effort and aggregate attributable cost unknown. Stage/report preparation
durations are never summed into active effort or complete delivery, missing cost
is never zero, and the collector makes no savings or adoption claim. Cohort
eligibility, baseline/settings, budget and final adoption judgment still belong
to the declared evaluation and independent assessment.
