# Group repayment persistence

The internal application operation implements the [approved #110 contract](proposals/repayments/README.md).
Any currently authorized active group member can record an actual transfer between
distinct active, enabled, linked same-group memberships. The server derives creator
separately from sender/recipient. Partial repayments, overpayments and transfers
without a current simplified edge are allowed. No payment processing occurs.

This persistence slice adds no GraphQL repayment mutation or browser form. The
follow-on API slice must add authorized history and operation recovery before the
feature is available to users; #110 remains open until that work passes its gates.

## Exact balances and atomic history

Each record is 1–999999999 USD cents, with exact integers throughout. Complete
member net is paid − owed + sent − received. Expense totals remain expense-only.
Retained inactive history participates in the same existing simplifier. Both
expense and repayment writes check the complete candidate projection under the
group lock; intermediate arithmetic uses wide integers and rejects out-of-range
final aggregates/nets. Every individual's net must be zero to call a group settled.

The additive migration backfills `financial_records` from existing expenses.
Record insertion triggers register one shared group revision; a primary key
prevents cross-kind revision reuse. Repayment, registry, audit and successful
outcome commit together. Deferred constraints prevent incomplete records and
later attachments; successful recovery results require a matching financial row.
Runtime roles have no financial UPDATE/DELETE or direct registry INSERT grants.

The historically named `expense_operations` table now supports CREATE_EXPENSE and
RECORD_REPAYMENT. Existing expense canonical bytes and outcomes stay unchanged.
Both use the same application lookup/compare/transaction engine, with actor/group/
kind/key binding and lifetime-of-history retention. Current actor access is checked
before returning an original result, and historical lookup precedes counterparty
eligibility. New writes restart in user-before-group lock order. UNKNOWN and
NOT_OBSERVED require the same original key/input; neither authorizes a fresh key.

Complete authorized read snapshots include both kinds in the financial revision
and all sent/received history. Original results retain their own revision and
financial values; updated balances require a fresh read. Expense cursor anchors
still bound expense inclusion and do not acquire repayment edges.

## Verification

Pure ledger tests cover approved overpayments, D2–D4, canonical intent and checked
arithmetic. Restricted PostgreSQL tests cover atomic writes, current access,
concurrent retries, commit-response loss, membership/account races and rollback.
`make db-test` checks populated expense upgrade/backfill, fresh replay, schema and
grant consistency, integration behavior and full financial backup/restore. Required
root checks, sqlc/gqlgen drift and independent review remain delivery gates.
