# Web application agent instructions

Follow root [AGENTS.md](../../AGENTS.md) and the shared [delivery workflow](../../docs/agents/delivery-workflow.md). The builder, independent tester, reviewer, and merge gates apply unchanged.

## Web-specific verification

- Read relevant implementation guides in the [documentation index](../../docs/README.md) before editing.
- Run root formatting, linting, type checking, tests, and build commands from the repository root, in sequence. See [testing strategy](../../docs/testing-strategy.md) for focused commands and limitations.
- For UI behavior changes, exercise the rendered application and affected interactions in a browser. Check relevant keyboard, focus, responsive, and accessibility behavior; automated jsdom/axe tests do not replace browser evidence.
- For phone-preview changes, verify the actual LAN HTTP origin. An HTTP 200 alone does not prove client startup.
- Preserve exact-money behavior, drafts, recovery, and simulated access-state tests. Simulation tests are not evidence of production authorization.
- Do not run type checking and build concurrently, because Next.js generates types. Stop a production preview before rebuilding its output.

## Framework guidance

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
