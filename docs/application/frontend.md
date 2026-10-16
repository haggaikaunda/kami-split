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

## Component reads and query lifetime

Server-backed screen fields belong to a retained Relay query and masked child
fragments. `groups/discovery.tsx` composes `discoveryCard`; `GroupWorkspace` consumes
`workspaceGroup`; Household summary content consumes `householdContentDashboard`;
and current expense detail consumes `expenseDetailExpense`. Pass the generated
`$key` reference to those owners and let `useFragment` subscribe to the selected
fields. The route validates canonical Group identity and passes a narrowly typed
`identity` prop beside the workspace fragment reference; this avoids repeating
route-owned identity fields in the wire operation's finite complexity budget.
Shared financial presentation receives ordinary, exact-value props and can
still render in the gallery without a Relay provider.

`NetworkQuery` is the common read boundary: an effect calls `loadQuery` with
`network-only` by default (eligible read-only workspace callers explicitly opt into
`store-or-network`), the child reads through `usePreloadedQuery`, and effect cleanup
calls the reference's public `dispose()`. The effect owns that reference immediately,
even when an access event removes the component before its reference reaches render.
Disposal releases retention and cancels pending transport; completion alone does not
grant server authorization. Eligible navigation reuse is bounded by the account
store’s 30-second expiry and explicit invalidation. This explicit ownership also covers
React Strict Mode setup/cleanup. Loading uses Suspense, transport/render failures use
the local error boundary, and feature owners inspect domain unions and report their
loading/error status to the existing refresh surface. A fulfilled access Problem is
an error, never an empty result or successful refresh.

Each read owner defines its keyed identity: account, destination, source return,
ledger filters and explicit refresh generation. A composed workspace query keeps
its original variables while URL filters change. Its initial expense payload may
seed the ledger only when the query reference's captured filters match the current
canonical filters; otherwise the ledger performs a dedicated fresh read. Foreground invalidation hides the private
owner synchronously, then starts a new read after the event burst. An eligible read-only visit can reuse a complete, unexpired operation; missing,
expired or invalidated operations require a response. Group identity,
Household source identity and current expense group/record identity are checked
before rendering. Query errors and access denials retain the existing safe copy,
recovery and navigation affordances. Panel-only URL changes preserve the active
ledger traversal and durable draft; they must not accidentally restart the screen.
See [authorized loading](../navigation/workspace-loading.md) for the request matrix,
route prefetching, cancellation and context-version contract.

Keep server objects out of local state when their only purpose is rendering.
Local state may retain the query reference, request status, selected IDs, edit state,
or user input. For example, Activity detail stores event/group/record IDs while its
fresh query owns the event payload. Discovery/group results and Household summaries
are derived from their live query/fragment, rather than copied into another state
variable. A component can combine these responsibilities when its lifecycle is
cohesive; extraction should make an owner explicit, not build a generic controller
framework.

## Financial identity and deliberate snapshots

Current `Expense` records retain stable public Node IDs and fresh authorized
`node(id:)` lookup. Anchored lists select `snapshot` (aliased to `node` by the client)
with the stable navigation `expenseId`. `ExpenseSnapshot.id` isolates each saved
financial version, including allocations. `ExpenseView.id` and
`ExpenseConnection.id` isolate exact anchored pages so partial writes cannot merge
new rows with old unselected aggregates. They are non-Node cache identities, not
permissions, cursors or a replacement for `contextVersion`. Current authorized
Membership labels remain metadata; GroupSummary and ActivityIdentity navigation IDs
are type-scoped by the environment to avoid aliasing actual Group/Membership records.
See [expense editing](expense-editing.md#client-financial-identity) for the complete
contract and compatible schema deployment order.

Several imperative reads remain intentional because their result is a user-owned
baseline or an immutable traversal, rather than a live entity projection:

| Owner                                              | Retained state and reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expenses/ledger.tsx` and `expenses/household.tsx` | An authorized signed traversal accumulates immutable request pages with one financial anchor, complete server totals, URL filter identity and Household context token. The initial composed Household result is revealed only when both context tokens match. Later-page transport failure retains already authorized pages for explicit retry; access/context failure invalidates the owner. A new same-argument store write must not splice a fresh first page into old continuation rows. `@inline` reads deliberately capture these pages. |
| `activity/feed.tsx`                                | Immutable historical pages use the signed traversal and current-scope checks. Selection retains only IDs; historical detail is a separate disposable query. A current Expense never substitutes for an event's before/after values.                                                                                                                                                                                                                                                                                                            |
| `groups/expense-edit.tsx`                          | The opened financial/member baseline, persisted draft, expected version and original attempt remain fixed. Background normalized updates cannot change dirty comparison or replace the draft. Only explicit conflict reload and reapplication adopt a new baseline. The reload has its own complete `expenseEditCurrentQuery`.                                                                                                                                                                                                                 |
| Expense/create, repayment and group-creation forms | `commitMutation` and recovery reads preserve the persisted original operation key and frozen input across uncertain results. A canceled UI visit cannot imply server rollback. Recovery and a separately authorized post-commit refresh remain distinct.                                                                                                                                                                                                                                                                                       |
| Account profile and appearance editors             | Compare-and-set saved scalars and user intent are reconciliation baselines. A live profile update must not silently advance `expectedDisplayName` behind an unfinished draft. Profile retains the saved name rather than a duplicate full Profile object. Appearance keeps serialized optimistic preference intent and confirmed value.                                                                                                                                                                                                        |
| `AppearanceProvider`                               | Its imperative profile read applies a DOM theme side effect scoped to the account. It does not provide a second rendered profile store.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Onboarding/invitation controllers                  | Request epochs cover sign-in, provisioning and invitation recovery outside the admitted financial workspace lifecycle. Their feature-owned raw operations retain the existing Auth/session and same-attempt contracts.                                                                                                                                                                                                                                                                                                                         |

Do not introduce Relay pagination solely for API uniformity. It must preserve the
signed page/anchor, complete totals and current access contract before replacing the
explicit traversal owner. Do not infer balances, month/category totals or settlement
from loaded rows, or optimistically declare a financial mutation committed. A
successful mutation and a failed follow-up refresh are separate facts.

## Verification choices

Use the generated operations and real account normalization in read-lifecycle tests.
Cover bounded complete-data reuse, incomplete/expired/invalidated data requiring a
fresh response, denial eviction and delayed work after account/visit
replacement, early invalidation during request startup, cancellation, retention and
Strict Mode. Fragment tests should show a normalized record update reaching its
consumer without a copied result. Financial identity tests cover both write orders,
same-response type overlap, nested allocations and partial same-argument writes;
ledger tests retain signed paging, exact totals, Household context checks and failed
continuation behavior. Preserve the existing draft, duplicate, conflict and
same-attempt recovery regressions when changing read ownership.

Run compiler generation/drift, type, lint, unit and production build checks, then the
required browser journeys and affected rendered interactions. Synthetic store and
browser fixtures verify their client contracts; API/database tests separately prove
current authorization and persistence. Architecture and cohesion remain review
judgments, not file-size rules or source-pattern tests.

## Styling and shared presentation

Use colocated CSS Modules for component-owned presentation. `app/tokens.css` owns global theme values and `app/base.css` owns intentional document defaults; components import their own styles. Neutral UI lives in `components/ui/primitives`, reusable workspace patterns in `components/workspace/patterns`, application chrome in `components/workspace/shell.module.css`, and exact financial presentation in `components/financial/presentation`. Shared presentation accepts ordinary props and does not fetch data. Native form defaults are an explicit `ui/form-layout.module.css` scope with control slots; category presentation lives in `financial/category`. Every production feature stylesheet is colocated; the UI guide maps the owners and documented variants.

Prefer a component's public variant or caller-owned root class. Existing compositional layouts use the documented `data-ui` slots; never depend on a generated class name or another component's private child tags. The root layout anchors the shared module imports before route sheets; preserve that order, import shared components before feature customization styles and verify a production build with direct loads and route-order transitions, since Next may retain and merge CSS chunks. See the [UI guide](ui.md) for token roles, the slot contract, responsive thresholds, safe areas and enlarged-text behavior; use the [executable gallery](../primitives-preview/README.md) to inspect shared states.
