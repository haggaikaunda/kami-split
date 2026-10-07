# #86 delivery slices and acceptance trace

Status: delivery map following adoption of [ADR-007](../decisions/007-household-dashboard.md).
The original design delivered no runtime feature. #130 designation, #110 repayment
persistence/API, #111 summary reads and #169 structured-filtered expense views are implemented; #112 implements the Household Overview/Balances/Members workspace; the complete Expenses tab is implemented by #170. Unresolved policy is
explicitly deferred, not silently approved by a follow-up issue.

| Slice                                                                         | Dependency / readiness                                                         | Deliverable                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#109 Pair policy](https://github.com/haggaikaunda/kami-split/issues/109)     | #86 adopted; owner agreement required                                          | Designation/change authority, pre-onboarding and disabled-partner policy, dashboard access, stable identity and compatible locks; separate implementation after review.                                       |
| [#110 Group repayment](https://github.com/haggaikaunda/kami-split/issues/110) | #82; reviewed settlement permissions/validation contract before code           | Small design, persistence and API PRs for one group-specific actual repayment and same-attempt recovery. Reuse ledger/operation infrastructure; no dashboard dependency.                                      |
| [#111 Summary reads](https://github.com/haggaikaunda/kami-split/issues/111)   | #82, #109 policy and designation implementation; #104 metadata for trip labels | Implemented complete authorized eligible-set query, signed viewer net, counts and simple expense face-value totals; no settlement duplication.                                                                |
| [#112 UI integration](https://github.com/haggaikaunda/kami-split/issues/112)  | #83, #105, #111; #110 before repayment activation                              | Household Overview/Balances/Members with original-space drill-down and accessible source restoration. Repayment entry is only in original Group/Trip balance details; complete Expenses is delivered by #170. |

#75 and #85 remain their delivered foundation/design scopes. #79/#80 own actual
invitation/onboarding; no inferred partner admission. None of these slices blocks
#73's single-group expense journey. Couple-spending/average formulas and historical
reporting remain O19; refunds/corrections and settlement editing/reversal remain
O11/O12. Add separate scoped issues only when those features are requested.

## Requirements trace for design review

| #86 criterion                                         | Design evidence                                  | Future execution evidence                                        |
| ----------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| Ledger/dashboard distinction and inclusion            | Boundary; D1, D5, D7                             | #109/#111 real-role eligibility fixtures                         |
| Household/trip/ordinary/private/access/state examples | D1–D12; read failure contract                    | #111 security/race tests; #112 state tests                       |
| Perspective, derivation, cycles and no double debts   | Exact amounts; D1–D4, D11                        | #82/#110/#111 shared ledger/aggregate tests                      |
| Original-group repayment and uncertain recovery       | One group-specific operation; T/K example        | #110 restart/concurrent retries; #112 navigation recovery        |
| Server authorization and complete reads               | Read contract; D5, D9–D10                        | #111 nested access, pagination independence, snapshot/race tests |
| #76 money and deferred metric/history policy          | Exact amounts; boundary; D11–D12                 | #111/#112 scalar bounds and exact display                        |
| Accessibility, refresh and confirmation               | Navigation and consumer mapping                  | #112 browser/keyboard/320px/200% evidence                        |
| Small backend/settlement/UI slices, no running fields | Linked issues above; docs-only diff              | Each slice's independent requirements/final-diff review and CI   |
| Documentation accuracy and independent checks         | Inspect linked source consumers and current ADRs | Record commit, commands, findings and limits on #86 PR           |

Design probes are reviewable expected outcomes, not tests asserting prose or
claims of implemented UI/security. Required repository checks still run; independent
testing reviews arithmetic, inclusion, recovery and source accuracy, while final-diff
review checks the complete design against #86 and accepted decisions.

## Structured expense views (#169)

The API supports one forward chronological Household feed over the same authorized
eligible spaces as #111, plus group-local parity. Complete filtered face-value
spending totals/counts and monthly aggregates accompany each page, without using
loaded rows as an aggregate. Source/category/member/inclusive-date filters and
signed per-space anchors keep summaries and traversal consistent. Member matching
is payer-or-explicit-participant, including zero shares, separate from the existing
participant-only group connection. Every continuation revalidates current access.
#177 retains all production text-search design; #112 owns browser presentation.
