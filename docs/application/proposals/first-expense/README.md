# Coordinated identity and expense contract proposal

Status: **proposed engineering design, not accepted or implemented**. Design-only
handoff for [#75](https://github.com/haggaikaunda/kami-split/issues/75) and
[#76](https://github.com/haggaikaunda/kami-split/issues/76). No production SQL,
running SDL, resolvers, Auth, invitation service or Relay changes belong here.

Read [shared decisions](shared.md), [database boundary](database.md),
[API contract](contract.md), [proposed SDL](schema.graphql),
[operations](operations.graphql), and [gates and owner decisions](gates.md).
[Validation evidence](validation.md) distinguishes executable checks from future
implementation acceptance scenarios.

## Baseline and reconciliation

Inspected main `7498e78`, current issue bodies/comments #74–#83, open PRs and
remote branches on 2026-09-29. No competing #75/#76 design branch/PR existed.
#74 is complete: reuse `kami_migrator`, `kami_api`, private `app`, pgxpool,
Supabase CLI 2.118.0/PostgreSQL 17, sqlc 1.31.1, desired SQL/manual immutable
migrations, isolated `make db-test`, and CI Verify. Do not add another runner.
The initial local checkout predated ADR-003/004; this proposal uses current main.

Accepted authority is [ADR-001](../../decisions/001-backend-foundation.md),
[ADR-002](../../decisions/002-authentication-and-database-operations.md),
[ADR-003](../../decisions/003-bootstrap-groups-and-invitations.md) and
[ADR-004](../../decisions/004-group-balances-membership-and-recovery.md).
#77/#92 and #93/#94 are completed policy documentation, not work to repeat.
The preview's pending members, first-household setup, direct-debt departure
check and in-memory receipts are not production policy.

Newer authoritative invitation comments supplement stale body/register wording:

- [Email comparison/delivery](https://github.com/haggaikaunda/kami-split/issues/79#issuecomment-5886277636): case-insensitive, trimmed comparison, no alias merging;
  delivery failure does not undo committed invitation state.
- [Valid-link preview](https://github.com/haggaikaunda/kami-split/issues/79#issuecomment-5886419039): group name and inviter display name may be disclosed before sign-in;
  owner-distributed generic links send no application invitation email; seven-day
  validity and explicit same-link renewal, including after expiry.
- [Immediate first-time admission](https://github.com/haggaikaunda/kami-split/issues/79#issuecomment-5886876182): verified first-time holders, including forwarded recipients,
  explicitly Join without an owner-approval queue. Joining does not consume a
  multi-person link. Former-member shared-link readmission, limits, ownership
  changes and placement remain gated in #79/#80. Fresh-targeted-only readmission
  is not accepted policy.

These references inform the boundary only; #79/#80 still own their reviewed
invitation contract and reconciliation. No invitation fields are published here.

## Journey and handoff

#80 registers/authenticates an invitation-eligible user; #79 admits them using
#75 stable identities and the narrow admission boundary. #78 supplies verified
Auth context. Viewer/group reads then expose only authorized projections. #82
lists and creates USD expenses and atomically saves audit/receipt; #83 preserves
the original attempt and refreshes complete balances after recovery.

#75 implementation remains open after this design. #76 remains open until the deferred receipt-retention
choice and final contract approval are recorded. P1 profile fields, P3 client
storage direction and P4 first UI scope were approved on 2026-09-29; see the
[decision sheet](gates.md). Merge of documentation alone
must not be interpreted as accepting every proposed choice.
