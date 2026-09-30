# ADR-007: Household dashboard and group repayment entry

- Status: Design for [#86](https://github.com/haggaikaunda/kami-split/issues/86); independent review and PR adoption required. No runtime implementation.
- Recorded: 2026-09-30.
- Basis: ADR-003–006, implemented #75 foundation, reviewed #76 contract.

## Boundary and deliberately deferred policy

The **Household group** is one private ledger, identified by the existing installation
household pointer. The **Household dashboard** is an authorized overview of that
ledger and ordinary/trip groups where both designated partners are active members.
It owns no expenses, balances or settlements. Trips remain independent groups;
there is no private-household-expense-to-trip association or copied repayment.

A partner designation is not implemented by #75 or defined by #85. Do not infer it
from group ownership, creator permission, first two members, names, invitations or
email. Designating/changing the pair (who can do it, confirmation, stable identity
representation and effects of separation/disabled accounts) requires owner agreement
in the follow-up policy slice before a consolidated query ships. This is an explicit
O19 deferral, not an implicit new partner role or permission. Examples below use an
explicitly configured synthetic A/B pair, not a proposed automatic designation.

Until a pair is designated and admitted, show the viewer's authorized Household
ledger with “Shared overview is not available yet”; omit consolidated metrics and
other-group discovery through this page. Do not expose the intended partner's
identity or pending invitation to an unauthorized viewer. Use the existing authorized
Groups list for individual access. After designation, no pair membership in another
group is automatic. Active membership is necessary; disabled/unlinked viewer access
is always denied. The unresolved disabled-partner designation policy must be resolved
before enabling the shared overview; never substitute a different partner.

Dashboard access itself requires an enabled, linked designated partner with active
Household membership. This proposed narrow entry rule is part of the pair-policy
owner gate, not a new permission granted by this ADR. Until that rule is approved,
only ordinary authorized group reads may ship. A friend who shares a trip gets its
normal group detail, never household metadata, partner IDs or a dashboard shortcut.

The minimal reviewed engineering presentation is individual balances with source-group
breakdown. No combined couple-net card, “our spending”, average-trip spending, trip
count denominator or historical date-range dashboard is introduced. Their formulas,
allocated-versus-paid basis, inclusion dates/time zone and treatment of membership
changes remain deferred O19 product decisions. Friends' entire expenses are not
couple spending. These decisions do not gate #73 or ordinary group balances.

## Perspective, derivation and exact amounts

Reuse [ADR-005 S4](../proposals/first-expense/shared.md#s4-complete-money-projections)
for each complete group/currency projection: for member m, net(m) = expenses paid −
allocated shares + actual repayments sent − actual repayments received. Positive
means is owed; negative means owes. Include retained inactive financial history.
Every individual zero means settled; sum of all nets zero proves conservation only.
Use the same deterministic debtor/creditor matching by canonical membership IDs as
#76, never another dashboard simplifier. Original payer/allocation relationships
remain history, not a second set of debts to display or repay.

For each group, show “You owe” = max(−viewer net, 0), “You are owed” = max(viewer net, 0),
and signed “Your net”. Label the partner's position by their authorized display name,
never call that position “you”. Each position opens the paid/share/sent/received
explanation and the current simplified obligations. Group obligation rows name the
sender, recipient, source group and USD amount, grouped by counterparty **inside
that group**. Include obligations between other members in the authorized group
breakdown so a zero viewer balance cannot imply a settled group. No cross-group
counterparty amount is actionable. Do not add A and B's positions together: their
mutual obligation would disappear.

Optional overview totals in the initial design are three viewer-only figures over
the complete eligible set E: You owe = sum(max(−net(g,viewer),0)); You are owed =
sum(max(net(g,viewer),0)); Your informational net = are owed − owe. Always show the
two gross figures alongside the net and the text “Balances stay in their original
groups; a zero overall net does not settle them.” No repay action on a total.
These are engineering definitions for review, not spending metrics. Omit all three
if complete data is unavailable; never sum visible rows or expense pages.

Money follows [#76 A1](../proposals/first-expense/contract.md#a1-exact-scalar-and-field-rules):
USD only; canonical string MinorUnits, checked exact SQL numeric/Go arithmetic,
wire int64 bounds, TypeScript branded strings and bigint; no GraphQL Int, Number
or parseFloat aggregate arithmetic. Per-member net magnitude and nonnegative
aggregate maxima are 9223372036854775807 cents. Cross-group gross sums are checked
against the same maximum before serialization; overflow means AMOUNT_OVERFLOW and
no totals, not clipping or a wrapped net. Record repayment bounds remain
1..999999999 cents. Display currency and exact cents, including
`"9007199254740993"` → `$90,071,992,547,409.93 USD`. Amount inputs use #76's decimal
text parsing; no rounding or currency conversion.

## Reviewed examples and acceptance probes

These are synthetic design probes, not evidence of implemented browser behavior.
Amounts below are USD; corresponding wire values are integer-cent strings.
A is the viewer, B the designated partner, C a friend. H is Household, T a trip,
F an ordinary shared group and X a group joined by A alone.

| Probe                              | Complete group facts                                                                | Required presentation / invariant                                                                                                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1: source breakdown               | H: A −2000, B +2000; T: A +2000, B −2000; F: A −500, B 0, C +500                    | H A→B $20; T B→A $20; F A→C $5. Viewer owes $25, is owed $20, net −$5. B's separately labelled positions remain visible. Every row links to its own group.                                                                                                        |
| D2: cross-group cancellation       | H and T from D1 only                                                                | You owe $20, are owed $20, informational net $0; both groups remain unsettled. Combined A+B net is not shown. Recording H's $20 affects H alone.                                                                                                                  |
| D3: same-group cycle               | Within F history A→B 2000, B→C 2000, C→A 2000                                       | Every individual net zero: F settled, no simplified obligations or repayment shortcuts. History stays visible in F.                                                                                                                                               |
| D4: conservation is not settlement | Within F history A→B 2000 and B→C 2000                                              | Nets A −2000, B 0, C +2000; only A→C $20 is current. B owes nothing; sum zero is not settled. One actual A→C repayment clears it; no fictitious B payment.                                                                                                        |
| D5: one partner only               | X contains A/C, not active B; X has A −9000                                         | No X name, ID, amount, count, nested node or contribution to dashboard totals. A may independently open X through Groups; B cannot. No “one hidden group” label.                                                                                                  |
| D6: access loss                    | B leaves T, or viewer loses T access                                                | T disappears and totals recompute from newly authorized eligible groups; no removed title in notice. A still in T can reach it through Groups if B left. If viewer loses Household/dashboard access, clear the whole dashboard. Late responses cannot restore it. |
| D7: no partner                     | Only A admitted in H; no finalized pair                                             | Authorized H ledger, explicit shared-overview-unavailable copy; no pretend combined zero or inferred B. Existing invitation UI only if implemented and authorized.                                                                                                |
| D8: empty versus settled           | Complete authorized H has no financial history; separately F has D3 history         | H says “No expenses or repayments yet”; F says “Settled”. No eligible extra groups is not an error; Household remains.                                                                                                                                            |
| D9: loading/error                  | Initial loading, unavailable discovery, or failed complete group aggregate          | Loading placeholder or unavailable/retry, never $0 or settled. Discovery failure discloses no cached group labels.                                                                                                                                                |
| D10: partial result                | H complete, currently authorized T summary unavailable                              | H may render with its own revision; T says unavailable only if inclusion/access were freshly confirmed. All overview totals absent, labelled incomplete. No complete/settled claim.                                                                               |
| D11: exact bounds                  | Large valid aggregate above JS safe integer; cross-group gross sum beyond int64 max | Exact string/bigint rendering; overflow suppresses totals with safe error, never partial sum.                                                                                                                                                                     |
| D12: membership history            | New authorized readmission under ADR-004                                            | Current eligibility decides inclusion; complete lifetime group history, including absence and inactive members, determines current nets. No date truncation to joining/travel dates. Historical “as of” reports remain deferred.                                  |

Changing eligible membership can change the current overview without changing any
ledger. Explain “Overview reflects groups currently shared by both partners”; do not
claim prior payments/expenses were deleted. Return current authorized labels only.
No cached historical dashboard is an authorization bypass.

## Read contract and consistency

This is an operation sketch, not new SDL or a generic server-driven UI schema.
The future `householdDashboard` projection needs an eligibility/completeness outcome,
authorized household reference, eligible group rows (ID/name/kind/currency), complete
GroupBalances (positions, obligations, settled, financial revision), and checked
viewer totals or an explicit unavailable/overflow result. Reuse #76's minimal
Membership identification; no peer Viewer IDs, emails or installation row exposure.
Do not publish any of these fields in the running API before their implementation.

The server discovers E from the approved pair designation and currently active
memberships; it authorizes the requesting viewer and every returned group/member,
including nested reads and independent node access. Client filters are presentation
only. Excluded groups leave no totals/counts/placeholders/IDs/errors. A direct hidden
ID uses the same safe NOT_FOUND outcome as a nonexistent group. No privileged
all-groups fetch serialized to the browser for local filtering.

Summary discovery is complete and nonpaginated initially, independent of bounded
expense connections. Reject a configured query-cost/deadline budget explicitly as
UNAVAILABLE instead of silently truncating E. UI may collapse/virtualize rows but
cannot change the complete aggregate. A later paginated summary contract requires
separate reviewed complete aggregate semantics; no “total of loaded pages”.

Proposed consistent read: after verified identity binding, acquire affected
user locks in canonical order (viewer and approved pair), then the designation's
read lock, then candidate eligible groups in canonical UUID order FOR SHARE. This
extends #75/#76's user-before-group discipline; the pair-policy slice must define
the designation lock and ensure all designation writers follow compatible ordering.
Read and recheck eligibility/authorization and all selected projections in one
subsequent SQL statement snapshot. A newly eligible group discovered after lock
acquisition requires bounded restart with the expanded lock set; never acquire a
user lock after a group lock. Omit newly ineligible groups before serialization.
If a coherent complete set cannot be established within the deadline, return
unavailable, not an apparently complete result. Backend implementation must test
this race and the designation protocol before exposing the query.

A complete response's totals and rows share that statement snapshot. Per-group
Revision tracks financial changes only, not access, labels or pair designation;
there is no invented global financial revision. Authorized row-local aggregate
failure may return D10 with no overview totals. If eligibility itself cannot be
confirmed, fail closed for the whole overview. Initial offline has no data.
During same-context refresh, retain values only with explicit “Refreshing”/last-read
labels while access remains confirmed; disable repayment. On failed revalidation
hide sensitive rows and show unavailable. Denial/expiry/account switch clears
fields immediately. Drop out-of-order responses by viewer/session, dashboard scope
and request generation, including previously valid results after membership changes.

Any confirmed expense creation, future authorized correction/refund or repayment
invalidates the affected group balances/expenses/history and dashboard eligibility,
rows and totals. Requery complete projections; do not increment a displayed total
from an immutable receipt. A successful write followed by refresh failure says
“Recorded; updated balances unavailable”, not “Save failed”. Refund/correction
writes, reversal, inactive-member debt reopening and disputed obligations remain
O11/O12 gated; this read design does not permit them or select their policies.

## One group-specific repayment operation

Both a dashboard obligation row and group detail open the same future form and
operation. Route `/groups/:groupId/repayments/new` captures the original group,
sender and recipient Membership IDs from a fresh complete projection. Group is
read-only in the form. Label, for example, “Record repayment — Trip T”,
“B repaid A”, `$20.00 USD`, and “Record money already transferred; no money moves”.
Group detail and dashboard never map a trip repayment to Household. Revalidate
current authorization, counterparties, complete balance revision and the settlement
capability before enabling Save. Capabilities are hints, not write authorization.

Settlement persistence is a prerequisite, absent from #82's create-expense scope.
Its follow-up must finalize creator-versus-sender permissions, partial/overpayment
rules, inactive-counterparty eligibility, validation, audit and concurrency before
shipping this form. Existing preview overpayment acknowledgment is a consumer need,
not accepted production permission. Until approved/implemented, there is no enabled
production repayment action. No requirement to implement edit/reversal just to add
an append-only actual repayment; their separate O11 gate stays closed.

Illustrative domain request (abbreviated IDs, not executable GraphQL):
`recordRepayment(groupId:T, key:K, sender:T.B, recipient:T.A, amountMinor:"2000", currency:USD, effectiveDate:"2026-09-30", note:"")`.
The verified creator is server-derived. Require distinct same-group identities,
positive exact bounded amount and the future approved settlement permissions.
One transaction serializes through the existing group write protocol and atomically
writes one actual settlement, equal/opposite balance effect, audit, financial
revision and recoverable outcome. No synthetic second settlement in H or intermediary
payment. Reuse the group ledger/simplifier and #76 operation infrastructure.

Before first submit generate K; freeze viewer/group/operation kind/key/canonical
payload while pending or unknown. Persist via approved tab-scoped sessionStorage,
cleared on logout/account change. Key scope is actor + explicit group + operation
kind; same-key same-input has one effect, changed input conflicts. Retain durable
operation records with financial history as approved P2; no expiry/tombstone rule.
The settlement follow-up must extend reviewed result types, not claim #76 already
has a repayment endpoint.

Lost-response example: T saves the B→A payment, but the dashboard receives no reply.
Navigate to H, then Resume: lookup remains (T,K,RECORD_REPAYMENT) under the original
actor. COMPLETED identifies the original settlement; fresh T/dashboard reads show
current balances. NOT_OBSERVED never proves noncommit: only the identical key/input
may be retried after fresh authorization. PENDING/UNKNOWN/unavailable retain the
frozen attempt; denial blocks lookup/write and hides fields. Reopening the row
resumes its unresolved attempt instead of minting K2. Concurrent same-key requests
and restart produce one record. Switching groups, counterparties or entry points
cannot modify an unresolved attempt. A definitive rejection permits a corrected
new attempt under the reviewed settlement rules; never after an uncertain result.

Original source focus/visit is UI metadata, not financial scope. A late completion
cannot navigate away from a newer page or display another actor's notice. If
storage/key is lost after logout/tab loss, inspect authorized history and warn of a
possibly completed payment; never automatically infer failure or recreate by amount.
Future authenticated access loss does not grant privileged receipt access.

## Navigation, accessibility and consumer migration

Use distinct “Household ledger” and “Household dashboard” links; group rows open
canonical #85 group routes. Dashboard is not the default #83 entry or a replacement
for Groups. Desktop uses an accessible labelled dialog for the shared repayment
form; phone uses its full-page route. Back/Escape preserves drafts, restores source
filter/scroll and logical row-action focus only after a fresh authorized read.
If that row disappeared, focus dashboard heading; if dashboard access disappeared,
fall back to Groups and its heading. Direct repayment links fall back to the original
accessible group, otherwise Groups. Never a household fallback for another group.

Dialog contains focus, initially focuses its heading/first field, and restores the
trigger on close. Error summary focuses invalid input; changes to an allowed amount
or balance invalidate any required acknowledgment. Explicit Save confirms the named
group/people/amount; uncertain form locks fields and focuses “Check repayment status”.
Use polite status announcements for refresh/save, no background focus theft, semantic
headings and labelled amounts with currency/direction, no color-only debt status.
Verify keyboard-only, screen-reader names, 320px width and 200% text with wrapping
names/amounts and vertical scroll. This document does not claim a live browser test.

| Existing consumer inspected                                                 | Required future adaptation                                                                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/data/port.ts`, `components/data-provider.tsx`                          | Whole-household Snapshot and embedded trips cannot become the dashboard adapter. Use authorized complete server projections, scope guards and separate group caches.                 |
| `lib/overview.ts`, `components/overview.tsx`                                | Replace unsimplified direct-obligation claims with #76 projection; distinguish ledger view from consolidated cards and include explicit people/group provenance.                     |
| `lib/trip-detail.ts`, `components/trips/destination.tsx` and `overview.tsx` | Household-filtered trip spending is historical preview. Real trip is a group; remove household repayment shortcut, keep spending separate from balances and repayments.              |
| `components/repayment/form.tsx`, `lib/repayment-draft.ts`                   | Shared explicit-group form; full current simplified obligation context, exact bigint values and gated production validation. No implicit two-person household default across groups. |
| `components/session-command.tsx`                                            | Preserve frozen identity/recovery/source lifetime; replace current-household envelope capture and global new-repayment draft identity with original-group/attempt scoping.           |
| `components/navigation/provider.tsx`, `links.tsx`, household/recovery docs  | Preserve source visits/focus/generation handling; canonical group routes, no lost-access cache or household fallback. Preview membership guards remain historical.                   |

Keep existing seeded UI/tests and its historical documentation intact. Follow-on
[delivery slices](../proposals/household-dashboard-slices.md) own implementation,
acceptance tests and browser evidence; no migration, SDL, resolver or UI changes here.
