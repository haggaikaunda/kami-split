# ADR-005: Identity and first expense contract

- Status: **Accepted design; not implemented.** Final-head verification and merge remain delivery gates.
- Recorded: 2026-09-29; P2 finalized by the later owner follow-up.
- Scope: #75 identity foundation and #76 first expense contract; implementations remain separate.
- Relationship: Elaborates ADR-001–004 without changing accepted financial/authorization policy.

The [coordinated design](../proposals/first-expense/README.md) defines stable
identities, minimal disclosure, transaction locking, constrained database
boundaries and the first GraphQL contract. Its SQL/SDL are design artifacts, not
production migrations or runtime fields. #82 promotes only implemented fields.

## Owner decisions and retention

P1 minimal profiles, P3 tab-scoped sessionStorage cleared on logout/account switch,
and P4 first-route scope were approved earlier. The earlier P2 deferral is
superseded by [the explicit owner follow-up](https://github.com/haggaikaunda/kami-split/pull/95#issuecomment-5901138197):
retain durable financial operation results and information needed to recognize
and recover the original attempt for the lifetime of associated financial history.
No 90-day expiry, cleanup job, record-to-tombstone transition or EXPIRED operation
outcome belongs in the initial contract. Atomic expense/allocations/audit/result,
current authorization, same-key comparison and separate fresh balances remain.

These operation recovery records/idempotency results are distinct from uploaded
receipt images/PDFs. Uploads, file/object storage, attachment metadata, OCR, upload
UI and attachment-retention policy are deferred outside #73/#76/#82. Future
account/group deletion, archival and pruning require separately reviewed lifecycle
policy. No extra browser timed expiry or cross-device recovery promise is added.

## Acceptance and next work

The [gate matrix](../proposals/first-expense/gates.md) traces decisions and
[validation](../proposals/first-expense/validation.md) separates design evidence
from required runtime tests. O04/O08/O09/O13/O14 and minimal O18 have the concrete
first-journey design. Unrelated O03/O10/O11/O12 lifecycle/admission work remains.

Finalize PR #95 through required CI, independent testing/review and applicable
formal approval/protection gates. Close #76 only when design criteria pass and
this record is merged; keep #75 open for its separate implementation PR. No #82
financial implementation begins from this task.

The local Auth-reference creation/ownership-transfer procedure is evidence,
not a universal hosted guarantee: #75 must verify final ownership/ACLs and complete
migration behavior, and deployment must verify actual hosted credentials.
