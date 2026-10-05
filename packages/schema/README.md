# GraphQL contract

`schema.graphql`, `expenses.graphql`, `repayments.graphql`, `groups.graphql`, `household.graphql`, `financial-activity.graphql` and `onboarding.graphql` are the authoritative SDL for the Go + gqlgen backend. They expose [targeted onboarding](../../docs/application/onboarding.md), public health, authorized group/member reads, expenses and complete balances, actual group repayments and history, and ordinary/trip group creation. Financial and group-creation operations support same-attempt recovery. See [persisted expenses](../../docs/application/persisted-expenses.md) and [persisted repayments](../../docs/application/persisted-repayments.md) for money, access, recovery and pagination semantics.

Run `make api-generate` from root to regenerate committed API execution/model code using the pinned gqlgen tool. CI rejects generation drift. Pinned Relay tooling consumes the same authoritative SDL through `pnpm relay:generate`; `pnpm relay:check` verifies committed web artifact drift. The generator resolves server SDL extensions into a complete schema before compilation, so Relay emits executable server operations rather than client-only extension fields. Wire-operation tests validate compiled requests against the authoritative SDL.

Schema additions require approved acceptance criteria and compatibility review. Existing TypeScript money logic and DataPort remain in `apps/web`; Go application operations own persisted financial rules. Language-neutral test fixtures may be shared when implemented.

## Public contract documentation

Use GraphQL descriptions (`"""..."""`) for every handwritten public schema type, field, argument, input field, enum and enum value, interface, union, and scalar, including query and mutation fields and their arguments. Generated schema is exempt where applicable; update its source and regenerate instead of editing generated output. Descriptions are part of the introspectable contract; `#` comments do not replace them.

Explain caller-visible semantics rather than repeating names or syntax. Where relevant, describe authorization and visibility, nullability and distinct states, money units and representation, pagination behavior, lifecycle semantics, and other non-obvious behavior. Keep descriptions proportional to the contract; do not invent guarantees or add irrelevant boilerplate.

## Group creation and discovery

`createGroup` accepts only `operationKey`, `name`, `kind` and optional `trip`.
The verified designated creator is the sole initial owner; currency is USD.
A trip requires Gregorian dates and optional destination (absent/null means empty).
An ordinary group accepts absent/null trip metadata. Names trim only ASCII
space/tab/CR/LF; Unicode scalar limits are 120 for names and 200 for destinations.
Destination whitespace and Unicode normalization are preserved.

`GroupCreationCompleted` identifies the original group, creator membership and
creation timestamp. Fetch `group(id)` separately for fresh labels, metadata and
balances. `GroupCreationRejected` retains domain field errors;
`GroupCreationConflict` means `OPERATION_CONFLICT` and preserves the original
intent. `groupCreationOperation(operationKey)` is self-only and also returns
`GroupCreationNotStarted`: no committed attempt is visible, but an in-flight
request may still commit. Preserve the same key and frozen input after transport
loss or `UNAVAILABLE`; never infer rollback from either state.

Every create/replay/recovery checks current linked, enabled creator authority.
Enabled nondesignated callers receive `FORBIDDEN`; disabled/unprovisioned callers
and inaccessible completed groups receive safe `NOT_FOUND`. Missing verified
credentials and unavailable verification use existing HTTP 401/503 conventions.
Malformed scalars fail before execution and reserve no operation key. Domain
rejections are durable and corrections need a new key. Receipts do not expire.

Viewer groups remain ordered by canonical group ID and filtered by current active
access. `kind` derives from nullable `trip`; `isHousehold` reveals designation
only for an already accessible group. No installation ID or group directory is
exposed. `Viewer.today` is sampled once per response in UTC, including aliases and
node lookups. Clients derive trip status from inclusive dates and this value;
trip dates never restrict expense history or writes. Metadata editing and
classification conversion have no public endpoint.

## Activity

`groupActivity` and `householdActivity` traverse persisted immutable expense-created and repayment-recorded events, ordered by event timestamp, kind and record UUID. Exact amounts and financial effective dates remain distinct from event time. Authenticated cursors bind current actor/workspace, exact filters, eligible sources and source revisions; every page reauthorizes. Household activity uses the same finalized-pair scope as `householdDashboard`, never client group filtering. See [Activity](../../docs/application/activity.md) for browser, detail and failure semantics.

## Household overview

`householdDashboard` discovers the complete currently eligible pair-shared set independently of expense pagination. Source space rows preserve exact complete balances, revision, members, current labels and trip metadata. `COMPLETE` includes checked informational totals; `INCOMPLETE` includes freshly authorized rows and an `AMOUNT_OVERFLOW` totals problem; `UNAVAILABLE` exposes only the authorized Household ledger without totals when sharing is not finalized. A finalized non-partner viewer receives `NOT_FOUND`, including an owner outside the pair. Whole-discovery failure returns `UNAVAILABLE` without rows. Counts use exact canonical `MinorUnits` strings. Zero informational net does not settle independent groups; no aggregate repayment target exists.
