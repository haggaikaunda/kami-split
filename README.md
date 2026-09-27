# Kami Split

Kami Split is an expense-sharing application with a completed, interactive **seeded UX preview**. It supports exact equal/custom splits, balances, repayments, revision history, safe expense editing/deletion, trips, spending charts, and simulated household/account flows.

The preview uses deterministic in-memory data, not a production backend. Changes belong to the current browser session and reset on reload; different browsers do not share them. Sign-in, invitations, access checks, and member management are simulations. No email is sent, no money is moved, and no production privacy or durable-storage guarantee is provided.

The approved UX tracker [#13](https://github.com/haggaikaunda/kami-split/issues/13) and all eighteen child issues are complete. The subsequent [LAN HTTP fix](https://github.com/haggaikaunda/kami-split/pull/51) supports phone previews. See the [documentation index](docs/README.md) for current behavior, architecture, verification evidence, and the original design.

## Repository layout

The Next.js application lives in `apps/web`. `apps/api` contains a health-only Go + gqlgen server, and `packages/schema` owns its SDL-first contract. See the [API README](apps/api/README.md) for Docker Compose and native Go commands. Documentation and automation remain at the root. See [repository layout and deployment](docs/repository-layout.md) for configuration ownership and hosting follow-up. Financial API features and Relay integration are deferred.

## Run locally

Run commands from the repository root. Requirements: Node.js **24** and pnpm **11**; `package.json` pins the package-manager version.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

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

If the page fails, verify both the server connection and the rendered application. An HTTP 200 alone does not prove client startup. LAN HTTP uses the cryptographic session-ID fallback added in PR #51. The browser demo still resets on reload and does not synchronize between the phone and computer.

## Explore the demo

The default household has Kaunda and Mizenin, USD, and a fixed clock of **September 20, 2026**. The initial balance is Kaunda owes Mizenin **$42.18**, with **$5,126.56** in total expenses. Overview's Simulation controls expose deterministic data/access/failure scenarios. All examples are synthetic; use the [walkthroughs](docs/design/prototype-verification.md) and [mock-data guide](docs/mock-data.md) to reproduce them.

Overview, History, Trips, and Household are the main destinations. Account preview opens simulated entry flows. The [frozen prototype](docs/design/README.md) is a separate visual reference, not the application served by `pnpm dev`.

## Verify changes

Run these in sequence:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The post-LAN-fix baseline is **325 tests in 54 files**, including 24 axe-backed accessibility tests. This count is a dated checkpoint, not a permanent target. See [testing strategy](docs/testing-strategy.md) for coverage and limitations, and [contributing](CONTRIBUTING.md) for the required issue, independent testing/review, and CI workflow.
