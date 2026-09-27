# Future GraphQL contract

Reserved for the checked-in, authoritative SDL-first GraphQL schema shared by the future Go + gqlgen API and the frontend Relay compiler. The schema will define the cross-language API contract; language-neutral test fixtures may also be shared in future work.

No schema, package manifest, code generation or Relay integration is introduced yet. Those require separately approved implementation issues. Existing TypeScript money/ledger logic, fixtures, selectors and DataPort remain inside [`apps/web`](../../apps/web); there is no shared TypeScript domain package. The future Go backend will own server financial rules.
