# Product scope

## Implemented web preview

The approved seeded UX is complete: [tracker #13](https://github.com/haggaikaunda/kami-split/issues/13), child issues #14–31, and [LAN preview fix #50](https://github.com/haggaikaunda/kami-split/issues/50). The seeded preview runs on deterministic in-memory fixtures behind an asynchronous data-access interface. Browser sessions are independent; reload resets data and unsaved drafts.

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

The separate Go API now implements verified authentication, per-group authorization, atomic expense/allocation/audit/result storage, same-attempt recovery, complete balances and internal targeted invitations. The real [onboarding](application/onboarding.md) (#80) and [Relay expense journey](application/relay-expenses.md) (#83) connect invited users to persisted group expenses and complete balances. Remaining preview routes are labeled simulated and stay isolated from real financial data. See the [current API architecture](application/api-architecture.md) for implemented boundaries and remaining work. The [data-access design](design/data-access.md) preserves the original browser integration design.

Budgets, bank synchronization, receipt scanning, recurring expenses, percentage splits, currency conversion, debt simplification, itineraries and social features are outside the implemented phase. Trip cover upload/edit and repayment editing/deletion are also excluded.

## Accepted production direction

[ADR-003](application/decisions/003-bootstrap-groups-and-invitations.md) records the approved bootstrap, group and invitation baseline in [#77](https://github.com/haggaikaunda/kami-split/issues/77). Production uses operator-only first-account/empty Household bootstrap, separate verified-email invitations, and independent groups for household, trips and ordinary groups. A trip invitation grants no household access; every expense and settlement belongs to one group. The designated stable application identity alone may create groups for now. The identity foundation and internal invitation/admission operations implement part of this policy. Operational bootstrap, public onboarding and group-creation transport remain separately owned work; the preview above continues to simulate its account flows.

The #111 server Household dashboard includes the household plus groups where both partners are active, retaining source-group obligations and settlement targets. Its approved narrow summary is signed informational viewer net, eligible/open-space counts and active expense face-value totals; couple-spending, averages and historical reporting remain undecided. Ownership transfer is accepted but low-priority deferred (#84); group/trip creation, dashboard browser integration and settlement work are outside the first authenticated expense milestone (#73). Historical preview descriptions above remain accurate for that phase, including household-scoped trip expenses and simulated setup/roles.

[ADR-004](application/decisions/004-group-balances-membership-and-recovery.md) records #93’s automatic within-group debt simplification, individual-zero-net departure/removal condition, identity-preserving ordinary-member/full-history readmission and durable same-attempt expense recovery requirements. These supersede the production direct-obligation departure restriction, while the preview’s unsimplified behavior and evidence remain unchanged. The reviewed identity and expense contracts now underpin implemented [persisted expenses](application/persisted-expenses.md), including deterministic simplification and durable recovery, and [internal invitations](application/targeted-invitations.md), including identity-preserving readmission. Departure/removal mutations remain deferred; the first real browser expense journey now uses the implemented recovery and balance contracts. #77’s documentation baseline was completed through merged [PR #92](https://github.com/haggaikaunda/kami-split/pull/92); historical preview evidence does not establish completion of later release gates.

## Verification and remaining limits

The [verification report](accessibility/README.md) and [criterion matrix](accessibility/criterion-matrix.md) record the completed P01–P10/N01–N07 checks. Actual text enlargement, responsive widths, browser accessibility-tree and keyboard flows were checked. Physical mobile keyboard/notch and spoken VoiceOver/TalkBack output were not verified; the report states the substitutes and limits. The LAN startup regression and actual LAN save flow were subsequently verified in [PR #51](https://github.com/haggaikaunda/kami-split/pull/51).

Legacy greeting pilot issues #6–9 remain a separate workflow exercise. They are not missing pieces of the completed UX and do not define the production roadmap.
