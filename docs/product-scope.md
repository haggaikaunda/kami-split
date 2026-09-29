# Product scope

## Current implemented phase

The approved seeded UX is complete: [tracker #13](https://github.com/haggaikaunda/kami-split/issues/13), child issues #14–31, and [LAN preview fix #50](https://github.com/haggaikaunda/kami-split/issues/50). The app runs on deterministic in-memory fixtures behind an asynchronous data-access interface. Browser sessions are independent; reload resets data and unsaved drafts.

Implemented capabilities:

- Exact integer-minor-unit expenses with payer, participants, equal or exact-amount splits, date, category, optional trip and note.
- Multi-member balances and direct obligations; repayments with an exact before/after preview. The default sample has two members, but the model and three-member fixture do not impose that limit.
- Auditable revisions, conflict-aware editing, soft deletion and retained tombstones.
- Filterable chronological financial history and context-preserving navigation.
- Trip creation, status filters, detail/expense views, shared totals, and default/photo covers.
- Daily, monthly and yearly spending views, trip/category charts, contributing-record drill-downs and exact tables. Repayments do not increase spending.
- Simulated sign-in/invitations, distinct empty-household setup, owner/member roles, invitation management and removal safeguards.
- Typed loading, stale/offline, denied/expired, validation, conflict and unknown-completion recovery with stable request identifiers.

USD is the only enabled UI currency. Domain records carry currency; there is no conversion or mixing of currency balances. A trip expense is one household record, counted once.

## What this phase does not provide

There is no database, durable cross-device storage, real identity provider, delivered email, protected invitation token, server-enforced authorization or payment processing. Adapter guards test the intended rules in a simulation; they do not secure private data. This preview should be described as a demo, not a production private service.

Production work requires separately approved issues for authenticated server transport, per-group authorization, durable atomic writes, version/idempotency guarantees, protected invitations and immutable audit storage. The [data-access design](design/data-access.md) describes this future boundary; completing the UX did not complete those release gates.

Budgets, bank synchronization, receipt scanning, recurring expenses, percentage splits, currency conversion, debt simplification, itineraries and social features are outside the implemented phase. Trip cover upload/edit and repayment editing/deletion are also excluded.

## Accepted production direction

[ADR-003](application/decisions/003-bootstrap-groups-and-invitations.md) records the approved bootstrap, group and invitation baseline in [#77](https://github.com/haggaikaunda/kami-split/issues/77). Production uses operator-only first-account/empty Household bootstrap, separate verified-email invitations, and independent groups for household, trips and ordinary groups. A trip invitation grants no household access; every expense and settlement belongs to one group. The designated stable application identity alone may create groups for now. These are accepted policies, not implemented features.

The future household dashboard includes the household plus groups where both partners are active, retaining source-group obligations and settlement targets. Exact spending/reporting formulas remain undecided. Ownership transfer is accepted but low-priority deferred (#84); full group/trip design (#85), dashboard design (#86) and settlement work are outside the first authenticated expense milestone (#73). Historical preview descriptions above remain accurate for that phase, including household-scoped trip expenses and simulated setup/roles.

[ADR-004](application/decisions/004-group-balances-membership-and-recovery.md) records #93’s automatic within-group debt simplification, individual-zero-net departure/removal condition, identity-preserving ordinary-member/full-history readmission and durable same-attempt expense recovery requirements. These supersede the production direct-obligation departure restriction, while the preview’s unsimplified behavior and evidence remain unchanged. Exact algorithm, schema, profile, protocol and retention choices still need review. #77’s documentation baseline is complete through merged [PR #92](https://github.com/haggaikaunda/kami-split/pull/92); this follow-up does not implement or automatically ready #75/#76/#79.

## Verification and remaining limits

The [verification report](accessibility/README.md) and [criterion matrix](accessibility/criterion-matrix.md) record the completed P01–P10/N01–N07 checks. Actual text enlargement, responsive widths, browser accessibility-tree and keyboard flows were checked. Physical mobile keyboard/notch and spoken VoiceOver/TalkBack output were not verified; the report states the substitutes and limits. The LAN startup regression and actual LAN save flow were subsequently verified in [PR #51](https://github.com/haggaikaunda/kami-split/pull/51).

Legacy greeting pilot issues #6–9 remain a separate workflow exercise. They are not missing pieces of the completed UX and do not define the production roadmap.
