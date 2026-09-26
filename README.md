# Kami Split

Kami Split is a private expense-sharing application for recording shared expenses, splitting costs, tracking balances, and recording settlements.

The repository begins with a small greeting application so the team can prove its GitHub, CI, testing, and review workflow before implementing financial behavior.

## Local setup

Requirements: Node.js 24 and pnpm 11.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Run all local verification:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

See [docs/workflow.md](docs/workflow.md) for the delivery process and [docs/product-scope.md](docs/product-scope.md) for the intended product.

See [the approved UX design](docs/design/README.md) for the seeded-data implementation plan and runnable reference prototype.

## Preview on a phone

Build once and serve on your local network:

```bash
pnpm build
pnpm start --hostname 0.0.0.0 --port 4200
```

Connect your phone to the same Wi-Fi and open `http://<your-computer-LAN-IP>:4200`. On macOS, `ipconfig getifaddr en0` shows the Wi-Fi address. Keep the computer awake. Demo records remain separate per browser session and reset on reload. Verify the rendered page and a draft interaction; an HTTP 200 alone does not prove the client application started. Session identifiers support LAN HTTP through cryptographic `getRandomValues` when the secure-context-only `randomUUID` API is unavailable.
