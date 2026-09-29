# ADR-005: Coordinated identity and expense contract proposal

- Status: **Design/proposal record**; P1/P3/P4 owner-approved, engineering handoff reviewed, #76 final acceptance/P2 deferred. Not implemented.
- Recorded: 2026-09-29.
- Scope: Design-only engineering handoff for #75/#76.
- Relationship: Elaborates ADR-001–004 without superseding accepted policy.

The [coordinated proposal](../proposals/first-expense/README.md) defines shared
stable identities, disclosure and transaction locking; concrete user/group/
membership constraints and RLS boundaries; proposed business SDL, operations,
exact money, pagination, complete balances and same-attempt recovery.

The [gate matrix and owner decision sheet](../proposals/first-expense/gates.md)
separates delegated engineering recommendations from P1 profile fields, P2 receipt
retention, P3 client storage/lifetime and P4 first real UI scope. On 2026-09-29 the owner approved P1, P3 and P4 and explicitly deferred P2
(receipt retention) in the PR #95 design conversation. The engineering package
remains proposed pending final contract acceptance; the deferred retention gate
does not waive atomic financial recovery. [Validation evidence](../proposals/first-expense/validation.md)
distinguishes schema shape checks from future runtime acceptance.

O04/O08/O09/O13/O14 and minimal O18 now have concrete proposals, not automatic
resolution. O03/O10/O11/O12 retain the explicitly scoped lifecycle/admission gaps.
Newer #79/#80 invitation approvals are linked in the proposal and inform its
admission boundary; this ADR does not finalize their invitation service contract.

Do not close #75 from documentation or start its schema implementation as part
of this handoff. #76 remains open pending contract/owner approval gates. Running
`packages/schema` remains health-only; #82 promotes only approved implemented
fields. Future acceptance should preserve this proposal's history and record
which decisions were accepted or amended, with issue/PR authority.

## Adoption without closing implementation issues

Following [the owner follow-up review](https://github.com/haggaikaunda/kami-split/pull/95#pullrequestreview-5359720753),
recommend adopting this coordinated record in PR #95 after its normal merge
gates. This makes the reviewed #75 foundation available for its next separate
implementation slice without waiting for #76's P2 receipt-retention decision.
It does not accept the 90-day recommendation, publish business SDL, satisfy
implementation tests, or close #75/#76. See the [explicit readiness strategy](../proposals/first-expense/gates.md#pr-adoption-and-readiness-strategy).

The tested Auth-reference DDL path remains local proposal/evidence: #75 must
verify final ownership/ACLs and full migration behavior, and deployment must
verify its actual hosted credentials. Adoption does not make that experiment a
universal hosted guarantee. No #75 implementation is authorized by this follow-up.
