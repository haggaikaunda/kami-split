# GraphQL contract

`schema.graphql` is the authoritative SDL for the Go + gqlgen backend. It currently exposes only `health { status }`; no financial or authenticated operations exist.

Run `make api-generate` from root to regenerate committed API execution/model code using the pinned gqlgen tool. CI rejects generation drift. The future Relay compiler will consume this same contract; Relay is not installed yet.

Schema additions require approved acceptance criteria and compatibility review. Existing TypeScript money logic and DataPort remain in `apps/web`; future Go services own server financial rules. Language-neutral test fixtures may be shared when implemented.

## Public contract documentation

Use GraphQL descriptions (`"""..."""`) for every handwritten public schema type, field, argument, input field, enum and enum value, interface, union, and scalar, including query and mutation fields and their arguments. Generated schema is exempt where applicable; update its source and regenerate instead of editing generated output. Descriptions are part of the introspectable contract; `#` comments do not replace them.

Explain caller-visible semantics rather than repeating names or syntax. Where relevant, describe authorization and visibility, nullability and distinct states, money units and representation, pagination behavior, lifecycle semantics, and other non-obvious behavior. Keep descriptions proportional to the contract; do not invent guarantees or add irrelevant boilerplate.
