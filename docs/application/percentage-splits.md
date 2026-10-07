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

Percentage is a normal supported split mode alongside Equal and Exact, with no
opt-in configuration. The owner decision in #208 supersedes #199's default-off
rollout gate. The retired `API_PERCENTAGE_WRITES_ENABLED` setting has no runtime
effect, including a stale `false` value. The form still initially selects Equal.
The owner confirmed production has no records; this cleanup requires no new
migration, reset, or compatibility machinery for historical gate rejections.
Existing financial history and safe operation recovery remain unchanged.

1. Verify the target environment's migration status (for example, `supabase
migration list --linked` against the intended project). Apply missing migrations
   through the approved migration deployment workflow, including
   `20261014000000_percentage_splits.sql`, before serving the updated application.
   Do not assume source merge means the migration has run, or rewrite an applied
   migration. Fresh setup uses the same checked-in migrations.
2. Ensure the API SDL/generated readers and deployed web application agree on
   Percentage inputs, stored intent, cent allocations and recovery. Deploy the
   updated API and web releases together; invalidate obsolete cached web builds.
   Supported deployments provide Percentage without an activation step.
3. Remove the obsolete hosted environment setting from deployment configuration.
   Its presence cannot disable writes, but cleanup prevents misleading operations.
4. Smoke-test a real authenticated Percentage create/read/recovery journey from
   Household (with an explicit authorized source ledger), Group and Trip entry.
   Verify $10.01 at 60%/40% saves $6.01/$4.00, detail retains percentages, balances
   reconcile, and an uncertain response recovers the original operation. Check
   Equal/Exact and cross-group denial as well. Record the deployed release,
   migration status and results.

Rollback uses a coordinated compatible API/web redeployment, retaining the
percentage schema and readers once Percentage records exist. There is no
percentage kill switch. Do not deploy a reader that cannot understand stored
Percentage intent, drop metadata, or rewrite history to Equal/Exact. Prefer a
forward fix when an older release cannot preserve creation/detail/recovery
contracts. No destructive reset or unrelated auth/application cleanup is needed.

Hosted migration status and deployment smoke tests remain operator actions until
actual target-environment evidence is recorded. Repository checks and source merge
alone do not establish hosted readiness. No hosted deployment or expense
edit/delete capability is implied by this change.
