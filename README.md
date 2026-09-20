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
