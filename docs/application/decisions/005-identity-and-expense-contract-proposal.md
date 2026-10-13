# ADR-005: Identity and first expense contract

> Seeded-runtime references below are historical evidence. #184 removed the executable preview and simulation-only tests; they must not be retained or restored. Accepted production policy remains authoritative.

- Status: **Accepted design.** Identity and financial consumers are implemented; see current guides below.
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

## Current consumers

The [validation procedure](../proposals/first-expense/validation.md) checks the retained example schema. The implemented [identity foundation](../identity-foundation.md) and [expense service](../persisted-expenses.md) own runtime behavior. Hosted deployment must still verify final role ownership/ACLs and actual credentials. Delivery history is on #76 / PR #95.
