# ADR-004: Group balances, membership lifecycle, and financial recovery

> Seeded-runtime references below are historical evidence. #184 removed the executable preview and simulation-only tests; they must not be retained or restored. Accepted production policy remains authoritative.

- Status: Accepted production policy; this documentation does not implement behavior. Remaining engineering and product decisions stay gated.
- Recorded: 2026-09-29.
- Authority: Owner-approved decisions and documentation-only authorization in [#93](https://github.com/haggaikaunda/kami-split/issues/93).
- Relationship: Partially supersedes the original-direct-obligation departure restriction in [ADR-001 D4](001-backend-foundation.md#d4-identity-and-membership) and its reaffirmation in [ADR-003 B3/B4](003-bootstrap-groups-and-invitations.md#b3-household-dashboard-and-group-specific-repayment). It resolves subsets of O09/O10/O13/O14, without superseding either ADR as a whole or changing ADR-002 authentication/security policy.

## Context, authority, and delivery

[#77](https://github.com/haggaikaunda/kami-split/issues/77) is the completed baseline, delivered by merged [PR #92](https://github.com/haggaikaunda/kami-split/pull/92) and ADR-003. It stays closed. The later approval of automatic simplification within a group reverses the earlier requirement to clear original pairwise obligations even when a member's net is zero. New repayment counterparties must be understood as the current plan, while original expense attribution remains auditable history.

This ADR supplies policy for #75/#76/#79 and downstream work, not automatic readiness of those issues. The API is still health-only and the web app uses a session mock. No algorithm, migration, business SDL, authentication, admission, departure, transfer, repayment or client persistence feature is delivered here. Local database work #74 is unchanged. Transfer #84, group/trip creation #85, reporting #86 and departure/settlement features remain outside #73's first expense milestone.

## C1: Automatic simplification within one group and currency

Derive current repayment obligations from each member's complete net position in **one group and currency**. USD is the only initial production currency. There is no conversion or new multi-currency feature. Using exact minor units, net = expenses paid − allocated shares + repayments sent − repayments received. Negative means owing; positive means being owed. Amounts paid and allocated each reconcile to the expense total; all members' nets sum to zero as an accounting invariant.

Original expense history explains the payer, participants and allocations. The derived repayment plan explains who should pay whom now; counterparties may differ from the original expense relationships. Those original relationships are not another set of debts to clear after simplification. Preserve each person's net, payer/participant attribution, revisions and audit history. Simplification edits no expenses, moves no money, forgives no nonzero net and creates no synthetic repayment or debt-transfer records.

Retain and include historical expense and repayment records in complete balance recomputation after a membership becomes inactive. Removing active access must not omit that person's financial contributions or change anyone else's position. A member is financially settled only when that individual's group net is exactly zero. A group is fully settled only when **every member's individual net is zero**. The sum of nets being zero proves conservation, not settlement. Failed, unavailable or incomplete reads cannot be presented as zero or settled.

Never net across groups, transfer balances across groups automatically, or duplicate records. Household and trip balances remain independent even for the same people. ADR-003's dashboard includes the household plus groups with both partners active; shortcuts record a repayment in its source group, with no household copy. Adding partners' nets together must not hide their separate nonzero obligations.

### Balance and repayment examples

All amounts below are USD in one group unless stated otherwise; nets are shown in cents.

| Scenario                                      | Complete individual nets            | Current policy                                                                                                              |
| --------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A owes B 20; B owes C 20                      | A −2000, B 0, C +2000               | Plan A → C 20. B needs no repayment and financially qualifies to depart before A pays C.                                    |
| B becomes inactive in that chain              | A −2000, B 0, C +2000               | Retain B's membership identity and ledger attribution; recomputation includes history and leaves A/C unchanged.             |
| A actually pays C 20                          | A 0, B 0, C 0                       | Record one A → C repayment in this group. No fictitious A → B or B → C payments. The group is now fully settled.            |
| A owes B 20; B owes C 20; C owes A 20         | A 0, B 0, C 0                       | Same-group cycle is fully settled; no repayment needed despite historical pairwise relationships.                           |
| A owes C 20                                   | A −2000, C +2000; sum 0             | Group is not settled. Both A (owing) and C (being owed) fail the departure financial condition.                             |
| A owes B 10 in Household; B owes A 10 in Trip | A −1000 in Household, +1000 in Trip | Neither group is settled; A's cross-group total of zero permits no cross-group cancellation or departure from either group. |

Rationale: a single current repayment model avoids demanding intermediary payments that do not change a zero-net member's financial position. Consequences: server balances, repayment projections and departure eligibility must share this meaning. UI-only simplification is insufficient. Deterministic matching, tie-breaks, stability after ledger changes, API representation and explanatory UI require reviewed engineering design. No globally minimum repayment count, per-group toggle or specific optimization algorithm is approved.

## C2: Departure, removal, visibility, and readmission

Voluntary departure and owner-initiated removal have the same financial condition: the target member's individual net in the target group must be exactly zero. Original pairwise chains/cycles impose no additional condition. This explicitly supersedes only ADR-001 D4's original-direct-obligation restriction and ADR-003 B3/B4's inherited restriction. The chain's zero-net B need not edit expenses or wait for A → C payment merely to simplify debt.

For a genuinely nonzero net, authorized, valid, auditable expense corrections or recorded actual repayments resolve it before departure, as appropriate. Removal itself never redistributes or writes off balances or erases attribution. Financial eligibility is not removal authority: existing owner/member permissions, enabled-account checks and exactly-one-active-owner protections still apply. An owner transfers ownership before departing. The eventual complete balance check and membership transition must be atomic against competing financial and membership writes; the concrete protocol remains design work.

Inactive members have no group access. Preserve application identity, membership identity and historical financial attribution. Expose only member/profile information authorized group members need to identify people and understand financial records, not blanket account details or a global directory. Exact fields remain for #75/#76 design.

Readmission requires a **new valid invitation** and authorized acceptance. Restore the **same membership identity** as an ordinary member and grant access to the group's full history, including absence-period activity. Former ownership is not restored automatically; separate group-creation permission is not granted by readmission. An old accepted link cannot reactivate membership. Disabled application access remains denied.

For example, after B's valid departure, B cannot read the group, including old records. Reusing B's previously accepted invitation does not reactivate access. A new valid invitation accepted with the required current verified identity and authorization restores B's original membership as an ordinary member; B can then read authorized full group history, including expenses recorded during absence. A disabled B is still denied. If B was formerly owner, that role is not restored.

Rationale: access lifecycle changes must preserve financial continuity without reviving privileges. Consequences: future tests must cover zero/nonzero nets, ownership and account denial, concurrent writes, retained identities/history, and old-link denial. Historical corrections that could reopen balances after valid departure, settlement editing/reversal, account deletion, retention/anonymization, group closure and disputed/unresolvable balances remain separately gated (O11/O12 and related privacy decisions). The preview's stricter correction guard is not a decision on these production policies.

## C3: Same-attempt financial recovery

A lost expense-create response is recovered by continuing the **same attempt with the same idempotency key and original input**. The frontend must possess the key before sending the first write; a key returned only in a lost response cannot support recovery. Key generation, storage, reload/session-change behavior and retention duration remain design choices. This does not approve browser storage or unlimited retention.

Bind recovery to the verified actor, explicit group and operation under the reviewed key scope. The server derives the actor; key possession grants no access. Current authorization governs both retries and receipt reads. Same-key/same-canonical-input retries must have one financial effect, including concurrent requests and restart recovery. Changed-input reuse must neither create nor overwrite the original expense; #76 must define mismatch outcomes and when a corrected/new attempt receives a new key.

Persist expense, allocations, audit and recoverable idempotency result atomically and durably. A process-local response cache is insufficient. An authorized retry after successful commit recovers the original successful financial outcome/expense identity. Recover that immutable operation outcome, then fetch current authorized group balances as needed. An old cached balance is not current, and different GraphQL selections, later state or changed permissions preclude any promise of byte-identical response envelopes.

### Recovery examples and contract obligations

| Scenario                                                                     | Required behavior                                                                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Before submission                                                            | Client already possesses key K and binds the original input to that attempt before sending.                                                            |
| Expense E commits; response is lost                                          | Authorized retry with K and the original input recovers E's original successful outcome; no second expense or audit effect.                            |
| Two concurrent requests with K and the same canonical input; server restarts | Durable atomic recovery yields one financial effect and the same original identity, rather than relying on process memory.                             |
| K is reused with changed amount/participants                                 | Do not create another expense or overwrite E. Exact mismatch response and new-attempt rules await #76.                                                 |
| Actor loses membership or application access before retry/lookup             | Deny under current authorization; possession of K is insufficient.                                                                                     |
| Another expense changes balances after E                                     | Recover E's immutable outcome, then read current authorized balances as needed; do not label E's old summary current.                                  |
| Lookup missing, pending, unknown, not observed, or beyond retention boundary | Later contract must distinguish these safely. Missing is not automatically proof of no commit; never silently generate a new key and risk duplication. |

Rationale: network uncertainty must not become duplicate financial history. Consequences: #76's reviewed contract and #82/#83 implementation/integration need concurrency, restart, input-mismatch, authorization and uncertain-state tests. These requirements are future behavior, not claims about the mock's in-memory receipt map.

## C4: Engineering handoff and remaining decisions

The owner delegated ID encoding, cursor format, scalar parsing, database/aggregate bounds and related engineering choices to a coherent reviewed proposal. Owner review focuses on observable behavior and tradeoffs. Delegation does not waive contract review or decide unchosen product, privacy or retention policies. O08 money details remain open; O13/O14 protocol, transport and client-state choices remain open within C3's accepted requirements. O09/O10 retain schema, admission and profile-field design within C2's policy. See the [decision register](open-decisions.md).

Financial idempotency does not settle email-delivery failure semantics, invitation-token/receipt lifetimes or database/email atomicity. #79/#80 retain those decisions. #93 synchronizes affected issue bodies (#73/#75/#76/#79/#82/#83/#84/#86) with this policy; issue synchronization and documentation merge complete this follow-up, not completion of their later features.

## Delivered preview evidence

[Overview selectors](https://github.com/haggaikaunda/kami-split/blob/225780b/apps/web/src/lib/overview.ts) derive original direct obligations, and the [mock adapter](https://github.com/haggaikaunda/kami-split/blob/225780b/apps/web/src/lib/data/mock.ts) blocks departure for a zero-net intermediary with remaining direct edges. Its correction guard also rejects reopened inactive-member direct obligations. Those are existing seeded-preview/production-policy differences. [DataPort](https://github.com/haggaikaunda/kami-split/blob/225780b/apps/web/src/lib/data/port.ts) and recovery consumers use session-only operation receipts; reload/restart durability is not implemented.

The [overview](../../overview/README.md), [household](../../household/README.md), [repayment](../../repayment/README.md) and [recovery](../../recovery/README.md) guides retain their historical screenshots, test counts and acceptance evidence. This documentation changes no code or tests to make the preview appear to implement the new policy.
