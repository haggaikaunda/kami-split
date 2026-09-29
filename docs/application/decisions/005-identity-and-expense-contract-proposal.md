# ADR-005: Coordinated identity and expense contract proposal

- Status: **Proposed**, not accepted or implemented.
- Recorded: 2026-09-29.
- Scope: Design-only engineering handoff for #75/#76.
- Relationship: Elaborates ADR-001–004 without superseding accepted policy.

The [coordinated proposal](../proposals/first-expense/README.md) defines shared
stable identities, disclosure and transaction locking; concrete user/group/
membership constraints and RLS boundaries; proposed business SDL, operations,
exact money, pagination, complete balances and same-attempt recovery.

The [gate matrix and owner decision sheet](../proposals/first-expense/gates.md)
separates delegated engineering recommendations from P1 profile fields, P2 receipt
retention, P3 client storage/lifetime and P4 first real UI scope. Those choices
remain proposed until explicitly approved. [Validation evidence](../proposals/first-expense/validation.md)
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
