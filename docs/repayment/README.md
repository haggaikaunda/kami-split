# Repayment recording

> Historical seeded-preview evidence only. The executable preview, its routes, providers and tests were retired in #184. This document does not require their preservation or describe current production capabilities. Current behavior is documented in the [application guide](../application/README.md).

## Accepted production direction

The household-only flow below is preserved seeded-preview behavior. The [persisted group repayment API and authenticated workspace](../application/persisted-repayments.md) implement real group-local recording under #110/#171; their partial/overpayment contract and frozen recovery are independent of the preview acknowledgment policy. Under [ADR-003](../application/decisions/003-bootstrap-groups-and-invitations.md#b3-household-dashboard-and-group-specific-repayment), every future settlement belongs to exactly one group, including a trip group. A dashboard shortcut opens that original group’s repayment form without a Household copy, cross-group netting or an overall debt to settle. Group-specific shortcut design is #86; settlement implementation remains outside #73. The preview’s lack of trip assignment is not a production prohibition on settling trip-group obligations.

[ADR-004 C1](../application/decisions/004-group-balances-membership-and-recovery.md#c1-automatic-simplification-within-one-group-and-currency) automatically simplifies the production plan within one group/currency: A owing B 20 and B owing C 20 USD becomes A owing C 20. Record one actual A → C transfer in that group, with no fake intermediary payments. Original expense history stays intact and is not another debt list. No money is moved by recording it. A same-group cycle with every individual net zero requires no repayment; a mere sum of zero does not prove settlement. Production balances and repayment recording implement this contract; the form below still uses the preview’s original direct debts.

## Seeded preview

Issue #23 implements S01/N06 through the replaceable session data port. The form records money already repaid; no money moves, no payment method is collected, and no repayment is assigned to a trip.

For two active members, the form defaults to the outstanding direct debt and its named sender/recipient. A settled pair has no invented amount. Groups require explicit members. Integer minor units drive before/after previews; an opposite-direction balance requires acknowledgment. Changing fields resets acknowledgment, and a changed confirmed balance invalidates a previous acknowledgment.

The session command provider is shared with expense creation through a compatible wrapper. It freezes the command and operation ID on an uncertain outcome, checks that same operation before retrying, and retains pending drafts through navigation. Actor/session checks prevent retrying a previous actor's command. Provider-owned operation leases block simulation reset while a result is pending or unknown; a successful reset clears old command notices and attempts. Success notices belong to the originating actor and household. A request completing after navigation never pulls the user away from their newer page.

Contextual links retain independent source visits, filters, scroll and focus. Explicit leave and Escape preserve an unsaved draft; the shared Resume/Discard controls provide safe discard confirmation. Save returns to the source with refreshed data. Read-only repayment detail is available through `RepaymentLink` for History integration and the overview's recent activity. Direct detail falls back to History. A route alias under `/drafts/new-repayment` supports resumed drafts.

## Verification

- Pure draft tests cover pair/group/settled defaults, partial/exact/overpayment, opposite-direction acknowledgment, zero/invalid money, same-member denial, invalid dates, and unchanged expense spending/contributions.
- Form/port tests cover saving the default full amount once, invalidating acknowledgment after edits, and timeout-after-commit with form unmount and recovery without duplicate execution.
- Existing independent expense concurrency/session/recovery assertions remain in place for the shared provider extraction.
- At issue #23 acceptance, formatting, lint, type checking, 158 tests and production build passed. This is a historical acceptance count, not the current suite total.

The adapter is deterministic and session-only. These UI access simulations are not a production authorization guarantee. No durable persistence, payment processing, repayment edit/delete or bank integration is included.

## Live browser verification

Root independently verified the 1280px desktop flow: defaults Kaunda → Mizenin 42.18 USD; 50.00 previews Mizenin owing Kaunda 7.82 USD; unacknowledged submission is blocked and focuses the acknowledgment. After acknowledgment and save, Overview shows the reversed 7.82 USD debt, unchanged spending 5,126.56 USD and contributions 2,496.10 / 2,630.46 USD, and one 50.00 USD repayment event. Focus returns to Record repayment. View repayment opens the correct read-only record.

The 390px form fits the phone viewport. At 320px, document width is 320px, dialog width 318px and date field width 286px; controls remain readable without horizontal overflow.

At 320px and 200% text (32px root size), the document remains 320px wide, the dialog 318px and date field 286px. The complete 09/20/2026 date remains readable and keyboard-focusable with vertical scrolling. Returning from read-only repayment detail restores the Overview's saved View repayment link focus. Root's final-diff review found no blocking issues.

Independent requirements testing adds six integration probes: explicit/distinct group selection and invalid amount, partial repayment with unchanged spending, reacknowledgment after a changed balance, denied fields with retained draft, read-only detail with expired access, and timeout recovery with actor switching and reset leases. The uncertain-operation probe confirms the other actor cannot perform a lookup or write; restoring the original actor confirms one repayment without duplicate execution, then reset clears its notice. No substantive findings remained.
