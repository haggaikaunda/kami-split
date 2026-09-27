# Repository layout and deployment

The monorepo separates the existing Next.js application from the reserved Go API and GraphQL contract. This structural migration preserves the seeded UX, runtime versions and all existing application tests.

| Location                               | Ownership                                                                                                                                                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                             | Next.js source, colocated tests, dependencies, Next.js/TypeScript/Vitest configuration and generated `.next` output. The `@/*` alias resolves to its `src/*`. Future public assets belong in `apps/web/public`; there were no tracked public assets at migration time. |
| `apps/api`                             | Future independently deployed Go + gqlgen application, with its own Go module/toolchain. Currently README only.                                                                                                                                                        |
| `packages/schema`                      | Future authoritative SDL-first GraphQL contract for gqlgen and Relay. Currently README only.                                                                                                                                                                           |
| `docs`, `.github`, `AGENTS.md`         | Repository documentation, automation and delivery policy.                                                                                                                                                                                                              |
| Root package/workspace/lockfile        | JavaScript workspace membership, pinned package manager/runtime, repository tooling and convenient commands. Go dependencies will not use pnpm.                                                                                                                        |
| Root ESLint and Prettier configuration | Repository-wide linting/formatting, including executable documentation; generated workspace output is ignored. Next.js lint rules target `apps/web`.                                                                                                                   |
| `tsconfig.docs.json`                   | Type checking for executable documentation, extending the web compiler options. Root React/type dependencies support the standalone primitives gallery.                                                                                                                |

Install from the repository root with `pnpm install --frozen-lockfile`; the root `pnpm-lock.yaml` is the only committed lockfile. Application runtime dependencies belong to `apps/web/package.json`. Do not copy the app into a separate installation context or create nested lockfiles.

Root `pnpm dev`, `pnpm start`, `pnpm build`, `pnpm test` and `pnpm test:watch` forward to `@kami-split/web`. Arguments are forwarded too: `pnpm dev --hostname 0.0.0.0 --port 4200` and `pnpm start --hostname 0.0.0.0 --port 4200`. Test file arguments are relative to `apps/web`, for example `pnpm test src/lib/ledger.test.ts`. `pnpm format` and `pnpm format:check` cover the repository; `pnpm lint` covers application and root executable files; `pnpm typecheck` checks both the app and documentation. CI retains the complete root verification sequence and required **Verify** identity, caching against the root lockfile.

The primitives gallery remains in `docs/primitives-preview` and imports components/styles from `apps/web/src`. Historical design reports retain their at-the-time paths and results; current guides and executable references use the new paths.

## Deployment configuration

No tracked hosting-provider settings, Dockerfile or deployment manifest existed at migration time. No production deployment or external hosting setting was changed or verified.

For any externally managed web hosting project, the owner must update its application/root-directory setting from the repository root to **`apps/web`** before its next deployment. Keep the entire repository available as the workspace installation/build context, including the root package manifest, `pnpm-workspace.yaml` and lockfile. Enable access to files outside the application directory if the host requires that setting.

- Runtime: Node 24; package manager: pnpm 11.25.0, unchanged.
- Install from repository root: `pnpm install --frozen-lockfile` (from `apps/web`, use `cd ../.. && pnpm install --frozen-lockfile`).
- Build from repository root: `pnpm build`; from application root: `pnpm build`.
- Start from repository root: `pnpm start --hostname 0.0.0.0 --port 4200`; from application root: the same command. Replace 4200 with the host's assigned port.
- Build output: `apps/web/.next` relative to the repository, or `.next` relative to the application root. Use the host's Next.js runtime support; this is not a static export.

Next.js tracing and Turbopack roots explicitly point to the repository so workspace dependencies are available. The future Go API will have separate build/start/deployment commands once implemented; no Go or schema build is part of web CI today.
