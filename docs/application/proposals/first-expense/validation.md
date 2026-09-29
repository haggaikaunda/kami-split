# Design validation and implementation acceptance

Status: design checks completed as recorded below; no business implementation claimed. Run the proposed
SDL validator from `apps/api`:

```sh
go run ../../docs/application/proposals/first-expense/validate.go
```

It uses the repository-pinned gqlparser, validates schema plus five representative
operations/three fragments, and checks three invalid-operation rejection probes.
It does not invoke gqlgen, change authoritative SDL, prove custom scalar coercion,
or implement any financial operation. Required repository checks and independent
commit-specific outcomes are recorded below and on the draft PR.

## Required downstream behavioral vectors

These are acceptance scenarios, **not tests claimed to pass in a design-only PR**.

| Area                  | Inputs/interleaving                                                                             | Required observation                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Scalar grammar        | `"0"`, `"-1"`, `"9223372036854775807"`; numeric 1, `"01"`, `"-0"`, `"1e2"`, `" 1"`, above int64 | First three scalar-valid, field bounds applied; other forms reject           |
| Record/aggregate      | 0, 1, 999999999, 1000000000 total; aggregate 9007199254740993; candidate max+1                  | Record boundaries exact, aggregate string remains exact, overflow rolls back |
| Participant order     | 1000 cents, IDs 003/001/002; 1 cent over 3 people                                               | 334/333/333 by canonical ID; 1/0/0 and three participants                    |
| Exact split           | payer C, participants A/B, A=1000 B=0                                                           | Both participants retained; payer and creator independent                    |
| Complete balances     | chain A→B20 B→C20, inactive B; same-group cycle; opposite nets in another group                 | A→C20 with B zero; all-zero cycle settled; no cross-group netting            |
| Read consistency      | two pages with intervening later/backdated create                                               | anchored page excludes new expense; fresh complete balances include it       |
| Cursor                | same dates/timestamps, tampered/group/filter/version mismatch, retired signing key              | stable UUID tie-break; authorized INVALID_CURSOR and list restart            |
| Atomic recovery       | drop before/around/after commit, restart, concurrent same-key requests                          | one expense/allocation set/audit/receipt or none; same-key recovery          |
| Mismatch              | reorder participants; change note/amount/split                                                  | reordering canonicalizes; changed intent mismatches without second effect    |
| Permission loss       | disable/inactivate actor after commit; retry by another actor/group                             | no receipt disclosure or access via key possession                           |
| Receipt/current reads | another expense committed after recovered receipt                                               | immutable receipt revision; separately refreshed current balance revision    |
| Retention             | retry racing expiry cleanup; expired/totally missing result                                     | retained tombstone blocks reuse; missing never proves noncommit              |
| Client scope          | reload, logout, switch actor/group, late completion                                             | proposed P3 lifetime only; no old private-state repopulation/new key         |
| Identity/security     | D5 cases including real Auth deletion, helper attacks and two-session races                     | retained identities, exactly one owner, no cross-user leakage                |

## Scope limits

Primary PostgreSQL/Supabase docs support the proposed primitives, but real-role
provider grants, SQL locking, JWT/current-email integration, scalar coercion,
Relay arithmetic and browser recovery remain implementation verification. A
validated SDL or passing existing health/mock suite does not prove these designs
implemented. No hosted service or paid resource is used.

## Executed builder checks

On the proposal branch (initial content 29d8409; affected formatting/SDL checks
repeated after review corrections):

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`:
  pass; 54 web files / 325 tests. No UI behavior changed, so browser acceptance
  remains #83 implementation evidence rather than a documentation check.
- `make api-check`: pass, including vet, regular/race tests, build and gqlgen drift.
- `make db-tools`, `make db-generation-check`, `make db-test`: pass after installing
  the missing local pinned binaries. Fresh replay, schema/ACL reconciliation,
  runtime permissions and database integration execute in #74's unique test stack.
- `docker compose config --quiet`, Docker verify target: pass (Docker layers cached).
- `make dev-up`, live GraphQL exact health JSON assertion and `/readyz`: pass;
  task-owned Kami Split Compose/Supabase services stopped via `make dev-down`.
- Local Markdown link targets: 40 checked, none missing (before final evidence links).
- Proposed SDL: five operations/three fragments valid; three malformed operations
  rejected. Running health-only schema/generation remains unchanged.

Independent review identified and corrected (1) stale authorization when a
REPEATABLE READ snapshot preceded a group-lock wait, and (2) a union-valued field
incompatible with Relay connection handling. S3/D5 now specify fresh READ COMMITTED
authorization after locks; A8/SDL specify a concrete nullable connection, complete
PageInfo and safe field errors. Final commit-specific independent outcomes and
required Verify status are recorded on [PR #95](https://github.com/haggaikaunda/kami-split/pull/95).

## Independent SQL experiment

A separate tester extracted D1's table sketches into a disposable, port-unpublished
Supabase PostgreSQL 17.6.1.171 container using the image's actual managed Auth
schema. Valid deferred bootstrap, ownerless/cross-group/inactive-owner rejection,
permanent membership uniqueness, enabled-Auth-delete rejection, disable/delete
identity retention, re-enable-without-live-link rejection and reserved-subject
uniqueness passed. Relink prevention still needs the immutable-column triggers
and admission tests specified for implementation.
These probe the proposed constraints, not implemented migrations or services.

The provider-role probe found ordinary postgres cannot grant Auth reference
privileges to a new restricted owner. D1 now uses the tested narrow create-under-
postgres then ALTER OWNER procedure, immediately revoking temporary app-schema
grants. Insert and disable/delete FK behavior still worked after transfer while
migrator Auth USAGE/REFERENCES remained false. #75 must repeat this in the complete
migration/desired-state and permission suite. Hosted role availability remains a
deployment check; no hosted environment was accessed.

## Follow-up review acceptance scenarios

[Review 5359720753](https://github.com/haggaikaunda/kami-split/pull/95#pullrequestreview-5359720753)
requires consistent Viewer IDs, current decision/issue statuses and narrow revision
meaning. Additional downstream scenarios (not implemented runtime claims):

- `viewer.id` and self `node` resolve the same `ks1:Viewer:<UUID>` with typename
  Viewer, including an enabled user with no groups. Peer Viewer lookup is null;
  disabled/unprovisioned access yields no Viewer node; `ks1:User:` rejects.
- Rename a profile or change membership/account state without a financial write:
  revision stays equal while metadata/access changes. Reauthorize/refetch; never
  reuse access or treat equal revisions as identical GraphQL responses.
- Commit an expense: increment financial revision under group lock, retain that
  historical value in its receipt, and fetch current balances after recovery.
  Cursor anchors bound expense inclusion, not future metadata or access.

The follow-up preserves local Auth-FK evidence and hosted/final-ACL limitations.
Final-head check/review evidence and live issue synchronization are recorded on PR #95.
