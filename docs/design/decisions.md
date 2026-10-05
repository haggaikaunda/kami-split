# Design decisions

> Historical seeded-preview evidence only. The executable preview, its routes, providers and tests were retired in #184. This document does not require their preservation or describe current production capabilities. Current behavior is documented in the [application guide](../application/README.md).

Production-policy note: [ADR-004](../application/decisions/004-group-balances-membership-and-recovery.md) now accepts automatic within-group simplification, revised departure eligibility and recovery/readmission requirements. Unsimplified debt and session-only behavior in this document remain historical seeded-preview requirements/evidence, not the current production policy.

| Decision                               | Rationale and consequence                                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Seeded-data implementation first       | Exercise real UI/domain outcomes now; isolate persistence behind async access. Session mutations reset on reload. No production privacy claim. |
| Household/members, not a fixed couple  | Two-person defaults are fast; three-member data and layouts remain possible.                                                                   |
| Four navigation destinations           | Overview, History, Trips, Household. No duplicate Balances page. History is an audit activity feed.                                            |
| Named balance direction                | “Kaunda owes Mizenin” avoids ambiguous “You owe.” Zero is explicitly settled.                                                                  |
| Expenses have stable URLs              | Desktop contextual panel, phone/direct-link full page, replace semantics for Open full page. Context survives Back/Forward.                    |
| Amount-first forms                     | Most salient financial input first; desktop dialog and mobile full-screen presentation share one form model.                                   |
| Equal/exact split only                 | Reconciliation visible before save; percentages may be added later, no placeholder tab now.                                                    |
| Charts are included, budgets excluded  | Explore actual spending across days/months/years without target spending or progress bars.                                                     |
| Trip is an expense association         | One household record, counted once. Trip totals exclude repayments; settlement remains household-scoped.                                       |
| Trips are not a travel planner         | Name, dates, destination, spending; no itinerary, planning notes, bookings or recurring schedule features.                                     |
| Currency explicit, USD fixture only    | No mixing or conversion; retain currency fields and partitioned future calculations.                                                           |
| Soft deletion and immutable revisions  | Financial effect can be removed without erasing attribution or prior state.                                                                    |
| Distinct event/effective dates         | History explains when changes occurred; charts explain when spending occurred.                                                                 |
| External sample images are replaceable | Preserve credits/source list; do not make network images a functional dependency.                                                              |

## Deferred / excluded

Database persistence/migrations; real authentication/email and access tokens; payment processing or payment methods; bank sync; receipt scanning/attachments; budgets; recurring expenses; currency conversion; debt simplification; social features; itinerary/travel planning; percentage splitting; trip cover upload/edit; additional reporting dashboards; audit event restoration; repayment correction UI (requires a separately approved audited reversal design).

## Prototype versus approved behavior

The prototype is a visual and interaction reference, not proof of correctness. Implementations must correct these known shortcuts:

- Names/array indexes and pair-only calculations → member IDs, explicit participants and tested multi-member domain rules.
- Included zero share inferred as excluded → retain participant set independently of amounts.
- Silent exact-allocation loss on split mode change → preserve drafts or confirm discard.
- Hash navigation bypasses dirty guards → cover all exits and in-flight/unknown outcomes.
- Per-expense global origin and cached chart HTML → per-visit route state and current-data recomputation.
- Simulated toasts and delays → typed adapter errors, real idempotency and expected-version semantics in memory.
- Date-only/fixed event time → distinct event timestamps and effective dates with stable sequence.
- Fake minimum positive bar heights / hardcoded scale → accurate zero-based charts with separate visible hit targets.
- Returning a current record without highlighting clicked audit event → identify the selected immutable revision within detail.
- Prototype contrast/small metadata, native confirm dialogs and inaccessible empty-action variants → verified accessible primitives and layouts.

Document any intentional deviation in the issue/PR and update this specification if approved; do not reproduce a reference bug solely to match its screenshot.
