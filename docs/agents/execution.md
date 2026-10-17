# Local execution preflight and verification

Use the repository's pinned Node 24 on `PATH`. The coordinator first performs
[task-start synchronization](delivery-workflow.md#task-start-synchronization-and-post-merge-closeout)
and records the full baseline SHA on the issue. This helper reads local history;
it does not fetch, synchronize, create worktrees or establish approval.

From the root of an owned feature checkout:

```sh
node scripts/agents/execution.mjs preflight <recorded-base-sha>
# After coordinating exclusive checkout/output access and stopping owned previews:
node scripts/agents/execution.mjs preflight <recorded-base-sha> --owned-idle
# Commit intended changes first, including generated source, then:
node scripts/agents/execution.mjs verify <recorded-base-sha> --owned-idle
```

`--owned-idle` asserts that the caller has coordinated ownership of this checkout,
its `.next` and `test-results/browser` outputs, with no concurrent checks or
preview using them. It is not a process lock, proof of ownership or permission to
stop another session. Without it, preflight reports unknown ownership and exits
nonzero. Dirty/untracked work, Git operations/locks, main, a wrong origin or an
unavailable/non-ancestor baseline block verification. Preserve valuable changes;
do not resolve blockers with implicit stash, reset, clean or lock removal.

Preflight performs bounded read-only probes, reports the observed head and pins,
and checks workspace dependencies, Python validator availability, managed browser
presence and selected browser ports when applicable. It reads tracked harness
configuration presence, not secrets or `.env` contents. Failed probes do not echo
raw stderr, remote credentials or unrelated Docker inventory. A tool may be
missing, mismatched **or inaccessible**; resolve PATH/sandbox/cache permissions
before assuming it needs replacement. Preflight neither installs tools nor
starts/stops services. Supabase version probing can write global telemetry, so
preflight checks binary presence only; the existing `db-tool.sh` enforces its
version when the authorized database check runs.

Use `pnpm install --frozen-lockfile`, the
[pinned Python environment](skill-authoring.md#objective-checks-from-a-fresh-checkout),
[managed Chromium setup](../browser-verification.md), and
[database prerequisites](../application/database-development.md#prerequisites-and-pins)
to resolve the specific reported blockers. No application/production credentials
are needed by these synthetic browser and disposable database harnesses. Package
presence/exact manifest pins are checked; frozen installation remains authoritative
for lockfile integrity and ranged dependency versions. Browser binary presence
does not prove OS libraries or successful launch. Go module/cache readiness is
ultimately checked by `make api-check`; sandbox generation errors can require an
explicit owning permission action. Never install credentials to fix a test setup.

The plan always retains the root policy sequence: Relay drift, formatting, lint,
type checking, unit tests and build. It also runs repository classifier/helper
tests and pinned skill/resource validation. It imports the existing
[central classifier](change-aware-ci.md) for the supplied ancestor → current-head
range, adding the supported browser checks when web is affected and API source,
sqlc and disposable database checks when API is affected. Empty/unknown ranges
stay conservative. There is no local alternate path classifier or skip override.

All commands execute serially and stop at the first failure with nonzero status.
The plan is printed before execution. Browser smoke reuses the build produced in
that same run; type checking and build never race. The existing Playwright
harness starts and tears down its own services and refuses server reuse. Choose
unused `BROWSER_PORT`/`BROWSER_AUTH_PORT` in separate worktrees when coordinating
concurrent browser work. This helper requires its checkout-local output directory
(`BROWSER_OUTPUT_DIR` unset). Port probes are snapshots, not reservations; the
harness remains responsible for binding safely.

`make db-test` allocates a unique disposable project and ports, with its own
cleanup trap. Existing database stacks are counted but never reused or reclaimed.
Coordinate host capacity and ownership before starting additional database work;
a worktree isolates files, not Docker resources. The helper does not run shared
`make dev-up`, `db-start`, `dev-down` or Compose teardown. Required container and
coordinated startup checks remain in the existing isolated API CI job. Local
success does not substitute for those checks, independent requirements testing,
whole-final-diff review, final-head `Verify`, merge or canonical closeout.

Record commands, tested revision, outcomes and limitations on the issue/PR. Keep
outputs in ignored `test-results/` or external temporary storage. For narrowly
scoped investigation, the original commands remain supported; explain omitted
applicable checks as incomplete work, never as a passing full verification.
