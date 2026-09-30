# GraphQL contract

`schema.graphql` and `expenses.graphql` are the authoritative SDL for the Go + gqlgen backend. They expose public health plus authenticated viewer/group/member reads, paginated expenses, complete balances, expense creation and same-attempt recovery. See [persisted expenses](../../docs/application/persisted-expenses.md) for exact-money, authorization, recovery and pagination semantics.

Run `make api-generate` from root to regenerate committed API execution/model code using the pinned gqlgen tool. CI rejects generation drift. The future Relay compiler will consume this same contract; Relay is not installed yet.

Schema additions require approved acceptance criteria and compatibility review. Existing TypeScript money logic and DataPort remain in `apps/web`; Go application operations own persisted financial rules. Language-neutral test fixtures may be shared when implemented.

## Public contract documentation

Use GraphQL descriptions (`"""..."""`) for every handwritten public schema type, field, argument, input field, enum and enum value, interface, union, and scalar, including query and mutation fields and their arguments. Generated schema is exempt where applicable; update its source and regenerate instead of editing generated output. Descriptions are part of the introspectable contract; `#` comments do not replace them.

Explain caller-visible semantics rather than repeating names or syntax. Where relevant, describe authorization and visibility, nullability and distinct states, money units and representation, pagination behavior, lifecycle semantics, and other non-obvious behavior. Keep descriptions proportional to the contract; do not invent guarantees or add irrelevant boilerplate.
