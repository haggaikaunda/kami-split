# Gate matrix and consolidated owner decision sheet

Engineering choices remain proposed pending contract acceptance. On 2026-09-29,
the owner approved P1, P3 and P4 in the PR #95 design review conversation and
deferred P2 (receipt retention). Accepted policy is cited separately; technical
recommendations do not ask the owner to choose SQL types. [Validation](validation.md) records actual evidence.

| Gate                        | Accepted policy/source          | Technical recommendation                                                         | Validation/review                                                                         | Owner decision                                    | Dependent work                                         |
| --------------------------- | ------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| #75.1 identity/columns      | ADR-001 D4, ADR-004 C2          | S1 UUIDs; D1 permanent UNIQUE(group,user), separate Auth tombstone/live link     | D5 scenarios; SQL semantics checked in primary docs; runtime tests pending                | none beyond P1 disclosure                         | #75 migrations/real-role tests                         |
| #75.2 exactly one owner     | ADR-003 B4, #75                 | D1 deferred active/same-group pointer FK; S3 lock order; role derived            | D5 competing-write tests required                                                         | none; transfer feature remains deferred           | #75 constraint tests; #82 financial lock; #84 transfer |
| #75.3 Auth deletion/retry   | ADR-002 O03                     | D2 disable before SET NULL, immutable reserved subject, no email relink          | Local provider FK/ownership-transfer probe passed; hosted credential verification pending | lifecycle retention/anonymization remains O03/O12 | #75 foundation; separately scoped deletion             |
| #75.4 bootstrap/profile     | ADR-003 B1/B2, ADR-004 C2       | D1 singleton independent household/creation-grant pointers; S2 projection        | exact fields traced A7                                                                    | P1                                                | #75, #81 operator bootstrap                            |
| #75.5 claims/RLS/admission  | ADR-002 O04; newer #79 comments | S3 verified subject; D3 fixed definer helpers; D4 invitation proof boundary      | no runtime bypass claims; real-role/admission tests pending                               | former-member generic links remain #79/#80        | #75/#78, then #79/#80                                  |
| #76.1 money                 | ADR-001 D3, ADR-004 C4          | A1 canonical int64 strings, checked complete aggregates, TS bigint               | scalar scenarios and SDL shape validation; runtime coercion pending                       | none on engineering choice                        | #82/#83 exact-money fixtures                           |
| #76.2 IDs/order             | ADR-001 D3/D4                   | S1 typed ASCII IDs, authorized nodes, canonical membership order                 | A6 odd cents and group isolation scenarios                                                | none                                              | #75/#82/#83                                            |
| #76.3 pagination            | #76, server-informed UI         | A2 signed bounded keyset, revision anchor, complete independent balance snapshot | SDL/operations plus concurrency scenarios; no snapshot across pages                       | none                                              | #82 storage creation revision, signing keys            |
| #76.4 errors                | #78 outcomes, ADR-004 C3        | A3 union failures, 401/503 credentials boundary, generic NOT_FOUND               | operation selection validation; runtime denial tests pending                              | none                                              | #78/#82 adapter                                        |
| #76.5 recovery              | ADR-004 C3                      | A4 scoped key/canonical bytes/atomic receipt; A5 explicit uncertainty            | lost commit/concurrent/restart/expiry scenarios; no implementation proof                  | P2/P3                                             | #82 receipt persistence; #83 client recovery           |
| #76.6 membership/read model | ADR-004 C1/C2                   | S2 minimal projection; S4 complete deterministic plan; A7 UI trace               | UI inspected; runtime/UI integration pending                                              | P1/P4                                             | #82/#83                                                |

## Owner decision sheet and recorded outcome

Owner response: “defer receipts for later, otherwise all other proposals are
approved.” This approves P1/P3/P4 below and defers the P2 receipt-retention choice.
It does not revoke ADR-004 same-attempt recovery or permit an expense write without
its atomic recoverable result. P2 remains a gate before affected #82 implementation.

| ID                                            | Recommended answer                                                                                            | Observable consequences / alternative                                                                                                                                                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 — profile disclosure (approved)            | Approve S2 exact fields, current display names for retained historical members, no email/avatar/peer User ID  | People can identify historical payers/participants without a global directory. `canParticipate=false` reveals ineligibility without account-status reason. Anonymization/retention remains separately gated; adding profile fields needs privacy review.                                          |
| P2 — financial receipt retention (deferred)   | Approve 90-day full canonical input/receipt, then minimal permanent-with-history key tombstone                | Recovery remains automatic for 90 days; later attempts require reconciliation and cannot create twice. Tombstones consume storage and retain pseudonymous financial linkage. Shorter retention reduces payload storage but shortens recovery; full deletion needs a new issuance/cutoff protocol. |
| P3 — client draft/attempt lifetime (approved) | Approve tab-scoped sessionStorage through reload, cleared on logout/account change and bounded to 90 days     | Reload can recover in the same tab; tab close/logout/device loss loses automatic attempt recovery. Financial draft data resides in browser session storage. Memory-only avoids persistent browser draft storage but loses reload recovery; a server inbox would be additional scope.              |
| P4 — first real UI scope (approved)           | Approve group selection, expense list/create and complete balances/recovery; isolate remaining preview routes | No simulated activity, trips, edits or settlement controls appear as persisted features; full overview/reporting parity is deferred. Wider UI parity requires additional read contracts and review.                                                                                               |

Invitation current-email freshness, former-member shared-link policy, link limits,
owner-change behavior and milestone placement remain #79/#80, not extra decisions
this package purports to resolve. Token lifetime/logout scope stays #80/O02.
Departure, historical corrections, deletion/anonymization, group closure/disputes
stay O03/O11/O12. No pending policy permits disabled-account reactivation.

## Per-issue readiness and smallest next slices

**#75:** design proposal covers all five engineering gates; not implemented and
must stay open. With P1 approved and independent technical review recorded, the next slice is identity,
group, membership and installation constraints with Auth deletion and real-role
RLS/context/locking tests using #74. Admission grants stay absent until #79's
proof boundary is reviewed; helper seam must not become a broad mutation API.
Second slice is #78 verified JWT/context integration; #81 bootstrap is separately
owned. Do not start schema implementation automatically from this handoff.

**#76:** SDL and representative operations can be validated now, but publication
and completion require reviewed technical choices plus the deferred P2 retention decision and final contract acceptance. Keep open while
those decisions are pending. After approval, #82's smallest first slice is
viewer/group/member reads with real-role authorization and coherent complete-read
infrastructure. Next is one complete expense-create/list/balance/recovery slice
with allocations, audit, receipt, overflow and concurrent retry tests together;
never land a financial write without its safeguards. #83 follows implemented
fields and #79/#80 onboarding, not a mock claim of the invited-user journey.

A documentation PR may remain draft for owner decisions. Independent reviews and
Verify must be recorded against the final commit before any eligible merge;
merging proposed documentation would not alone close #75 or #76.
