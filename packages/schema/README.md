# GraphQL contract

`schema.graphql` is the authoritative SDL for the Go + gqlgen backend. It currently exposes only `health { status }`; no financial or authenticated operations exist.

Run `make api-generate` from root to regenerate committed API execution/model code using the pinned gqlgen tool. CI rejects generation drift. The future Relay compiler will consume this same contract; Relay is not installed yet.

Schema additions require approved acceptance criteria and compatibility review. Existing TypeScript money logic and DataPort remain in `apps/web`; future Go services own server financial rules. Language-neutral test fixtures may be shared when implemented.
