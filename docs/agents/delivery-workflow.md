# Delivery workflow

This is the canonical process for all repository changes: web, API, schema, infrastructure, and documentation. The root [AGENTS.md](../../AGENTS.md) summarizes mandatory policy. Area instructions add verification requirements; they do not replace this loop.

## Repository content and run outputs

Commit code, meaningful tests, required generated source, approved design inputs and maintained technical documentation. Put issue-specific verification results, screenshots, logs, review reports, acceptance status, work plans and task-start/merge/checkout closeout evidence on the tracking issue or PR, not in repository files. Documentation updates must explain lasting behavior or procedures, not record that a particular run passed. A historical label does not make work-tracking material appropriate for the repository.

Write run outputs to ignored `test-results/` or an external temporary directory. Preserve useful fixtures, test baselines and approved design inputs; classify by purpose and consumers. Before committing and during final review, inspect staged/final files for accidental evidence, task plans and copied issue specifications. Check documented behavior against the actual code. Publish unique history on its owning issue/PR before removing it; preserve original provenance and privacy. This changes evidence placement, not independent testing, whole-final-diff review, final-head CI or post-merge closeout obligations.

## Pull request lifecycle

1. **Ready issue:** scope, acceptance criteria, exclusions, and test notes are clear. Perform the task-start synchronization below and record the observed SHA or blocker.
2. **Builder:** implements the smallest complete solution in a worktree, opens a draft PR, and records the convention self-check below before requesting final review.
3. **CI:** deterministic formatting, linting, type checking, unit tests, and build checks pass.
4. **Tester:** independently compares the behavior and tests with the issue. The tester may add test-only commits; production changes return to the builder.
5. **Reviewer:** reviews the whole final diff with fresh context and records prioritized findings and convention evidence below.
6. **Resolution:** findings are fixed or explicitly resolved; CI reruns after all changes.
7. **Merge:** an agent may squash-merge only when every gate below is satisfied.
8. **Closeout:** the delivery/merge coordinator executes the post-merge closeout below and records outcomes or blockers. Each agent owns its own disposable worktrees. If another session merges, explicitly hand off cleanup to the agent with access to the original checkout.

## Shared source-of-truth updates

Before updating issue bodies, PR descriptions, decision records, or equivalent collaborative source-of-truth content, refresh the current live issue, PR, and relevant decision state. Reconcile the intended edit with that state and preserve newer concurrent changes; never overwrite them from a stale snapshot.

## Partial issue delivery

A PR may merge while its linked issue remains open. Merging a partial, design, or foundation PR does not by itself close the issue: use a non-closing issue reference and explicitly record remaining work on the issue. Close an issue only when its full acceptance criteria and required gates are satisfied.

## Merge gates

- The PR is linked to an approved issue and is not a draft.
- Required CI checks pass on the current head commit.
- Independent testing and whole-final-diff review outcomes, including applicable convention evidence below, are recorded on the PR.
- No unresolved blocking conversations remain.
- No agent merges its own unreviewed work or bypasses protection.

## CI ownership and required check

`.github/workflows/ci.yml` owns pull-request and main-push triggers, read-only
permissions, cancellation of superseded runs, and the single required **Verify**
check. It runs repository validation and the centralized change classifier, then calls
`web.yml` and/or `api.yml` only for affected consumers. See the
[affected-path contract](change-aware-ci.md) for comparison identities, conservative
fallbacks, and selective release semantics. Both reusable workflows use only
`workflow_call`; their caller owns selection and concurrency.

`web.yml` owns pnpm/Node setup, the root-lockfile cache, lint, type checking, web tests, the Next.js build, and the required Playwright Chromium smoke suite, in order. The browser suite reuses that build with one worker on the same runner and uploads failure artifacts for seven days.
Repository-wide formatting runs exactly once in the repository validation job,
alongside classifier/gate tests, even for documentation-only changes.
`api.yml` runs three independent jobs concurrently, each on its own GitHub-hosted
runner with a 15-minute limit:

- **Go source checks:** Go setup/module cache, Cloud Run traffic-selection tests,
  and authoritative `make api-check` coverage (formatting, module integrity, vet,
  regular/race tests, build, and gqlgen generation drift).
- **Database integration checks:** Go setup/module cache, pinned database tools,
  sqlc drift, and `make db-test` migration/permission/integration/reset/replay and
  dump/restore checks. The script owns a unique disposable Supabase project and
  an EXIT trap for cleanup.
- **Container and local startup checks:** pinned database tools, Compose
  validation, one production image build, readiness and live GraphQL smoke,
  then coordinated Supabase/API startup via `make dev-up DEV_BUILD_FLAG=--no-build`.
  Both startup modes reuse the same runner-local image; normal `make dev-up`
  still builds by default. Separate unconditional Compose and Supabase cleanup
  steps ensure either cleanup is attempted even if the other fails.

Runner isolation prevents cross-job port/project conflicts and teardown. No Docker
state is assumed to be shared across runners. The Dockerfile's `verify` target
remains available for manual use, but CI does not duplicate host Go verification
through it. Web checks retain their own runner and 15-minute limit.

The **Verify** job waits for repository validation and both calls with `always()`.
It requires successful repository validation and each affected result to equal
`success`; only an explicitly inapplicable branch may equal `skipped`. Missing
classification, failures, cancellation, and unexpected skips fail the gate. The reusable API result aggregates all
three required jobs; none is optional or uses `continue-on-error`. Failure, cancellation, or unexpected skipping of
an applicable dependency cannot produce a passing gate. Child checks have distinct names;
branch protections should continue to require **Verify**. Do not change protections
to accommodate this layout.

## Independence

Builder, tester, and reviewer are independent roles with separate agent/task contexts and role-specific prompts. Testing begins from the issue requirements, not the builder's summary. Review evaluates the actual final diff.

## Role prompts and evidence

Use separate contexts with the [builder](prompts/builder.md), [tester](prompts/tester.md), and [reviewer](prompts/reviewer.md) prompts. Record the tested/reviewed commit, requirements coverage, commands and outcomes, findings, and limitations on the PR. After changes, rerun affected checks and obtain independent re-testing or re-review as appropriate so the evidence covers the final diff.

Use the [PR template](../../.github/pull_request_template.md) to collect evidence, not as a substitute for executing verification. Follow [web instructions](../../apps/web/AGENTS.md) or [API instructions](../../apps/api/AGENTS.md) for area-specific checks. Documentation-only work should validate links and accuracy without adding tests that merely mirror prose or file layout. Existing required repository checks still apply; Go and real-database integration checks are documented in the API instructions.

### Convention evidence

The PR template's **Convention evidence** section is the single index for the builder self-check and independent reviewer evidence; link detailed PR comments there instead of duplicating them. Keep evidence concise and proportional to the diff. The builder performs a lightweight self-check against applicable root/area instructions and linked architecture, language, and contract guidance before requesting final review, recording substantive architecture, readability, and documentation risks under **Assumptions, trade-offs, and risks**.

The independent reviewer records the exact head commit and base/diff reviewed, explicitly confirms examining the whole final diff with fresh context, and supplies an outcome for each category below. Name changed surfaces and governing guidance with a short reason for conformance or a finding; if a category does not apply, explain why. A generic “conventions checked” assertion is insufficient.

| Category                               | Required examination when applicable                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture / module boundaries       | Identify packages/modules whose responsibilities changed and compare those responsibilities with governing architecture and area instructions. Explain intentional boundary changes and their justification; flag unjustified deviations.                                                                                                                                                 |
| Readability / cohesion                 | Inspect responsibility-dense changed functions and tests, including large handlers and multi-scenario harnesses. Explain whether decisions and effects remain cohesive or need decomposition by responsibility, without arbitrary line-count limits.                                                                                                                                      |
| Documentation / current-state accuracy | For implemented, retired, or materially changed capabilities, search the repository for stale planned/deferred/implemented claims and reconcile current guides, instructions, and operational documentation. Record search scope/terms and disposition of relevant matches. Distinguish historical ADRs/design/evidence from current-state guidance; do not mechanically rewrite history. |
| Error / ownership boundaries           | Trace where unexpected failures are consumed and identify one safe owning diagnostic boundary, preserving reporting without duplicate logging or sensitive-data exposure. Examine retained mutable values and dependencies where relevant, including copying depth and explicit ownership.                                                                                                |
| Public contracts / generation          | Check exported handwritten documentation and authoritative SDL descriptions against caller contracts; verify generated-source ownership and applicable regeneration/drift checks rather than hand-editing generated output.                                                                                                                                                               |

After fixes, the final reviewer must examine the whole updated final diff, not just previously reported findings, and record evidence for the new head. A finding-only re-review cannot satisfy the final gate. Independent requirements testing remains distinct: it proves issue acceptance criteria rather than substituting for convention review.

Preserve the existing review priorities: financial, authorization, privacy, data-integrity, concurrency, and breaking-change defects outrank maintainability/style findings. Require actionable reasoning under repository policy, not speculative interfaces, generic repository layers, gratuitous helpers/packages, comment noise, or wholesale external style-guide adoption. Add automation only for useful objective checks (such as exported documentation or generation drift); architecture and readability remain review judgments, never architecture-by-regex or function-size linting.

Mark the PR ready only after findings are resolved. Satisfy required GitHub approvals and branch protections as well as independent testing/review. Never bypass protections or merge with failing or missing required checks. After an authorized merge, complete the closeout below before reporting delivery complete. Keep pre-merge gates separate from post-merge completion evidence.

## Task-start synchronization and post-merge closeout

The coordinator owns closeout through evidence or an explicit execution handoff;
merging in another session does not remove that responsibility. Coordinate access
to the designated primary checkout with its owner. Each agent removes only its own
completed, clean, disposable worktrees. Unknown ownership is a blocker, even when
a PR was merged.

At task start, inspect the primary checkout and linked worktrees, confirm `origin`
identifies this repository, and fetch/prune fresh state. On a clean primary
checkout without in-progress Git operations, switch to `main` and run
`git pull --ff-only origin main`. Explicitly verify `main` equals `origin/main`
and record that observed SHA. An ahead local `main` is a blocker even if pull
succeeds. If primary synchronization is blocked, record why and start an isolated
worktree from the freshly fetched `origin/main`; never claim the primary was
synchronized. Do not force a second checkout of `main` or update its ref behind
another active worktree.

After an authorized merge, execute these steps in order:

1. Refresh GitHub state. Confirm the PR was **merged into `main`**, rather than
   merely closed. Record repository, source repository/branch, final merged PR
   head SHA and merge commit SHA. A requested merge or successful command alone
   is insufficient evidence.
2. Inspect the affected repository, current branch, working-tree status (including
   untracked files), branch tips/upstreams, linked worktrees, locks and in-progress
   Git operations. Confirm `origin` identifies the recorded repository. Run
   `git fetch --prune origin`; failures stop dependent operations.
3. Return the designated primary checkout to clean `main` and run
   `git pull --ff-only origin main`, or fetch plus fast-forward-only merge. Verify
   **equality** of local `main` and freshly fetched `origin/main`, and that the
   confirmed merge commit is an ancestor of `origin/main`. Record both SHAs. Do
   not commit, rebase, reset or create a merge commit on `main` for cleanup.
4. Remove the completed local feature branch only after proving its exact tip
   matches the final merged PR head, the merge is in `origin/main`, and no open or
   dependent PR or other ongoing work uses it. Inspect and remove only an owned,
   clean, disposable worktree before deleting its branch; preserve valuable
   ignored configuration outside it first. Finish in the designated primary
   checkout, never in a deleted directory. Prefer ordinary `git branch -d` under
   coordinated exclusive access. For squash merges, use narrowly scoped deletion
   guarded by the expected tip as described in the procedure below; never use
   blanket force-delete pipelines.
5. Recheck `delete_branch_on_merge` remains enabled. Verify the exact source ref
   on the remote server, independently of pruning. If a same-repository source
   branch survives, recheck current tip, protections, merged PR and ongoing or
   dependent work before deleting only that ref with a tip guard; verify absence
   again and prune as needed. Preserve advanced/reused branches. Fork branches
   require separate ownership and permission handling. Restore an unexpectedly
   disabled setting only with repository administration authority; otherwise
   report the discrepancy without weakening protections or adding write workflows.

Squash merges do not make the old head an ancestor of `main`. Neither
`git branch --merged main`, branch age/name, nor missing upstream proves delivery.
Use GitHub merge evidence and exact branch-tip verification. Preserve `main`,
protected/long-lived branches, open/dependent PR branches, extra/unpushed commits,
reused names and ambiguous candidates. Immediately recheck tips and ownership
before mutation, guard automated deletion against concurrent advancement, and
serialize shared-checkout operations. Never switch, reset, detach, remove or
force-unlock another agent's active worktree.

Dirty worktrees, ahead/diverged `main`, in-progress Git operations, locked
worktrees, unknown ownership and network/authentication/permission failures stop
the affected destructive operation and require an actionable report. Do not
implicitly stash, run `reset --hard` or `git clean`, or discard tracked, untracked
or valuable ignored files. Unaffected safe operations may proceed with recorded
partial outcomes. Already-absent refs/worktrees are harmless on a repeat run;
absence must still be proven, not inferred from an error.

Use the [repeatable cleanup procedure](branch-cleanup.md) for inspection, guarded
mutation, and the one-time existing-checkout audit. An isolated clone or CI run
cannot establish cleanup of the owner's actual checkout.

### Final handoff evidence

Record the PR/repository, merge confirmation, final merged head and merge commit,
observed local/remote `main` SHAs and equality/merge inclusion, primary path/status,
local branch and owned worktree dispositions, automatic deletion setting, exact
remote-ref verification and blockers with an owner/next action. Before/after
inventories must give each cleanup candidate a reason and SHA without exposing
secrets or unrelated local data. Keep post-merge checkboxes unchecked until the
operation occurs; they are not pre-merge gates. Use a non-closing issue reference
while real-checkout cleanup or the delivery's own closeout remains outstanding.

Synchronization is to remote state observed at task start and completion, with
SHAs recorded; an idle clone does not continuously follow future remote commits.
