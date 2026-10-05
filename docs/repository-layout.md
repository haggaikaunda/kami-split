# Repository layout and deployment

The monorepo separates the authenticated Next.js application from the Go API and shared GraphQL contract. The API implements verified authentication, persisted expenses and balances, and internal targeted invitation operations. The web connects [onboarding](application/onboarding.md) (#80) and the [Relay expense journey](application/relay-expenses.md) (#83) to configured services; the retired seeded runtime has no production routes or imports.

| Location                               | Ownership                                                                                                                                                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                             | Next.js source, colocated tests, dependencies, Next.js/TypeScript/Vitest configuration and generated `.next` output. The `@/*` alias resolves to its `src/*`. Future public assets belong in `apps/web/public`; there were no tracked public assets at migration time. |
| `apps/api`                             | Independently buildable Go + gqlgen API with verified identity, persisted expenses/balances and internal invitations; owns its Go module/toolchain and Dockerfile.                                                                                                     |
| `packages/schema`                      | Authoritative SDL-first GraphQL health, identity and expense contract for gqlgen and the first authenticated Relay expense journey.                                                                                                                                    |
| `docs`, `.github`, `AGENTS.md`         | Repository documentation, automation and delivery policy.                                                                                                                                                                                                              |
| Root package/workspace/lockfile        | JavaScript workspace membership, pinned package manager/runtime, repository tooling and convenient commands. Go dependencies will not use pnpm.                                                                                                                        |
| Root ESLint and Prettier configuration | Repository-wide linting/formatting, including executable documentation; generated workspace output is ignored. Next.js lint rules target `apps/web`.                                                                                                                   |
| `tsconfig.docs.json`                   | Type checking for executable documentation, extending the web compiler options. Root React/type dependencies support the standalone primitives gallery.                                                                                                                |

Install from the repository root with `pnpm install --frozen-lockfile`; the root `pnpm-lock.yaml` is the only committed lockfile. Application runtime dependencies belong to `apps/web/package.json`. Do not copy the app into a separate installation context or create nested lockfiles.

Root `pnpm dev`, `pnpm start`, `pnpm build`, `pnpm test` and `pnpm test:watch` forward to `@kami-split/web`. Arguments are forwarded too: `pnpm dev --hostname 0.0.0.0 --port 4200` and `pnpm start --hostname 0.0.0.0 --port 4200`. Test file arguments are relative to `apps/web`, for example `pnpm test src/lib/ledger.test.ts`. `pnpm format` and `pnpm format:check` cover the repository; `pnpm lint` covers application and root executable files; `pnpm typecheck` checks both the app and documentation. CI retains the complete root verification sequence and required **Verify** identity, caching against the root lockfile.

The primitives gallery remains in `docs/primitives-preview` and imports components/styles from `apps/web/src`. Historical design reports retain their at-the-time paths and results; current guides and executable references use the new paths.

## Deployment configuration

Issue [#140](https://github.com/haggaikaunda/kami-split/issues/140) approves
Vercel for the web application, Cloud Run for the Go API, hosted Supabase, and a
serialized GitHub Actions production deployment after the existing CI gate. The
[production deployment configuration](application/production-deployment.md)
defines resource names, provisioned Google Cloud foundations, configuration
ownership, completed provider setup, and first-deployment operating procedures.
It does not claim that production is already serving traffic.

For any externally managed web hosting project, the owner must update its application/root-directory setting from the repository root to **`apps/web`** before its next deployment. Keep the entire repository available as the workspace installation/build context, including the root package manifest, `pnpm-workspace.yaml` and lockfile. Enable access to files outside the application directory if the host requires that setting.

- Runtime: Node 24; package manager: pnpm 11.25.0, unchanged.
- Install from repository root: `pnpm install --frozen-lockfile` (from `apps/web`, use `cd ../.. && pnpm install --frozen-lockfile`).
- Build from repository root: `pnpm build`; from application root: `pnpm build`.
- Start from repository root: `pnpm start --hostname 0.0.0.0 --port 4200`; from application root: the same command. Replace 4200 with the host's assigned port.
- Build output: `apps/web/.next` relative to the repository, or `.next` relative to the application root. Use the host's Next.js runtime support; this is not a static export.

Next.js tracing and Turbopack roots explicitly point to the repository so workspace dependencies are available. The Go API has separate root make commands and Docker Compose setup, documented in [API setup](../apps/api/README.md). CI runs Go, generation, actual Supabase migration/permission/race integration, and container/readiness checks alongside the web checks. A successful `main` push calls the serialized production workflow only after the required **Verify** job. Provider configuration is complete; the first live API and Vercel deployments await a reviewed merge to `main`.
