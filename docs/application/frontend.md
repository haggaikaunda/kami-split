# Frontend ownership

The production application uses one account-scoped Relay environment, feature-owned
GraphQL documents and React presentation. The [expense journey](relay-expenses.md),
[authorized loading contract](../navigation/workspace-loading.md) and feature guides
remain authoritative for financial and navigation behavior.

## Operations and generated source

Keep authored `graphql` documents adjacent to the component or feature that owns
the read or command, using `<operation stem>.graphql.ts`. A shared projection belongs
beside its consumers; shared transport, exact-money helpers and durable draft
protocols remain under `lib`. Invitation operations belong to the onboarding feature,
including its raw requests before a financial session exists.

`apps/web/relay.config.json` discovers documents throughout `src`; the pinned
compiler writes checked-in artifacts to `src/lib/relay/__generated__`. Application
modules import those artifacts directly. Authored document files are compiler input,
so Next and Vitest need no runtime `graphql` or Babel transform. Preserve operation
names and regenerate with `pnpm relay:generate`; verify with `pnpm relay:check`.
Do not hand-edit generated types or wire operations. Schema changes belong to the
authoritative SDL in `packages/schema`, with API generation and wire validation.

## Account and interaction ownership

`FinancialSession` exposes its existing environment through `RelayEnvironmentProvider`,
keyed by the financial account scope. It owns store replacement and disposal. Never
create a second application store in a component, a server-rendered private store
or a module singleton. Current token lookup, access checks and request cancellation
remain in the account transport; a cached record is never proof of fresh access.

URLs own route, tab, filter and selected-record identity. React owns open panels,
loading/error status and in-progress interaction. Durable financial drafts and frozen
operation inputs retain their existing actor/group/operation storage and recovery
protocols. Shared presentation accepts explicit ordinary props and does not own
application reads or operation recovery.

`ExpenseEntryProvider` scopes the banner-to-ledger handoff to the current account and
workspace visit. Its typed callback passes the authorized source and logical focus
identifier so the mounted ledger can record return geometry for its current signed
traversal. The ledger checks source membership; a removed ledger unregisters. Normal
link navigation still owns the destination, and modified clicks retain native browser
behavior. Components must not rediscover this relationship through document-level
click listeners, DOM IDs or selectors.

## Styling and shared presentation

Use colocated CSS Modules for component-owned presentation. `app/tokens.css` owns global theme values and `app/base.css` owns intentional document defaults; components import their own styles. Neutral UI lives in `components/ui/primitives`, reusable workspace patterns in `components/workspace/patterns`, application chrome in `components/workspace/shell.module.css`, and exact financial presentation in `components/financial/presentation`. Shared presentation accepts ordinary props and does not fetch data.

Prefer a component's public variant or caller-owned root class. Existing compositional layouts use the documented `data-ui` slots; never depend on a generated class name or another component's private child tags. The root layout anchors the shared module imports before route sheets; preserve that order, import shared components before feature customization styles and verify a production build with direct loads and route-order transitions, since Next may retain and merge CSS chunks. See the [UI guide](ui.md) for token roles, the slot contract, responsive thresholds, safe areas and enlarged-text behavior; use the [executable gallery](../primitives-preview/README.md) to inspect shared states.
