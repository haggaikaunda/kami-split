# Repeatable branch cleanup procedure

The [delivery workflow](delivery-workflow.md#task-start-synchronization-and-post-merge-closeout)
defines responsibility and completion. This is a manual, squash-aware procedure,
not a bulk deletion script. Run it in the actual affected repository with its
owner's coordinated exclusive access. A clean fresh clone does not prove cleanup
of an existing checkout. Stop a dependent operation when any command fails.

## Inspection / dry run

1. Record the primary path, current branch and local/remote main SHAs. Inspect:

   ```sh
   git remote get-url origin
   git status --short --untracked-files=all
   git branch --show-current
   git for-each-ref --format='%(refname) %(objectname) %(upstream)' refs/heads refs/remotes/origin
   git worktree list --porcelain
   git status
   ```

   Confirm `origin` is `haggaikaunda/kami-split` before contacting or modifying
   refs. Check each affected worktree for dirty/untracked files, valuable ignored
   configuration, locks and in-progress operations. Record only disposition, not
   sensitive configuration contents. Establish ownership and disposable status
   with its agent; a clean tree is not evidence that it is inactive. Do not force
   unlock or remove unknown worktrees.

2. Record fresh repository settings and **all pages** of PRs, plus actual refs:

   ```sh
   gh api repos/haggaikaunda/kami-split --jq '{default_branch,delete_branch_on_merge}'
   gh api --paginate --slurp 'repos/haggaikaunda/kami-split/pulls?state=closed&per_page=100'
   gh api --paginate --slurp 'repos/haggaikaunda/kami-split/pulls?state=open&per_page=100'
   git ls-remote --heads origin
   git fetch --prune origin
   git rev-parse main origin/main
   ```

   Keep raw API results private; publish only necessary branch/PR/SHA evidence.
   A successful empty exact-ref query establishes absence; an API, authentication
   or network failure establishes nothing. A missing local upstream establishes
   nothing about the remote server.

3. Associate every candidate with a unique merged PR: `merged_at` is non-null,
   `base.ref` is `main`, source repository matches, and `head.sha` equals the
   current full branch tip. Refresh that individual PR before deletion:

   ```sh
   gh api repos/haggaikaunda/kami-split/pulls/PR_NUMBER
   git merge-base --is-ancestor MERGE_COMMIT_SHA origin/main
   ```

   These placeholders must be replaced with recorded values. Exit status zero
   from the ancestry command proves merge inclusion, not head inclusion. Squash
   heads generally fail `git branch --merged`; exact GitHub head evidence is
   required instead. Multiple matching PRs, mismatched tips, missing objects or
   missing source-repository identity require investigation, never inference.

4. Produce an explicit table: branch, tip, merged PR/final head/merge SHA, upstream,
   linked worktree and ownership, actual remote tip/absence, and
   **eligible / retained / blocked** with reason. Preserve `main`, protected or
   long-lived branches, open PR heads **and bases**, extra/unpushed commits,
   advanced/reused names and ambiguous work. Recheck all open PR pages and ask
   owners about ongoing/dependent work not represented by a PR. Review applicable
   branch protections and rulesets before declaring a candidate eligible; absence
   of an open PR is not sufficient ownership evidence.

## Guarded mutation

Coordinate exclusive access through each affected operation. Do not switch a
shared checkout used by another agent or move `main` behind an active worktree.
Reinspect status/locks/operations immediately before mutation. If the primary is
dirty or ownership unknown, record the blocker and preserve it. Safe independent
candidates can be cleaned separately; this is partial closeout.

On a clean, available primary checkout:

```sh
git switch main
git pull --ff-only origin main
git rev-parse main origin/main
git merge-base --is-ancestor MERGE_COMMIT_SHA origin/main
git status --short --untracked-files=all
```

Explicitly compare the two full SHAs for **equality**. Pull can succeed when local
main is ahead; that is blocked synchronization. If ahead/diverged, preserve it and
ask its owner to resolve the work. Never reset, stash, clean, rebase or merge to
make cleanup pass.

For each eligible local candidate, refresh PR/open-work evidence and reinspect
its tip and worktree ownership. Remove only an owned clean disposable worktree
with `git worktree remove PATH` (without force), after preserving valuable ignored
files. First change the executing agent's working directory to the primary
checkout. Ordinary `git branch -d BRANCH` is preferred when ancestry permits,
under exclusive access. If Git refuses because of a proven squash merge, use an
exact expected-tip transaction rather than unguarded force deletion:

```sh
git update-ref -d refs/heads/BRANCH FINAL_MERGED_HEAD_SHA
```

This compare-and-delete fails if the branch advanced between inspection and
mutation. Unlike `git branch`, it does not guard worktree occupancy: immediately
recheck `git worktree list --porcelain` and require coordinated exclusive access
so nobody can attach a worktree during the transaction. Never use this on a
checked-out branch. Remove only the deleted branch's configuration section if
one exists, under the same exclusive access. Verify the ref is absent afterwards.
Do not generalize this command into a blanket deletion pipeline.

Check remote absence for each exact source branch:

```sh
git ls-remote --heads origin refs/heads/BRANCH
```

Require command success and zero matching rows to claim absence. If the ref
survives, confirm the same repository, exact final merged head, no ongoing/open/
dependent work, and that protections/rulesets permit deletion. If advanced/reused
or ownership/permissions are ambiguous, preserve and report it. For an eligible
surviving ref, guard deletion on the remote server:

```sh
git push --force-with-lease=refs/heads/BRANCH:FINAL_MERGED_HEAD_SHA origin :refs/heads/BRANCH
git ls-remote --heads origin refs/heads/BRANCH
```

The explicit lease permits only deletion of the recorded tip, preventing loss of
concurrent new commits; it is not permission to rewrite shared history. Do not
use an unconditional `--force` or weaken protections. Fork branches need their
owner's separate authority and remote; never delete unrelated branches. If
automatic deletion is disabled, record it and restore only with repository admin
authority. Keep that administrative operation separate from branch deletion.

## Verification and rerun

Fetch/prune again. Repeat the before inventory and record every removed/retained/
blocked candidate, exact remote outcomes, observed SHAs, primary cleanliness and
merge inclusion. If origin/main advanced, fast-forward the available clean primary
again and record the new observation; do not claim equality against old evidence.
If a branch/worktree is already absent, record absence after successful inspection
and skip mutation. Never treat a failed command as idempotent success. New or
advanced refs require a new dry run.

Exercise commands in disposable Git repositories with a bare remote before real
mutation: normal/squash merges, missing refs, extra commits/reused names, dirty and
ahead/diverged main, linked/locked worktrees, failed API/remote calls, surviving
remote refs, repeat runs and refs advancing after inspection. No destructive tests
run against the owner's checkout. Documentation verification tests command
semantics and safety decisions; no tests need merely assert prose exists.

Final evidence belongs on the PR/issue using the
[closeout fields](../../.github/pull_request_template.md). Keep an issue open when
real-checkout cleanup or its own implementation PR closeout is outstanding.
