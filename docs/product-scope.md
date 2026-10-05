# Product scope

The current application uses configured Auth and server-authorized Relay/GraphQL reads and writes. Independent Group and Trip workspaces provide Overview, Expenses, Balances, Activity and Members. Household summaries and cross-space expenses retain original group provenance and authorization. Expenses support exact equal/custom splits, persisted creation and original-attempt recovery; append-only group repayments use explicit group and counterparty context.

Expense editing/deletion, group-creation forms, ownership transfer, imports, free-text search and couple-spending/average/history formulas remain deferred. The UI does not simulate these capabilities. Repayment recording records a financial event; it does not move money.

The seeded application was retired in #184, including embedded Household trips, local role/setup commands, global financial routes and authoritative client snapshots. Its [design archive](design/README.md) and feature evidence are historical only. They are not production policy or instructions to preserve removed runtime code/tests.

See [current application documentation](application/README.md), [API architecture](application/api-architecture.md), and the accepted [decisions](application/decisions/README.md). Trips remain separate ledgers: trip membership grants no Household access, and neither summaries nor net totals settle obligations across groups.
