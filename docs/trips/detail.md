# Trip detail

> Historical seeded-preview evidence only. The executable preview, its routes, providers and tests were retired in #184. This document does not require their preservation or describe current production capabilities. Current behavior is documented in the [application guide](../application/README.md).

## Accepted production direction

The household expense filters and household repayment link below describe the preserved preview. [ADR-003](../application/decisions/003-bootstrap-groups-and-invitations.md#b3-household-dashboard-and-group-specific-repayment) requires future repayment entry to target the original trip group, whether opened here or from a dashboard, with no Household copy or cross-group offset. No private-household-expense-to-trip-report association was adopted. Full group/trip and consolidated dashboard design remain #85/#86, outside #73.

## Seeded preview

Issue [#26](https://github.com/haggaikaunda/kami-split/issues/26) expands the saved trip destination into the approved hero, Overview/Expenses views, total spending, actor share and member contributions. Every member is rendered by stable ID, including zero contributions; layouts wrap rather than assuming a pair.

`tripDetail` selects current active household expense records through the shared spending selector. Its paid/share positions use only those exact records and no repayments. It includes effective dates outside travel dates and partitions by the household currency. Missing trips return no model; empty accessible trips show actual zero values. The shared spending selector now preserves the input record type, with no runtime calculation change.

Expenses group by effective date, with exact daily sums. Description search and category filters live alongside `tab` and `visit` in the URL. Same-screen query replacement preserves control focus and unrelated query state. Each expense link captures its own source visit; refreshed snapshots recompute the list after an edit, association removal or deletion, including empty filtered results. Add expense captures this trip and uses the existing editable suggested-date defaults. The repayment action explicitly opens the household flow and explains that repayments do not change trip spending/shares.

Daily/category sections now use the shared [interactive spending charts](../spending/README.md), with exact-value tables and source-preserving expense drill-downs. Sample covers, deterministic fallback and credits reuse issue #25.

Validation includes approved Maui totals and paid/share, three-member conservation, identical household IDs, pre-trip creation, date grouping/filtering, association removal, soft deletion and repayment exclusion; integration tests cover URL/focus, captured expense/add/repayment navigation, pre-trip form submission, loading, empty/missing, stale and denied views. Independent requirements tests use actual adapter mutations to verify exact amounts and preserved revisions. This remains a session-only preview, with no persistence or server-authentication claim.
