# Application documentation

**Kami Grow** is the frontend product name; repository/package/infrastructure identifiers remain `kami-split`. The application uses configured Supabase Auth and a Go GraphQL API with server authorization. See [local setup](../../README.md#run-locally), [product scope](../product-scope.md) and [repository layout](../repository-layout.md).

## Browser and product contracts

- [Frontend ownership](frontend.md): component-owned operations, account-scoped Relay and explicit interaction boundaries.

- [Web authentication routing](web-auth-routing.md): only sign-in is public; cookie verification, safe continuation, onboarding handoffs and history/session transitions guard every application page.

- [Home Screen installation](home-screen-app.md): shared standalone scope, launch destination, install metadata and iPhone verification.
- [Expense journey](relay-expenses.md): independent Group and Trip workspaces, Household summaries, source-owned writes and account-scoped recovery.
- [Canonical navigation](../navigation/README.md) and [authorized loading](../navigation/workspace-loading.md): `/groups/:id`, `/trips/:id` and original Household `/household/ledger` routes.
- [Expenses ledger](expenses-ledger.md): complete filtered totals, sorting, category Breakdown, paging and restoration.
- [Collaborative editing](expense-editing.md), [Percentage splits](percentage-splits.md), [Activity](activity.md), and [repayments](persisted-repayments.md): exact financial changes and immutable history.
- [Profile and appearance](profile.md), [current UI rules](ui.md) and [date presentation](dates.md).
- [Onboarding](onboarding.md): invitation, confirmation, sessions, recovery and delivery configuration.

## Backend and operations

- [API architecture](api-architecture.md), [verified API identity](authentication-boundary.md), and [identity/membership](identity-foundation.md).
- [Persisted expenses](persisted-expenses.md), [targeted invitations](targeted-invitations.md), and [Household lifecycle](household-designation.md).
- [Local database](database-development.md), [administrative bootstrap](bootstrap.md), and [deployment/rollback](production-deployment.md).
- [Architecture decisions](decisions/README.md) and [open decisions](decisions/open-decisions.md).

Production configuration in the runbook is an approved operating contract, not a fresh provider audit. Vercel-native deployment migration remains [#161](https://github.com/haggaikaunda/kami-split/issues/161). Production operations require separate authorization.

Shared expense deletion, imports, ownership transfer, free-text search and broader Personal/Plaid features remain unimplemented. The internal [private banking storage](banking-storage.md) foundation provides restricted persistence, protected credentials and lifecycle fences. The [enrollment API](banking-enrollment.md) adds actor-bound Link operations, selected-account reads and durable narrow recovery with new enrollment disabled by default; ingestion and browser Link remain separate deliveries. The [planned Personal banking contract](personal-banking.md) and [interface handoff](../design/personal-banking.md) distinguish approved M1 product decisions from the provider capability and live-release gates; delivery status stays on GitHub. The retired seeded runtime must not be restored from old design examples.
