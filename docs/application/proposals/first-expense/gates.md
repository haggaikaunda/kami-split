# Gate matrix and consolidated owner decision sheet

> References to keeping or isolating the seeded runtime record the original milestone scope. #184 subsequently retired that runtime and simulation-only tests; these references do not require executable preview retention.

The coordinated design is finalized subject to final-head verification and normal
merge gates. P1/P3/P4 were approved earlier; the [owner follow-up](https://github.com/haggaikaunda/kami-split/pull/95#issuecomment-5901138197)
resolves P2 with retention for the lifetime of financial history. Design acceptance
does not claim implemented behavior. [Validation](validation.md) records evidence.

| Gate                        | Accepted policy/source          | Technical recommendation                                                         | Validation/review                                                                         | Owner decision                                    | Dependent work                                         |
| --------------------------- | ------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| #75.1 identity/columns      | ADR-001 D4, ADR-004 C2          | S1 UUIDs; D1 permanent UNIQUE(group,user), separate Auth tombstone/live link     | D5 scenarios; SQL semantics checked in primary docs; runtime tests pending                | none; P1 approved                                 | #75 migrations/real-role tests                         |
| #75.2 exactly one owner     | ADR-003 B4, #75                 | D1 deferred active/same-group pointer FK; S3 lock order; role derived            | D5 competing-write tests required                                                         | none; transfer feature remains deferred           | #75 constraint tests; #82 financial lock; #84 transfer |
| #75.3 Auth deletion/retry   | ADR-002 O03                     | D2 disable before SET NULL, immutable reserved subject, no email relink          | Local provider FK/ownership-transfer probe passed; hosted credential verification pending | lifecycle retention/anonymization remains O03/O12 | #75 foundation; separately scoped deletion             |
| #75.4 bootstrap/profile     | ADR-003 B1/B2, ADR-004 C2       | D1 singleton independent household/creation-grant pointers; S2 projection        | exact fields traced A7                                                                    | P1 approved                                       | #75, #81 operator bootstrap                            |
| #75.5 claims/RLS/admission  | ADR-002 O04; newer #79 comments | S3 verified subject; D3 fixed definer helpers; D4 invitation proof boundary      | no runtime bypass claims; real-role/admission tests pending                               | former-member generic links remain #79/#80        | #75/#78, then #79/#80                                  |
| #76.1 money                 | ADR-001 D3, ADR-004 C4          | A1 canonical int64 strings, checked complete aggregates, TS bigint               | scalar scenarios and SDL shape validation; runtime coercion pending                       | none on engineering choice                        | #82/#83 exact-money fixtures                           |
| #76.2 IDs/order             | ADR-001 D3/D4                   | S1 typed ASCII IDs, authorized nodes, canonical membership order                 | A6 odd cents and group isolation scenarios                                                | none                                              | #75/#82/#83                                            |
| #76.3 pagination            | #76, server-informed UI         | A2 signed bounded keyset, revision anchor, complete independent balance snapshot | SDL/operations plus concurrency scenarios; no snapshot across pages                       | none                                              | #82 storage creation revision, signing keys            |
| #76.4 errors                | #78 outcomes, ADR-004 C3        | A3 union failures, 401/503 credentials boundary, generic NOT_FOUND               | operation selection validation; runtime denial tests pending                              | none                                              | #78/#82 adapter                                        |
| #76.5 recovery              | ADR-004 C3                      | A4 scoped key/canonical bytes/atomic receipt; A5 explicit uncertainty            | lost commit/concurrent/restart/long-lived recovery scenarios; no implementation proof     | P2/P3 approved                                    | #82 receipt persistence; #83 client recovery           |
| #76.6 membership/read model | ADR-004 C1/C2                   | S2 minimal projection; S4 complete deterministic plan; A7 UI trace               | UI inspected; runtime/UI integration pending                                              | P1/P4 approved                                    | #82/#83                                                |

## Owner decision sheet and recorded outcome

The earlier deferral of “receipts” is preserved in PR history. The owner's later
explicit decision resolves financial operation recovery record retention and
separately defers uploaded images/PDFs. None of file storage, OCR, attachment
metadata/UI or attachment retention is in #73/#76/#82.

| ID                                            | Recommended answer                                                                                                                    | Observable consequences / alternative                                                                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 — profile disclosure (approved)            | Approve S2 exact fields, current display names for retained historical members, no email/avatar/peer Viewer ID                        | People can identify historical payers/participants without a global directory. `canParticipate=false` reveals ineligibility without account-status reason. Anonymization/retention remains separately gated; adding profile fields needs privacy review. |
| P2 — financial operation records (approved)   | Retain complete recovery/idempotency information for the lifetime of associated financial history; no time-based expiry or tombstones | Same-key recovery/mismatch protection remains available under current authorization. Future deletion/archival/pruning requires separate lifecycle design. Uploaded receipts are deferred.                                                                |
| P3 — client draft/attempt lifetime (approved) | Tab-scoped sessionStorage through reload, cleared on logout/account change; no new timed expiry                                       | No cross-device or post-tab-close recovery promise. Server records remain with history independently of browser storage.                                                                                                                                 |
| P4 — first real UI scope (approved)           | Approve group selection, expense list/create and complete balances/recovery; isolate remaining preview routes                         | No simulated activity, trips, edits or settlement controls appear as persisted features; full overview/reporting parity is deferred. Wider UI parity requires additional read contracts and review.                                                      |

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

**#76:** P1–P4 and engineering design gates now have concrete decisions, SDL,
operations and validation scenarios. Close after final-head independent testing,
review, required Verify and merge of PR #95 establish all design acceptance
criteria. Business SDL stays under docs until #82 implements approved fields.
Runtime behavior tests belong to #82/#83, not an invented remaining design gate.
No #82 financial implementation starts in this task.

## PR adoption and readiness strategy

Finalize and merge this one coordinated design record through normal gates:
final-head CI/Verify, recorded independent testing/review, resolved blocking
conversations, non-draft status and applicable formal GitHub approvals/protections.
Do not substitute agent comments for required formal approval or bypass protection.

Keep #75 open for its separate implementation PR and tests. Close #76 only after
its design criteria are verified and this record is merged. No 90-day lifecycle
is adopted; lifetime-of-history retention is the initial policy. Future lifecycle
pruning, admission-specific decisions and uploaded receipt attachments remain
separate work. Implementation of #82 is not authorized by completing this record.
