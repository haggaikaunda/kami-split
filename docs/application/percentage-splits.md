# Percentage expense splits (#199)

The authenticated shared Add expense form and expense details support Equal,
Exact and Percentage across Household, Groups and Trips. The attached concept
reference informs the percentage fields and adjacent amounts; the approved #189
shell, tokens, required fields and source ownership remain authoritative. Expense
editing is outside this delivery.

Percentages describe responsibility, not payment. The single payer may be outside
the selected participants. Decimal text accepts up to two decimal places, including
explicit 0%; blank is incomplete. `60`, `60.0` and `60.00` normalize to 6000 integer
hundredths. The exact selected total must be 10000. Equal is the option for equal
thirds; `33.33 / 33.33 / 33.33` remains invalid at 99.99%.

The server validates exactly one percentage for each distinct selected eligible
same-group membership, no extras. GraphQL `percentages` is absent/null for
Equal/Exact; `exactAllocations` is absent/null for Percentage. An empty supplied
list is never an omission. GraphQL Int rejects fractional wire hundredths.

For each share, resolve `totalMinor * hundredths / 10000` using integer quotient
and remainder. Distribute remaining cents by descending remainder, then ascending
canonical membership identity; row order has no effect. Explicit zero never
receives a remainder cent. Go bounds multiplication below 9999999990000; browser
previews and SQL checks use bigint/numeric. Equal's existing remainder rule is
unchanged. Shared vectors live in `packages/schema/testdata/percentage.json`.

The nullable allocation percentage column preserves intent without manufacturing
it for old records. Cent allocations remain authoritative for balances, filters,
repayments and Household aggregation. Deferred constraints reconcile percentage
sum, deterministic cents and immutable recovery snapshot in the same expense,
audit, financial revision and outcome transaction. Runtime UPDATE/DELETE rights
remain absent. Fresh eligibility uses the existing locking protocol; historical
successful replay still requires current actor/group access, not active status for
every former participant.

Equal/Exact keep their original `create-expense-v1` canonical bytes. Percentage
(and invalid mixed percentage input) uses `create-expense-percentage-v2`. Canonical
comparison includes sorted normalized percentages, even when different intent
resolves to identical cents. Actor/group/operation/key uniqueness and lifetime
retention do not include payload version. Definitive rejections remain durable.

Browser writes use envelope version 2 under the existing tab storage key. Version
1 Equal/Exact drafts and frozen attempts remain readable without rewriting their
original inputs/keys. Unknown/malformed envelopes block new writes. No mount or
restore rebalances percentages. Fresh two-person Percentage entry initializes
50/50 with an explicit link checkbox. A valid user edit links the complement;
blank/invalid intermediate text leaves the other field intact. Changing selection
disables linking and preserves all entered values, including deselected people.
Three or more participants use individual fields and explicit Assign remaining.
Amount changes retain percentages; switching modes retains each mode's drafts.
Only fully valid forms show final allocations and enable Percentage Save.

## Deployment and rollback

1. Apply additive migration `20261014000000_percentage_splits.sql` first. Old API
   Equal/Exact writes remain valid; no old canonical rows or outcome JSON change.
2. Deploy the updated API and generated clients/readers with
   `API_PERCENTAGE_WRITES_ENABLED=false` (the default). Verify authorized detail
   and recovery readers. Old readers display stored cent allocations and do not
   recalculate them; retire old client builds before enabling the new mode.
3. Deploy the web release and invalidate old cached application builds, then set
   `API_PERCENTAGE_WRITES_ENABLED=true` only after compatible readers are present.
   The form can receive a definitive unavailable rejection while writes are gated.
4. Roll back fresh writes by setting the flag false; retain this additive schema
   and compatible API/detail/recovery readers. Do not roll back readers to versions
   that lack the Percentage contract once percentage history exists. Do not drop
   metadata or rewrite history to Equal/Exact. Gate-off retries of committed
   originals still return their original outcome; rejected keys remain rejected.

No hosted deployment or new expense edit/delete capability is implied by this PR.
Rendered evidence and residual verification limits are recorded on the delivery PR.
