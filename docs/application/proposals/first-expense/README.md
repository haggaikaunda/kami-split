# Identity and first expense design

This accepted design package preserves useful contract examples and rationale from ADR-005. Current implementation is documented in [identity foundation](../../identity-foundation.md), [persisted expenses](../../persisted-expenses.md), and [Relay journey](../../relay-expenses.md). The SDL/operations here are executable design examples validated by `validate.go`; `packages/schema` remains authoritative for the running API.

- [Shared identity, authorization and recovery decisions](shared.md).
- [Database boundary and constraint rationale](database.md).
- [Exact financial contract and examples](contract.md).
- [Example SDL](schema.graphql) and [operations](operations.graphql).
- [Repeatable validation and behavioral vectors](validation.md).

P1 minimal profiles, P3 tab-scoped browser recovery and P4 first-journey scope were approved with ADR-005. P2 retains financial operation records for the lifetime of associated history, including definitive rejections; no 90-day expiry/tombstones. Uploaded receipt images/PDFs, OCR and retention policy remain deferred. [Owner decision](https://github.com/haggaikaunda/kami-split/pull/95#issuecomment-5901138197).

Later invitation policy requires fresh targeted invitations for former-member readmission; shared links are first-time-only. See [onboarding](../../onboarding.md) and ADR-006/009 rather than older proposal assumptions. Work sequencing and historical validation belong on [#76](https://github.com/haggaikaunda/kami-split/issues/76) and PR #95.
