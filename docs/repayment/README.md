# Repayment recording

Issue #23 implements S01/N06 through the replaceable session data port. The form records money already repaid; no money moves, no payment method is collected, and no repayment is assigned to a trip.

For two active members, the form defaults to the outstanding direct debt and its named sender/recipient. A settled pair has no invented amount. Groups require explicit members. Integer minor units drive before/after previews; an opposite-direction balance requires acknowledgment. Changing fields resets acknowledgment, and a changed confirmed balance invalidates a previous acknowledgment.

The session command provider is shared with expense creation through a compatible wrapper. It freezes the command and operation ID on an uncertain outcome, checks that same operation before retrying, and retains pending drafts through navigation. Actor/session checks prevent retrying a previous actor's command. Provider-owned operation leases block simulation reset while a result is pending or unknown; a successful reset clears old command notices and attempts. Success notices belong to the originating actor and household. A request completing after navigation never pulls the user away from their newer page.

Contextual links retain independent source visits, filters, scroll and focus. Explicit leave and Escape preserve an unsaved draft; the shared Resume/Discard controls provide safe discard confirmation. Save returns to the source with refreshed data. Read-only repayment detail is available through `RepaymentLink` for History integration and the overview's recent activity. Direct detail falls back to History. A route alias under `/drafts/new-repayment` supports resumed drafts.

## Verification

- Pure draft tests cover pair/group/settled defaults, partial/exact/overpayment, opposite-direction acknowledgment, zero/invalid money, same-member denial, invalid dates, and unchanged expense spending/contributions.
- Form/port tests cover saving the default full amount once, invalidating acknowledgment after edits, and timeout-after-commit with form unmount and recovery without duplicate execution.
- Existing independent expense concurrency/session/recovery assertions remain in place for the shared provider extraction.
- Formatting, lint, type checking, 152 tests and production build pass.

The adapter is deterministic and session-only. These UI access simulations are not a production authorization guarantee. No durable persistence, payment processing, repayment edit/delete or bank integration is included.
