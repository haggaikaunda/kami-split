# Future API

Reserved for an independently buildable and deployable Go + gqlgen backend with its own Go module and toolchain. pnpm manages only the monorepo's JavaScript/TypeScript workspaces, not Go dependencies.

The backend will own server financial rules and use PostgreSQL. The future authoritative SDL-first GraphQL contract will live in [`packages/schema`](../../packages/schema/README.md) and feed gqlgen and the web Relay compiler.

This directory is a placeholder only. Server/module initialization, gqlgen, database access, authentication, migrations and background jobs are deferred to separately approved issues. The current web application retains its DataPort, in-memory mock and TypeScript financial logic; its simulated authorization is not production security.
