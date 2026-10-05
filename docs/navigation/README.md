# Production navigation and source restoration

The root enters `/groups`. Group and Trip discovery use real authenticated membership reads; every Trip workspace is `/groups/:groupId`, with independent financial and authorization boundaries. Household provides five workspace tabs from `/household`, with its Expenses ledger at `/household/expenses`. Designated creator entry uses `/groups/new` with independent Group/Trip recovery. Account, invitation and Auth routes use real configured services.

`FinancialSession` is the only root financial provider. `ScopedLink`, `SourceReturn` and `RestoreSource` in `components/groups/navigation.tsx` retain actor-scoped visits, filter URLs, scroll and logical focus. Restoration runs only after a fresh authorized source response; missing/ineligible targets fall back to the current heading. Logout/account changes dispose the scope and prevent old responses or source visits from populating another session.

Expense details use `/groups/:groupId/expenses/:expenseId`. Repayment entry uses `/groups/:groupId/repayments/new`. Drafts and uncertain attempts use the existing account/group-scoped sessionStorage contracts, never global preview draft routes. See the [authenticated journey](../application/relay-expenses.md#discovery-and-return-navigation-105).

The seeded global shell, preview providers, intercepting `@detail` slot and its old routes were retired in #184. They are not compatibility routes; unsafe legacy resource IDs receive normal not-found behavior. Original #17 navigation evidence is available in [Git history](https://github.com/haggaikaunda/kami-split/blob/225780b/docs/navigation/README.md) only.
