# Design validation and implementation acceptance

Run the example
SDL validator from `apps/api`:

```sh
go run ../../docs/application/proposals/first-expense/validate.go
```

It uses the repository-pinned gqlparser, validates schema plus five representative
operations/three fragments, and checks three invalid-operation rejection probes.
It does not invoke gqlgen, change authoritative SDL, prove custom scalar coercion,
or implement any financial operation. Record execution results and limitations on the delivery PR.

## Behavioral regression vectors

These vectors explain the contract; consult the current API/database and web suites for executable coverage.

| Area                  | Inputs/interleaving                                                                             | Required observation                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scalar grammar        | `"0"`, `"-1"`, `"9223372036854775807"`; numeric 1, `"01"`, `"-0"`, `"1e2"`, `" 1"`, above int64 | First three scalar-valid, field bounds applied; other forms reject                                                                                        |
| Record/aggregate      | 0, 1, 999999999, 1000000000 total; aggregate 9007199254740993; candidate max+1                  | Record boundaries exact, aggregate string remains exact, overflow rolls back                                                                              |
| Participant order     | 1000 cents, IDs 003/001/002; 1 cent over 3 people                                               | 334/333/333 by canonical ID; 1/0/0 and three participants                                                                                                 |
| Exact split           | payer C, participants A/B, A=1000 B=0                                                           | Both participants retained; payer and creator independent                                                                                                 |
| Complete balances     | chain A→B20 B→C20, inactive B; same-group cycle; opposite nets in another group                 | A→C20 with B zero; all-zero cycle settled; no cross-group netting                                                                                         |
| Read consistency      | two pages with intervening later/backdated create                                               | anchored page excludes new expense; fresh complete balances include it                                                                                    |
| Cursor                | same dates/timestamps, tampered/group/filter/version mismatch, retired signing key              | stable UUID tie-break; authorized INVALID_CURSOR and list restart                                                                                         |
| Atomic recovery       | drop before/around/after commit, restart, concurrent same-key requests                          | one expense/allocation set/audit/receipt or none; same-key recovery                                                                                       |
| Mismatch              | reorder participants; change note/amount/split                                                  | reordering canonicalizes; changed intent mismatches without second effect                                                                                 |
| Permission loss       | disable/inactivate actor after commit; retry by another actor/group                             | no receipt disclosure or access via key possession                                                                                                        |
| Receipt/current reads | another expense committed after recovered receipt                                               | immutable receipt revision; separately refreshed current balance revision                                                                                 |
| Retention             | recover after 90 days and later, same/different-input retry after restart; missing lookup       | original record remains with financial history, same effect/mismatch, current authorization; no EXPIRED or tombstone path; missing never proves noncommit |
| Client scope          | reload, logout, switch actor/group, late completion                                             | tab-scoped P3 lifetime; no old private-state repopulation/new key                                                                                         |
| Identity/security     | D5 cases including real Auth deletion, helper attacks and two-session races                     | retained identities, exactly one owner, no cross-user leakage                                                                                             |

## Scope limits

Primary PostgreSQL/Supabase docs support the proposed primitives, but real-role
provider grants, SQL locking, JWT/current-email integration, scalar coercion,
Relay arithmetic and browser recovery remain implementation verification. A
validated SDL or passing existing health/mock suite does not prove these designs
implemented. No hosted service or paid resource is used.
