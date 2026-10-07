# Issue #206 existing-checkout cleanup evidence

Observed 2026-10-06 in the owner’s existing checkout:
`/Users/haggaikaunda/workspace/codex/kami-split`, origin
`https://github.com/haggaikaunda/kami-split.git`.

## Observation and execution

- Task-start fetched/pruned origin/main: `fc7b1cef0064fc330b9dd72647d57ada856ee337`.
- Task-start primary local main: `69fcbe6b583f1264ee25920a5833345cf091712b`; behind remote, not synchronized.
- Primary branch: `codex/issue-111-household-summary`; untracked files present.
  Owner confirmed these files were unused and authorized cleanup. Preserved them
  in `/private/tmp/kami-206-preserved-primary/`, switched primary to main and
  fast-forwarded it. No stash, reset or file deletion.
- Implementation worktree: `/private/tmp/kami-206`, created from freshly fetched
  origin/main. Primary synchronization was completed separately after owner reply.
- Refreshed all closed/open PR pages, individual candidate PRs and merge inclusion;
  verified exact tips and no linked worktree before each local expected-tip
  `git update-ref -d` deletion. The first 12 removed candidates were squash-merged heads;
  guarded deletion avoids an unguarded force-delete race. Branch configuration
  sections were removed for those exact deleted branches.
- Before: 32 local branches (excluding the new implementation branch), 18 linked
  worktrees. After: 19 original branches retained, plus the implementation branch;
  all original worktrees preserved. No worktree removal was attempted without
  established ownership/disposability. Their status inspections were clean except
  the dirty primary; clean status does not prove inactivity or ignored-file safety.
- Fresh remote inventory: only main and four open Dependabot branches. Every
  merged PR source branch in the local inventory was absent in successful server
  queries; no remote deletion was necessary. Setting `delete_branch_on_merge=true`
  confirmed and preserved. Remote branches report `protected=false`; rulesets API
  returned HTTP 403 (plan unavailable), so no ruleset-based deletion authority is
  asserted and no remote ref was mutated.
- Pruned 22 stale remote-tracking refs. Final fetch/prune and repeat inspection
  left the remaining inventory unchanged. Primary is now clean on main, with both
  local main and origin/main equal to `fc7b1cef0064fc330b9dd72647d57ada856ee337`.
  PR #178 merge inclusion was verified; its released local branch was deleted
  with exact-tip guard and its remote absence verified. Total: 13 deletions.
  This is partial cleanup because other worktree owners remain unconfirmed.

## Before / after candidate inventory

All matched PRs below are merged into main in this same repository, with their
recorded merge commits included in observed origin/main. Head tips are full SHAs;
PR links identify the authoritative merge records. `Removed` means exact-tip
local deletion and independently verified remote absence. `Blocked` means linked
worktree ownership/disposability is unknown (primary was initially dirty). `Retained`
means no unique exact merged-head proof, protected main, or this current task.

| Branch                                 | Before tip / final merged head when matched | PR                                                          | After / reason                                                                     |
| -------------------------------------- | ------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `codex/147-probe-aliases`              | `f9e3503d5fc3598a26238213fdb86566d374a490`  | [#149](https://github.com/haggaikaunda/kami-split/pull/149) | Blocked: linked worktree: ownership/disposability not established                  |
| `codex/151-rest-promotion`             | `72a21717e51ae05e8b27c8f7430bca2592a9683b`  | [#154](https://github.com/haggaikaunda/kami-split/pull/154) | Blocked: linked worktree: ownership/disposability not established                  |
| `codex/151-vercel-staged-verification` | `935be8e923079964c7fdeb4910b4833a1e4b30fa`  | [#152](https://github.com/haggaikaunda/kami-split/pull/152) | Blocked: linked worktree: ownership/disposability not established                  |
| `codex/167-quietly-warm-patterns`      | `65c4db27808aa0e72f3cf816081976562bf60603`  | [#173](https://github.com/haggaikaunda/kami-split/pull/173) | Removed: exact merged head, no worktree/open or dependent PR                       |
| `codex/168-quietly-warm-onboarding`    | `864a7af16dbd78e108bc45a36476c6c1eb0661f2`  | [#179](https://github.com/haggaikaunda/kami-split/pull/179) | Blocked: linked worktree: ownership/disposability not established                  |
| `codex/184-remove-seeded-preview`      | `778d2477a38f65765bb5895b0bcfe4d4ee5e433a`  | [#188](https://github.com/haggaikaunda/kami-split/pull/188) | Removed: exact merged head, no worktree/open or dependent PR                       |
| `codex/api-ci-parallel`                | `86a1e673a450d60cd38b076bbafeb099dda64ae2`  | [#150](https://github.com/haggaikaunda/kami-split/pull/150) | Blocked: linked worktree: ownership/disposability not established                  |
| `codex/household-canonical-navigation` | `2827f03b1122fdcc265c2949c80b848c55ef4399`  | [#203](https://github.com/haggaikaunda/kami-split/pull/203) | Removed: exact merged head, no worktree/open or dependent PR                       |
| `codex/issue-105-group-discovery`      | `c1b34e15f8717bc717981746d26a22a81619da4e`  | [#180](https://github.com/haggaikaunda/kami-split/pull/180) | Blocked: linked worktree: ownership/disposability not established                  |
| `codex/issue-106-group-creation`       | `12763f52b89d718003074af6ce82212efb0160bd`  | [#185](https://github.com/haggaikaunda/kami-split/pull/185) | Blocked: linked worktree: ownership/disposability not established                  |
| `codex/issue-111-household-summary`    | `02f3ba15ef5e4032052be468dd6931679049b02b`  | [#178](https://github.com/haggaikaunda/kami-split/pull/178) | Removed after authorized primary synchronization; exact merged head, remote absent |
| `codex/issue-112-household-workspace`  | `d97c9012e826a54570c5ad751376f19228d2fbe6`  | [#187](https://github.com/haggaikaunda/kami-split/pull/187) | Removed: exact merged head, no worktree/open or dependent PR                       |
| `codex/issue-114-final-verification`   | `92813b38011dce82f38f047e1edac18504b2b593`  | —                                                           | Retained: no unique exact merged PR head                                           |
| `codex/issue-164-onboarding`           | `ca59555314ae1715c79ca08e928d75db9aed1fe5`  | [#165](https://github.com/haggaikaunda/kami-split/pull/165) | Blocked: linked worktree: ownership/disposability not established                  |
| `codex/issue-169-cross-space-expenses` | `257a630ade77162574620474b63350894de45484`  | [#182](https://github.com/haggaikaunda/kami-split/pull/182) | Removed: exact merged head, no worktree/open or dependent PR                       |
| `codex/issue-170-expenses`             | `867837a3ac01b8fe5452f57df6e6ae1699f25b3b`  | [#186](https://github.com/haggaikaunda/kami-split/pull/186) | Blocked: linked worktree: ownership/disposability not established                  |
| `codex/issue-171-workspaces`           | `9253c50762d16d3a068a43aa6d5d5c74e61c1505`  | [#183](https://github.com/haggaikaunda/kami-split/pull/183) | Blocked: linked worktree: ownership/disposability not established                  |
| `codex/issue-172-activity`             | `e9a80947254e6b21455e280fd0aa0927115b65ef`  | [#181](https://github.com/haggaikaunda/kami-split/pull/181) | Blocked: linked worktree: ownership/disposability not established                  |
| `codex/issue-189-approved-references`  | `85e6e47dca5bdb0ba19aa93c85e29533f122bb0f`  | [#190](https://github.com/haggaikaunda/kami-split/pull/190) | Removed: exact merged head, no worktree/open or dependent PR                       |
| `codex/issue-189-screen-adoption`      | `4903cc62b218d27ddc3b51d5b6a0af6ee8abab74`  | [#192](https://github.com/haggaikaunda/kami-split/pull/192) | Removed: exact merged head, no worktree/open or dependent PR                       |
| `codex/issue-189-visual-foundation`    | `e5590a7752fc0a6d46b382bea967d1ce28378237`  | [#191](https://github.com/haggaikaunda/kami-split/pull/191) | Removed: exact merged head, no worktree/open or dependent PR                       |
| `codex/issue-193-navigation`           | `2eebf4613e11bc6cc3d330a3251ce9eb7e3862e1`  | [#194](https://github.com/haggaikaunda/kami-split/pull/194) | Removed: exact merged head, no worktree/open or dependent PR                       |
| `codex/issue-197-household-membership` | `949a678d00bc3e6771b7de1cf6d566d57862590b`  | [#198](https://github.com/haggaikaunda/kami-split/pull/198) | Removed: exact merged head, no worktree/open or dependent PR                       |
| `codex/issue-197-retire-designation`   | `d56f8f1c2df1a25a21d969a99257ab2cada959b8`  | [#200](https://github.com/haggaikaunda/kami-split/pull/200) | Removed: exact merged head, no worktree/open or dependent PR                       |
| `codex/issue-202-personal-account`     | `9a8b840b7e789d47a0b965add5fcf7949b92ce5e`  | [#204](https://github.com/haggaikaunda/kami-split/pull/204) | Blocked: linked worktree: ownership/disposability not established                  |
| `codex/issue-206-delivery-closeout`    | `fc7b1cef0064fc330b9dd72647d57ada856ee337`  | —                                                           | Retained: current task                                                             |
| `codex/kami-grow-branding`             | `b1f39b983136b71763a7286dd3efdca29fbb50f7`  | [#196](https://github.com/haggaikaunda/kami-split/pull/196) | Removed: exact merged head, no worktree/open or dependent PR                       |
| `codex/percentage-splits-199`          | `ba434a7fa0b640dd19ce2e5e68452284dd975d3d`  | [#205](https://github.com/haggaikaunda/kami-split/pull/205) | Blocked: linked worktree: ownership/disposability not established                  |
| `codex/remove-legacy-health-endpoints` | `1ceceee66792165aca426659211fb232695fbcf3`  | [#160](https://github.com/haggaikaunda/kami-split/pull/160) | Blocked: linked worktree: ownership/disposability not established                  |
| `codex/vercel-alias-confirmation`      | `b11c357545cc73e8277e82ae03f0c32850701718`  | [#155](https://github.com/haggaikaunda/kami-split/pull/155) | Blocked: linked worktree: ownership/disposability not established                  |
| `codex/vercel-automation-bypass`       | `3ac73f7467e8feb0e510c2e7e97a3a9fe277f4e2`  | [#153](https://github.com/haggaikaunda/kami-split/pull/153) | Blocked: linked worktree: ownership/disposability not established                  |
| `hkaunda/smoke-production-db`          | `97e98accd11eab205a5adfb0a143c72f5bd20eb6`  | —                                                           | Retained: no unique exact merged PR head                                           |
| `main`                                 | `69fcbe6b583f1264ee25920a5833345cf091712b`  | —                                                           | Retained: protected primary main; synchronization pending                          |

## Confirmed merge commits for removed branches

| PR   | Merge commit in observed origin/main       |
| ---- | ------------------------------------------ |
| #178 | `3e651742845ee5ae8dab3969d6d87784565af0bb` |
| #173 | `69fcbe6b583f1264ee25920a5833345cf091712b` |
| #188 | `19897a1a10601a79ad9a3bf6fd44ee2c1972c22a` |
| #203 | `fd9389ccf036488f4df43b1a4d9dfdf936e0096c` |
| #187 | `225780b94f185cfcb7502863944312575b2c6c2b` |
| #182 | `f08d7cbad314ff003748a1c63e3b11a84bff09a3` |
| #190 | `29b4fc7e49237cf996b2eb8792ca82ded5b7d1a7` |
| #192 | `308a21a71e8fe16bfeb283983a33b8da23464fa6` |
| #191 | `c1b403781b632cf6b9c51b13633dd0550b424d1e` |
| #194 | `52f7aa5c4f90a50bbd978309536a051a955230ff` |
| #198 | `641b578b9375b2d8578d7c69e5440454c22aec4e` |
| #200 | `3e6f04eba6120e90368ac8f4bdfe618198d04362` |
| #196 | `87b13829704b39b281b916173ba279a52290b549` |

## Outstanding execution handoff

The delivery coordinator in this chat owns remaining closeout. Primary synchronization is complete with owner authorization and explicit SHA
equality. Preserved files are available at `/private/tmp/kami-206-preserved-primary/`;
retain or relocate that recovery copy as needed. Owners of the retained linked worktrees must confirm
completion, inactivity, disposable status and valuable ignored-file preservation
before removing them and their exact merged branches. The unmatched
`codex/issue-114-final-verification` and `hkaunda/smoke-production-db` branches
require investigation and remain preserved.

This implementation PR must independently pass testing/review and required CI
before merge. Its own final head/merge SHA, branch/worktree removal, primary/main
synchronization and remote absence must then be recorded on the PR and issue.
Use a non-closing reference to #206 until these obligations are complete. This
historical evidence records observed state; it does not claim future synchronization.

## Retained worktree locations

| Branch                                 | Worktree                                                                     | Disposition                                  |
| -------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------- |
| `codex/147-probe-aliases`              | `/Users/haggaikaunda/.codex/worktrees/probe-aliases/kami-split`              | Retained; ownership/disposability unknown    |
| `codex/151-rest-promotion`             | `/Users/haggaikaunda/.codex/worktrees/151-rest-promotion/kami-split`         | Retained; ownership/disposability unknown    |
| `codex/151-vercel-staged-verification` | `/Users/haggaikaunda/.codex/worktrees/vercel-staged-verification/kami-split` | Retained; ownership/disposability unknown    |
| `codex/168-quietly-warm-onboarding`    | `/private/tmp/kami-split-168`                                                | Retained; ownership/disposability unknown    |
| `codex/api-ci-parallel`                | `/Users/haggaikaunda/.codex/worktrees/api-ci-parallel/kami-split`            | Retained; ownership/disposability unknown    |
| `codex/issue-105-group-discovery`      | `/private/tmp/kami-issue-105`                                                | Retained; ownership/disposability unknown    |
| `codex/issue-106-group-creation`       | `/private/tmp/kami-issue-106`                                                | Retained; ownership/disposability unknown    |
| `codex/issue-114-final-verification`   | `/Users/haggaikaunda/.codex/worktrees/api-conformance/kami-split`            | Retained; ownership/disposability unknown    |
| `codex/issue-164-onboarding`           | `/Users/haggaikaunda/.codex/worktrees/invitation-onboarding/kami-split`      | Retained; ownership/disposability unknown    |
| `codex/issue-170-expenses`             | `/private/tmp/kami-170`                                                      | Retained; ownership/disposability unknown    |
| `codex/issue-171-workspaces`           | `/private/tmp/kami-issue-171`                                                | Retained; ownership/disposability unknown    |
| `codex/issue-172-activity`             | `/private/tmp/kami-issue-172`                                                | Retained; ownership/disposability unknown    |
| `codex/issue-202-personal-account`     | `/private/tmp/kami-split-202`                                                | Retained; ownership/disposability unknown    |
| `codex/issue-206-delivery-closeout`    | `/private/tmp/kami-206`                                                      | Current implementation, owned by coordinator |
| `codex/percentage-splits-199`          | `/private/tmp/kami-percentage-199`                                           | Retained; ownership/disposability unknown    |
| `codex/remove-legacy-health-endpoints` | `/Users/haggaikaunda/.codex/worktrees/api-deployment-rehearsal/kami-split`   | Retained; ownership/disposability unknown    |
| `codex/vercel-alias-confirmation`      | `/Users/haggaikaunda/.codex/worktrees/vercel-alias-confirmation/kami-split`  | Retained; ownership/disposability unknown    |
| `codex/vercel-automation-bypass`       | `/Users/haggaikaunda/.codex/worktrees/vercel-bypass/kami-split`              | Retained; ownership/disposability unknown    |
