# Issue #206 existing-checkout cleanup evidence

Observed 2026-10-06 in the owner's existing checkout:
`/Users/haggaikaunda/workspace/codex/kami-split`, origin
`https://github.com/haggaikaunda/kami-split.git`.

## Observation and execution

- Task-start freshly fetched/pruned origin/main:
  `fc7b1cef0064fc330b9dd72647d57ada856ee337`.
- Task-start primary main: `69fcbe6b583f1264ee25920a5833345cf091712b`, behind.
  Primary was on `codex/issue-111-household-summary` with untracked files.
  Owner confirmed the files were unused and authorized cleanup. Preserved them
  in `/private/tmp/kami-206-preserved-primary/`, then switched to main and
  fast-forwarded. No stash, reset, rebase or file deletion.
- Primary is now clean on main; local main and freshly fetched origin/main both
  equal `fc7b1cef0064fc330b9dd72647d57ada856ee337`. Merge inclusion verified.
- Implementation worktree `/private/tmp/kami-206` was created from the freshly
  fetched origin/main while primary synchronization was blocked. Its own PR
  closeout remains a post-merge operation.
- Before: 32 original local branches and 18 original linked worktrees. After:
  29 completed merged branches deleted, 16 completed clean worktrees removed;
  3 original branches and 2 original worktrees retained, plus this task's branch
  and worktree. Owner explicitly confirmed all 16 removed worktrees were unused
  and authorized removal after preserving local configuration.
- Inspected each worktree for status, locks, in-progress operations and ignored
  files. Preserved `.tools` and `supabase/.temp` where present under
  `/private/tmp/kami-206-preserved-worktrees/<branch-suffix>/`. Only reproducible
  dependencies/build output/type caches were discarded with normal, non-force
  worktree removal. No unknown ignored files were encountered.
- Refreshed all closed/open PR pages, each candidate's individual merged PR,
  exact final head, merge inclusion, occupancy and exact remote ref. Local
  compare-and-delete used the expected merged head to reject concurrent branch
  advancement; these squash heads do not rely on ancestry-only branch listings.
  Removed only deleted candidates' branch configuration sections.
- Initial prune removed 22 stale tracking refs. Actual remote inventory was main
  and four open Dependabot branches. Every removed candidate's source branch
  was absent in successful exact-ref server queries; no remote deletion needed.
  `delete_branch_on_merge=true` confirmed and preserved. Remote branches report
  `protected=false`; rulesets endpoint returned plan-unavailable HTTP 403, so no
  ruleset authority is asserted and no remote ref was mutated.
- Final fetch/prune and a second inspection left the remaining inventory unchanged.
  No blanket deletion, force-unlock, forced worktree removal or history rewrite.

## Before / after candidate inventory

Matched PRs are merged into main in this same repository; their merge commits
are included in observed origin/main. Full before tips match the final merged
PR heads. Removed candidates also have independently verified remote absence.
The two unmatched branches are retained without inferring completion.

| Branch                                 | Before tip / matched final merged head     | PR                                                          | After / reason                                                             |
| -------------------------------------- | ------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| `codex/147-probe-aliases`              | `f9e3503d5fc3598a26238213fdb86566d374a490` | [#149](https://github.com/haggaikaunda/kami-split/pull/149) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/151-rest-promotion`             | `72a21717e51ae05e8b27c8f7430bca2592a9683b` | [#154](https://github.com/haggaikaunda/kami-split/pull/154) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/151-vercel-staged-verification` | `935be8e923079964c7fdeb4910b4833a1e4b30fa` | [#152](https://github.com/haggaikaunda/kami-split/pull/152) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/167-quietly-warm-patterns`      | `65c4db27808aa0e72f3cf816081976562bf60603` | [#173](https://github.com/haggaikaunda/kami-split/pull/173) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/168-quietly-warm-onboarding`    | `864a7af16dbd78e108bc45a36476c6c1eb0661f2` | [#179](https://github.com/haggaikaunda/kami-split/pull/179) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/184-remove-seeded-preview`      | `778d2477a38f65765bb5895b0bcfe4d4ee5e433a` | [#188](https://github.com/haggaikaunda/kami-split/pull/188) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/api-ci-parallel`                | `86a1e673a450d60cd38b076bbafeb099dda64ae2` | [#150](https://github.com/haggaikaunda/kami-split/pull/150) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/household-canonical-navigation` | `2827f03b1122fdcc265c2949c80b848c55ef4399` | [#203](https://github.com/haggaikaunda/kami-split/pull/203) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/issue-105-group-discovery`      | `c1b34e15f8717bc717981746d26a22a81619da4e` | [#180](https://github.com/haggaikaunda/kami-split/pull/180) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/issue-106-group-creation`       | `12763f52b89d718003074af6ce82212efb0160bd` | [#185](https://github.com/haggaikaunda/kami-split/pull/185) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/issue-111-household-summary`    | `02f3ba15ef5e4032052be468dd6931679049b02b` | [#178](https://github.com/haggaikaunda/kami-split/pull/178) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/issue-112-household-workspace`  | `d97c9012e826a54570c5ad751376f19228d2fbe6` | [#187](https://github.com/haggaikaunda/kami-split/pull/187) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/issue-114-final-verification`   | `92813b38011dce82f38f047e1edac18504b2b593` | —                                                           | Retained: no unique exact merged PR head; preserve unmerged/ambiguous work |
| `codex/issue-164-onboarding`           | `ca59555314ae1715c79ca08e928d75db9aed1fe5` | [#165](https://github.com/haggaikaunda/kami-split/pull/165) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/issue-169-cross-space-expenses` | `257a630ade77162574620474b63350894de45484` | [#182](https://github.com/haggaikaunda/kami-split/pull/182) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/issue-170-expenses`             | `867837a3ac01b8fe5452f57df6e6ae1699f25b3b` | [#186](https://github.com/haggaikaunda/kami-split/pull/186) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/issue-171-workspaces`           | `9253c50762d16d3a068a43aa6d5d5c74e61c1505` | [#183](https://github.com/haggaikaunda/kami-split/pull/183) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/issue-172-activity`             | `e9a80947254e6b21455e280fd0aa0927115b65ef` | [#181](https://github.com/haggaikaunda/kami-split/pull/181) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/issue-189-approved-references`  | `85e6e47dca5bdb0ba19aa93c85e29533f122bb0f` | [#190](https://github.com/haggaikaunda/kami-split/pull/190) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/issue-189-screen-adoption`      | `4903cc62b218d27ddc3b51d5b6a0af6ee8abab74` | [#192](https://github.com/haggaikaunda/kami-split/pull/192) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/issue-189-visual-foundation`    | `e5590a7752fc0a6d46b382bea967d1ce28378237` | [#191](https://github.com/haggaikaunda/kami-split/pull/191) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/issue-193-navigation`           | `2eebf4613e11bc6cc3d330a3251ce9eb7e3862e1` | [#194](https://github.com/haggaikaunda/kami-split/pull/194) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/issue-197-household-membership` | `949a678d00bc3e6771b7de1cf6d566d57862590b` | [#198](https://github.com/haggaikaunda/kami-split/pull/198) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/issue-197-retire-designation`   | `d56f8f1c2df1a25a21d969a99257ab2cada959b8` | [#200](https://github.com/haggaikaunda/kami-split/pull/200) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/issue-202-personal-account`     | `9a8b840b7e789d47a0b965add5fcf7949b92ce5e` | [#204](https://github.com/haggaikaunda/kami-split/pull/204) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/issue-206-delivery-closeout`    | `fc7b1cef0064fc330b9dd72647d57ada856ee337` | —                                                           | Retained: current implementation, own closeout pending                     |
| `codex/kami-grow-branding`             | `b1f39b983136b71763a7286dd3efdca29fbb50f7` | [#196](https://github.com/haggaikaunda/kami-split/pull/196) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/percentage-splits-199`          | `ba434a7fa0b640dd19ce2e5e68452284dd975d3d` | [#205](https://github.com/haggaikaunda/kami-split/pull/205) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/remove-legacy-health-endpoints` | `1ceceee66792165aca426659211fb232695fbcf3` | [#160](https://github.com/haggaikaunda/kami-split/pull/160) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/vercel-alias-confirmation`      | `b11c357545cc73e8277e82ae03f0c32850701718` | [#155](https://github.com/haggaikaunda/kami-split/pull/155) | Removed: exact merged head; worktree removed or released; remote absent    |
| `codex/vercel-automation-bypass`       | `3ac73f7467e8feb0e510c2e7e97a3a9fe277f4e2` | [#153](https://github.com/haggaikaunda/kami-split/pull/153) | Removed: exact merged head; worktree removed or released; remote absent    |
| `hkaunda/smoke-production-db`          | `97e98accd11eab205a5adfb0a143c72f5bd20eb6` | —                                                           | Retained: no unique exact merged PR head; preserve unmerged/ambiguous work |
| `main`                                 | `69fcbe6b583f1264ee25920a5833345cf091712b` | —                                                           | Retained: main now equals observed origin/main                             |

## Confirmed merge commits for deleted branches

| PR   | Merge commit in observed origin/main       |
| ---- | ------------------------------------------ |
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
| #149 | `81dc87d12f8f10366a4653a36ddac041586e2bf9` |
| #154 | `cccdc2a84178c813592bd39f15d948c3f0ac703d` |
| #152 | `333cd870a0793b4a40acebcb967902fcf5fe6b98` |
| #179 | `dcfc522e62e1e50bdb9ef032a8557df3f6f1eab0` |
| #150 | `c77fa5da5fb931dbd5506362cef0481a3101f2d1` |
| #180 | `8d94282e8ff117633d4f6cad918714dcfc836a70` |
| #185 | `768ec4adfa2cb81dd9288e83facb76b49aa6e275` |
| #165 | `70a47dc8a424e448c88f0169cce061749ac07194` |
| #186 | `c29ec85a874bd5a6d529f2d02d3e30b0723db419` |
| #183 | `5e7d9e4dde5fefba254b5609a947b1f16c37858d` |
| #181 | `4e5ee2b36abf90a6b9efe7672dd0dd8a78700944` |
| #204 | `70c8fb8bdc95f6b17471519deddbce510982386e` |
| #205 | `fc7b1cef0064fc330b9dd72647d57ada856ee337` |
| #160 | `5ef57d248a28d0a011ad81c202139d8eea0b8fcd` |
| #155 | `f1dbaf278b4e6bde3df82a35e670f884ce27fb97` |
| #153 | `75b8f2c9f474592f3ac45d0600b583040e8652de` |
| #178 | `3e651742845ee5ae8dab3969d6d87784565af0bb` |

## Removed worktrees

Each path was clean, unlocked, inactive by owner confirmation, and removed without
force after local configuration preservation.

| Branch                                 | Removed path                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `codex/147-probe-aliases`              | `/Users/haggaikaunda/.codex/worktrees/probe-aliases/kami-split`              |
| `codex/151-rest-promotion`             | `/Users/haggaikaunda/.codex/worktrees/151-rest-promotion/kami-split`         |
| `codex/151-vercel-staged-verification` | `/Users/haggaikaunda/.codex/worktrees/vercel-staged-verification/kami-split` |
| `codex/168-quietly-warm-onboarding`    | `/private/tmp/kami-split-168`                                                |
| `codex/api-ci-parallel`                | `/Users/haggaikaunda/.codex/worktrees/api-ci-parallel/kami-split`            |
| `codex/issue-105-group-discovery`      | `/private/tmp/kami-issue-105`                                                |
| `codex/issue-106-group-creation`       | `/private/tmp/kami-issue-106`                                                |
| `codex/issue-164-onboarding`           | `/Users/haggaikaunda/.codex/worktrees/invitation-onboarding/kami-split`      |
| `codex/issue-170-expenses`             | `/private/tmp/kami-170`                                                      |
| `codex/issue-171-workspaces`           | `/private/tmp/kami-issue-171`                                                |
| `codex/issue-172-activity`             | `/private/tmp/kami-issue-172`                                                |
| `codex/issue-202-personal-account`     | `/private/tmp/kami-split-202`                                                |
| `codex/percentage-splits-199`          | `/private/tmp/kami-percentage-199`                                           |
| `codex/remove-legacy-health-endpoints` | `/Users/haggaikaunda/.codex/worktrees/api-deployment-rehearsal/kami-split`   |
| `codex/vercel-alias-confirmation`      | `/Users/haggaikaunda/.codex/worktrees/vercel-alias-confirmation/kami-split`  |
| `codex/vercel-automation-bypass`       | `/Users/haggaikaunda/.codex/worktrees/vercel-bypass/kami-split`              |

## Retained state and execution handoff

- Primary checkout is clean main at the observed SHA above.
- `codex/issue-114-final-verification` remains in
  `/Users/haggaikaunda/.codex/worktrees/api-conformance/kami-split`: no unique
  exact merged-head proof. It includes work that cannot safely be assumed merged.
- `hkaunda/smoke-production-db` remains: no unique exact merged-head proof.
- Current implementation branch/worktree remains for PR #207 verification and
  merge. The coordinator in this chat owns its post-merge closeout.

Preserved files/configuration remain available at the two recovery locations
above; retain or relocate them as needed. No sensitive contents are published.

This implementation PR must pass independent testing/review and required CI
before merge. Its final head/merge SHA, own branch/worktree removal, updated
primary/main synchronization and exact remote absence must then be recorded on
the PR and issue. Use a non-closing reference to #206 until these operations are
complete. This historical record describes observed state, not future commits.
