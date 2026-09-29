# Exact-money ledger

## Production group boundary

[ADR-003](application/decisions/003-bootstrap-groups-and-invitations.md#b2-groups-are-independent-access-and-financial-boundaries) requires each expense and settlement to belong to exactly one independently authorized group. Trip groups have their own balances and obligations; no cross-group netting, transfers or duplicate records occur. The preview uses one household snapshot with optional expense `tripId`; that association is not the production schema. Zero aggregate net across groups does not settle their obligations. The current parsing and safe-number rules below remain preview evidence; unresolved production money/transport details are O08/#76.

## Seeded preview

`apps/web/src/lib/ledger.ts` is the shared pure financial boundary. Values are integer minor units. The record limit is 999,999,999 minor units ($9,999,999.99 USD). Parsing rejects rounding, signs, exponent notation, whitespace and more than two decimal places. Exact allocations may be zero; expense and repayment totals must be positive. Aggregate addition rejects unsafe integers instead of returning an imprecise result.

Equal splits assign remainder cents to participant IDs in ascending code-unit order, independent of UI selection order. Participant membership is explicit and includes members with zero shares. A payer can be outside the participant set. One payer pays the full record total; allocations must independently reconcile to that total.

Positions are computed per currency as paid minus allocated share plus repayments sent minus repayments received. Spending and contributions exclude repayments and soft-deleted expenses. Selectors consume exactly one current snapshot per expense, using effective dates; revision history is a separate adapter responsibility. Editing replaces that current snapshot before recomputation. USD is the only enabled seed currency; EUR exercises partitioning in domain tests, without currency conversion.

This module provides no authentication, persistence, request deduplication, revisions or UI. The shared data adapter and application providers supply simulated access checks, session request deduplication, revisions and UI; see [session mock data](mock-data.md). Real authentication and durable persistence remain outside this phase.
