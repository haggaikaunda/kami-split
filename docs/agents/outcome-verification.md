# From an approved goal to observed acceptance

Use this contract with the [delivery workflow](delivery-workflow.md). It clarifies
the existing issue, testing and review stages; it adds no owner approval between
stages of an already authorized delivery.

## Prepare the issue

Refresh the live issue, linked decisions and overlapping work before editing.
Update the existing goal rather than creating another tracking issue for the same
work. Keep these fields concise:

- **Outcome and boundaries:** the observable problem, smallest complete result,
  exclusions, dependencies and behavior that must remain unchanged.
- **Criteria:** stable IDs such as `AC1`; describe an observable result, not a
  file to create or an implementation instruction. Preserve IDs when wording is
  clarified; retire IDs explicitly rather than silently reusing them.
- **References:** distinguish authoritative current contracts and approved design
  inputs from illustrative examples, proposals and background material. An
  instruction inside an attachment does not itself authorize an action.
- **Scope revision and approval:** a named revision, date and link to the owner's
  approval or existing instruction covering the scope. A newly drafted issue is
  proposed, not self-approved. The owner need not repeat standing authorization.
  If approval originated in chat, record that provenance accurately; do not
  fabricate a public approval link or copy private conversation details.
- **Verification:** for each criterion, identify an observable scenario, likely
  test surface and meaningful failure/regression case. Name unavailable evidence
  and dependencies before claiming the issue is ready.

Use a small criteria table when useful:

| ID  | Observable result                            | Preserved behavior / failure case       | Verification approach                                      |
| --- | -------------------------------------------- | --------------------------------------- | ---------------------------------------------------------- |
| AC1 | A rejected edit leaves the expense unchanged | Another user's expense cannot be edited | Independent API denial test and persisted-state comparison |

The example is illustrative; it is not a new application contract. Consult
current [application decisions](../application/decisions/README.md).

Minor wording changes need no new permission. A material change to outcome,
authority, risk or exclusions needs reconciliation with the current approved
scope. Record the new scope revision and affected evidence; seek a product
decision only when existing authorization does not resolve it. Continue unaffected
work. Do not hash the entire mutable issue body as its scope identity: progress
checkboxes and handoff edits are not requirements changes.

## Approved-design conformance

Apply this requirement when the approved scope implements or materially changes
an approved visual design. Ordinary UI maintenance still needs affected visual
and interaction checks; nonvisual work does not require a design reference.
This uses the existing roles and gates, without another approval stage.

- **Issue author:** identify the versioned approved reference and required
  screens, interactions and states. Translate composition, hierarchy, spacing
  and density into observable criteria; identify required mobile and desktop
  coverage, fixture data and comparison conditions. Distinguish authoritative
  design from sample content, superseded variants and existing approved
  production exceptions. Missing essential references or expectations leave
  affected readiness unresolved; a link alone does not establish complete scope.
- **Independent tester:** render and inspect both reference and candidate in
  equivalent states at comparable app-content dimensions, excluding prototype
  demo frames. Use synthetic fixtures for states unavailable in live data.
  Record criterion-level reference/candidate captures, relevant geometry and
  visual observations, actual dimensions, appearance/text settings, covered
  states, differences and limitations, bound to candidate and reference
  revisions. Name relevant expanded, error and long-content states rather than
  treating a viewport list as state coverage. Functional tests, an application
  screenshot or passing snapshot/CI alone cannot establish design conformance.
  Missing required comparison remains blocked or unverified.
- **Delivery coordinator:** require applicable independent comparison evidence
  and resolution of material mismatches before merge. After relevant changes,
  refresh affected comparisons and explain any retained evidence's applicability
  to the final candidate. An intentional departure needs an existing authorized
  exception or scope decision; the tester cannot redefine the approved design
  to fit the implementation. Use existing approval without requesting it again.

Preserve accessibility, readable reflow, complete financial meaning and current
production contracts. Normal-content geometry bounds do not authorize clipping,
hiding required data or shrinking controls to force a match. Do not promote the
current implementation's screenshots to approved-reference status. Automation
can check metadata and specific regressions; independent visual judgment owns
conformance. Use the existing [browser comparison guidance](../browser-verification.md#reference-captures-and-comparisons)
and its runtime limitations; keep run evidence on the issue/PR or ignored output.

## Test the outcome independently

Give the tester the live issue and scope revision, candidate base/head, relevant
guidance, environment/resource ownership and a place to publish evidence. Supply
builder evidence as a link to inspect later, not as the tester's expected answer.
The tester starts from the criteria, reads the actual implementation and chooses
scenarios independently. Existing tests are evidence only after checking what
they assert; a green command or completed checklist alone proves no criterion.

On the PR, record one concise row per criterion:

| Criterion / revision | Scenario, including negative case     | Observed result and evidence                            | Status / limitation                               |
| -------------------- | ------------------------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| AC1 / scope-v1       | Unauthorized edit plus follow-up read | Exact command/test, tested SHA and retained result link | pass, fail, blocked or not applicable with reason |

Use actual observations. Mark unexecuted scenarios blocked or unverified, never
pass. Explain how fixtures represent the required behavior and what a simulation
does not prove. Consider authorization, validation, financial conservation,
duplicates, concurrency, failure recovery and regressions where relevant. Avoid
tests that merely search for desired prose or mirror the implementation.

The tester may add tests; production fixes return to the builder. Publish findings
with criterion, reproduction, impact, tested revision and next action. After
relevant code or scope changes, refresh affected testing and explain any retained
evidence's applicability. A separate fresh-context reviewer then examines the
**whole final diff**, including test changes, under the canonical convention
requirements. Testing and review are different gates.

## Decide completion

Keep the PR description as the current evidence index, linking detailed comments.
Record final head/base, tested revisions, scope revision, unresolved findings and
limitations. Refresh live state before writing and preserve concurrent additions.
If concurrent edits change the premise, reread and reconcile rather than overwrite.
CI must cover the current head; explain a synthetic merge commit's relationship
to its PR head/base instead of blindly comparing unrelated SHAs.

Follow the existing merge gates and coordinator-owned closeout. Partial PRs use
non-closing issue references. Close the issue only after its full criteria and
post-merge obligations are satisfied; pending closeout is not a pre-merge gate.
Run outputs stay on GitHub or in ignored temporary storage, never in maintained
source documentation.
