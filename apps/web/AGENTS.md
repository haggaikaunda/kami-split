# Web application agent instructions

Follow root [AGENTS.md](../../AGENTS.md) and the shared [delivery workflow](../../docs/agents/delivery-workflow.md). The builder, independent tester, reviewer, and merge gates apply unchanged.

## Web-specific verification

- Read relevant implementation guides in the [documentation index](../../docs/README.md) before editing.
- Run root formatting, linting, type checking, tests, and build commands from the repository root, in sequence. See [testing strategy](../../docs/testing-strategy.md) for focused commands and limitations.
- Run the required `pnpm test:browser` smoke suite after installing managed Chromium; see [browser verification](../../docs/browser-verification.md). CI reuses its fresh production build with `BROWSER_SKIP_BUILD=1`.
- For UI behavior changes, exercise the rendered application and affected interactions in a browser. Check relevant keyboard, focus, responsive, and accessibility behavior; automated jsdom/axe tests do not replace browser evidence.
- For phone-preview changes, verify the actual LAN HTTP origin. An HTTP 200 alone does not prove client startup.
- Preserve exact-money behavior, account-scoped drafts, recovery, and production access-denial tests. The seeded preview architecture and its simulation-only tests were retired in #184; do not restore them.
- Do not run type checking and build concurrently, because Next.js generates types. Stop a production preview before rebuilding its output.

## Frontend ownership

Follow the [frontend guide](../../docs/application/frontend.md) for operation location,
account-scoped Relay ownership and cross-component interactions. Keep authored
GraphQL documents beside their owning feature; import compiled artifacts from
`src/lib/relay/__generated__` and run `pnpm relay:check`. Keep exact-money, draft and
same-attempt recovery protocols intact when changing read or presentation ownership.

## Framework guidance

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Evidence placement

Commit code, meaningful tests, required generated source, approved design inputs and maintained technical documentation. Put issue-specific verification results, screenshots, logs, review reports, acceptance status, work plans and task-start/merge/checkout closeout evidence on the tracking issue or PR, not in repository files. Documentation updates must explain lasting behavior or procedures, not record that a particular run passed. A historical label does not make work-tracking material appropriate for the repository.

Write run outputs to ignored `test-results/` or an external temporary directory. Preserve useful fixtures, test baselines and approved design inputs; classify by purpose and consumers. Before committing and during final review, inspect staged/final files for accidental evidence, task plans and copied issue specifications. Check documented behavior against the actual code. Publish unique history on its owning issue/PR before removing it; preserve original provenance and privacy. This changes evidence placement, not independent testing, whole-final-diff review, final-head CI or post-merge closeout obligations.
