# Kami Grow

Kami Grow shares expenses through real authenticated Group, Trip and Household workspaces. Relay/GraphQL reads and writes use the Go API for authorization, exact balances, persisted expenses, group repayments and recovery. Trips are independent groups; Household summaries retain each original financial boundary.

The frontend product name is **Kami Grow**. Repository, package, API module, storage and infrastructure identifiers remain `kami-split` for compatibility. Original design inputs may retain the earlier Kami Split name.

The seeded application was retired in #184. Its requirements and delivery history live on GitHub. See the [documentation index](docs/README.md) for current behavior and verification.

## Repository layout

The Next.js application lives in `apps/web`; its single authenticated runtime uses Relay and configured onboarding services. `apps/api` implements verified authentication, persisted expense creation/recovery, authorized reads and complete balances in Go + gqlgen; `packages/schema` owns the SDL-first contract. Internal targeted invitation, admission and delivery-recovery operations are implemented. [Targeted onboarding](docs/application/onboarding.md) connects Supabase, email and browser entry; [authenticated group expenses](docs/application/relay-expenses.md) now use Relay at `/groups`; [collaborative expense editing](docs/application/expense-editing.md) and group repayments are implemented; deletion and imports are deferred. See the [API README](apps/api/README.md) for Docker Compose and native Go commands, [database development](docs/application/database-development.md) for local Supabase and restricted-role verification, and [repository layout and deployment](docs/repository-layout.md) for configuration ownership. Documentation and automation remain at the root.

## Run locally

Run commands from the repository root. Requirements: Node.js **24** and pnpm **11**; `package.json` pins the package-manager version.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Configure Auth/API prerequisites in `apps/web/.env.example` and follow [onboarding setup](docs/application/onboarding.md) and [local API/database setup](docs/application/database-development.md). The UI needs a configured authenticated account and authorized membership to load financial data; `pnpm dev` alone does not provision them.

Open `http://localhost:3000`. For a production-build preview:

```bash
pnpm build
pnpm start --hostname 127.0.0.1 --port 4200
```

Open `http://127.0.0.1:4200`. Stop a running production preview before rebuilding it, then restart and reload to avoid stale assets.

## Preview on a phone

```bash
pnpm build
pnpm start --hostname 0.0.0.0 --port 4200
```

Connect the phone to the same Wi-Fi and open `http://<your-computer-LAN-IP>:4200`. On macOS, `ipconfig getifaddr en0` usually shows the Wi-Fi address; use the active interface if Wi-Fi is elsewhere. Keep the computer awake. Stop any existing server using port 4200 before starting another.

If the page fails, verify both the server connection and the rendered application. An HTTP 200 alone does not prove client startup. LAN HTTP uses the cryptographic session-ID fallback added in PR #51. Financial data is persisted by the configured API; private drafts and unresolved attempts remain scoped to the signed-in account and browser tab.

## Explore the application

`/` enters `/groups`, which loads authorized Group discovery or offers real sign-in. `/trips` lists authorized independent Trip groups. `/household` provides Overview, Expenses, Balances, Activity and Members. Ordinary Groups use `/groups/:groupId`, Trips use `/trips/:groupId`, and the original Household ledger uses `/household/ledger`. Expense details and repayment entry retain their original financial source. Retired preview URLs return normal not-found responses and never reinterpret preview IDs as real resources.

The [frozen prototype](docs/design/README.md) and [primitive gallery](docs/primitives-preview/README.md) remain separate development references.

## Verify changes

Run these in sequence:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For API and persistence changes, also run `make api-check`, `make db-generation-check` and `make db-test`; the latter exercises real Supabase/PostgreSQL migration, authorization and race-enabled integration checks. Required CI runs repository validation and the affected web/API verification paths for every PR and main push; see the [change-aware contract](docs/agents/change-aware-ci.md).

See [testing strategy](docs/testing-strategy.md) for coverage and limitations, and [contributing](CONTRIBUTING.md) for the required issue, independent testing/review, and CI workflow.
