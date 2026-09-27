# Repayment recording

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
