import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

export const decisionKeys = [
  'verify_web',
  'verify_api',
  'deploy_web',
  'deploy_api',
];
const decision = (verifyWeb, verifyAPI, deployWeb, deployAPI) => ({
  verify_web: verifyWeb,
  verify_api: verifyAPI,
  deploy_web: deployWeb,
  deploy_api: deployAPI,
});
export const conservative = () => decision(true, true, true, true);
export const validDecisions = (result) =>
  decisionKeys.every((key) => typeof result?.[key] === 'boolean') &&
  (!result.deploy_web || result.verify_web) &&
  (!result.deploy_api || result.verify_api);

// Explicit consumers, not a blanket browser/test filename exemption. See the
// dependency evidence and boundary checks in docs/agents/change-aware-ci.md.
const syntheticBrowser = new Set([
  'playwright.config.mjs',
  'scripts/account-browser.cjs',
  'scripts/appearance-browser.cjs',
  'scripts/auth-boundary-browser.cjs',
  'scripts/filter-browser.cjs',
  'scripts/installation-browser.cjs',
  'scripts/issue-269-browser.cjs',
  'scripts/ledger-browser.cjs',
  'scripts/material-browser.cjs',
  'scripts/navigation-browser.cjs',
  'scripts/navigation-layout-browser.cjs',
  'scripts/percentage-browser.cjs',
  'scripts/preservation-browser.cjs',
  'scripts/refresh-browser.cjs',
  'scripts/visual-parity-browser.cjs',
  'scripts/visual-parity-fixture.cjs',
  'scripts/visual-parity-interactions.cjs',
  'scripts/browser/auth-server.mjs',
  'scripts/browser/required-reporter.mjs',
  'scripts/browser/required-reporter.test.mjs',
  'scripts/browser/discovery.test.mjs',
  'scripts/browser/session.mjs',
  'scripts/browser/settings.mjs',
  'tests/browser/data.mjs',
  'tests/browser/fixtures.mjs',
  'tests/browser/smoke.spec.mjs',
  'tests/browser/activity.spec.mjs',
  'tests/browser/members.spec.mjs',
  'tests/browser/creation.spec.mjs',
  'tests/browser/touch-focus.spec.mjs',
]);
const integratedBrowser = new Set([
  'scripts/banking-detail-real-browser.cjs',
  'scripts/edit-real-browser.cjs',
  'scripts/percentage-real-browser.cjs',
  'scripts/browser-auth-fixture.cjs',
]);
const gallery = new Set([
  'docs/primitives-preview/examples.tsx',
  'docs/primitives-preview/index.html',
  'docs/primitives-preview/link.tsx',
  'docs/primitives-preview/navigation.ts',
  'docs/primitives-preview/preview.css',
  'docs/primitives-preview/vite.config.ts',
]);
// Repository validation reads these exact inputs. Neither production build nor
// release tooling imports them; unknown neighbors remain conservative.
const agentResources = new Set([
  '.agents/skills/author-repository-skill/SKILL.md',
  '.agents/skills/author-repository-skill/assets/skill-template.md',
  '.agents/skills/prepare-issue/SKILL.md',
  '.agents/skills/verify-requirements/SKILL.md',
  '.agents/skills/start-task/SKILL.md',
  '.agents/skills/close-delivery/SKILL.md',
  '.agents/skills/evaluate-deliveries/SKILL.md',
  '.codex/agents/kami-builder.toml',
  '.codex/agents/kami-tester.toml',
  '.codex/agents/kami-reviewer.toml',
  '.codex/agents/kami-difficult-reviewer.toml',
  '.codex/agents/kami-narrow-assistant.toml',
  'docs/agents/records/stage-event.schema.json',
  'docs/agents/records/stage-event.example.json',
  'scripts/agents/requirements.txt',
  'scripts/agents/check_skills.py',
  'scripts/agents/check_skills_test.py',
  'scripts/agents/check_stage_event.py',
  'scripts/agents/check_stage_event_test.py',
]);

export function pathRule(path) {
  if (agentResources.has(path))
    return {
      rule: 'agent-validation-resource',
      ...decision(false, false, false, false),
    };
  if (
    [
      'scripts/agents/execution.mjs',
      'scripts/agents/execution.test.mjs',
    ].includes(path)
  )
    return {
      rule: 'agent-execution-tooling',
      ...decision(true, false, false, false),
    };
  if (
    /(^|\/)AGENTS\.md$/.test(path) ||
    /^(README|CONTRIBUTING)\.md$/.test(path) ||
    /^\.github\/(ISSUE_TEMPLATE\/|pull_request_template\.md$)/.test(path) ||
    (/^docs\//.test(path) && /\.(md|png|jpg|jpeg|svg)$/.test(path)) ||
    /^(apps\/(api|web)|packages\/schema)\/README\.md$/.test(path)
  )
    return {
      rule: 'inert-documentation',
      ...decision(false, false, false, false),
    };
  if (integratedBrowser.has(path))
    return {
      rule: 'api-browser-integration',
      ...decision(true, true, false, false),
    };
  if (syntheticBrowser.has(path) || gallery.has(path))
    return {
      rule: 'web-verification-tooling',
      ...decision(true, false, false, false),
    };
  if (
    (/^apps\/web\/src\/.*\.test\.tsx?$/.test(path) &&
      !path.startsWith('apps/web/src/pages/')) ||
    path === 'apps/web/src/lib/relay/test-queries.tsx' ||
    path === 'apps/web/vitest.config.ts'
  )
    return { rule: 'web-unit-test', ...decision(true, false, false, false) };
  // Go excludes *_test.go from production packages. SQL test scripts are read
  // only by db-test.sh, not migration/schema generation or deployment tooling.
  if (
    /^apps\/api\/.*_test\.go$/.test(path) ||
    /^supabase\/tests\/[^/]+\.sql$/.test(path)
  )
    return { rule: 'api-test', ...decision(false, true, false, false) };
  // API transport/integration tests read the checked-in compiled operations.
  // Authored operations/config/generation run in web CI; relay:check requires
  // their changed output to be committed, where this shared consumer rule sees it.
  if (/^apps\/web\/src\/lib\/relay\/__generated__\/.*\.graphql\.ts$/.test(path))
    return {
      rule: 'relay-wire-contract',
      ...decision(true, true, true, false),
    };
  if (path.startsWith('apps/web/') || path.startsWith('scripts/relay/'))
    return { rule: 'web-production', ...decision(true, false, true, false) };
  if (
    path.startsWith('apps/api/') ||
    path.startsWith('supabase/') ||
    /^compose(\.[^/]+)?\.ya?ml$/.test(path) ||
    path === 'sqlc.yaml' ||
    /^scripts\/(db-|check-sqlc|install-db-tools|cloud-run-traffic)/.test(
      path,
    ) ||
    path === 'scripts/tool-versions.env' ||
    path === '.dockerignore' ||
    /^go\.(mod|sum|work|work\.sum)$/.test(path)
  )
    return { rule: 'api-build-runtime', ...decision(false, true, false, true) };
  if (
    path.startsWith('packages/schema/') ||
    [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'Makefile',
      '.nvmrc',
      'eslint.config.mjs',
      'tsconfig.docs.json',
    ].includes(path)
  )
    return { rule: 'shared-input', ...conservative() };
  if (
    path.startsWith('.github/workflows/') ||
    path.startsWith('scripts/deployment/') ||
    path.startsWith('scripts/ci/') ||
    path.startsWith('scripts/vercel-promote')
  )
    return { rule: 'delivery-tooling', ...conservative() };
  return { rule: 'unknown-path', ...conservative() };
}

export function fallback(reason, report = () => {}) {
  report({ fallback: reason });
  return conservative();
}

export function classify(paths, report = () => {}) {
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.some((path) => typeof path !== 'string' || !path)
  )
    return fallback('empty-or-invalid-path-set', report);
  const result = decision(false, false, false, false);
  for (const path of paths) {
    const match = pathRule(path);
    report({ rule: match.rule, path: path.slice(0, 240) });
    if (match.rule === 'unknown-path') report({ fallback: 'unknown-path' });
    for (const key of decisionKeys) result[key] ||= match[key];
  }
  return result;
}

export function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

export function compare(base, head, cwd, report = () => {}) {
  try {
    if (
      ![base, head].every(
        (sha) => /^[a-f0-9]{40}$/.test(sha ?? '') && !/^0+$/.test(sha),
      )
    )
      throw new Error('Missing commit identity');
    report({ comparison: { base, head } });
    git(['merge-base', '--is-ancestor', base, head], cwd);
    // Both sides of renames/deletions; NUL preserves unusual filenames.
    const paths = git(
      ['diff', '--name-only', '--no-renames', '-z', base, head, '--'],
      cwd,
    )
      .split('\0')
      .filter(Boolean);
    return classify(paths, report);
  } catch {
    return fallback('unavailable-or-non-ancestor-history', report);
  }
}

export function classifyEvent(eventName, event, cwd, report = () => {}) {
  if (eventName === 'pull_request') {
    const { base, head } = event.pull_request ?? {};
    try {
      const mergeBase = git(['merge-base', base.sha, head.sha], cwd);
      report({
        event: 'pull_request',
        base: base.sha,
        head: head.sha,
        mergeBase,
      });
      return compare(mergeBase, head.sha, cwd, report);
    } catch {
      return fallback('unavailable-pr-merge-base', report);
    }
  }
  if (eventName === 'push')
    return compare(event.before, event.after, cwd, report);
  return fallback('unsupported-event', report);
}

// One bounded diagnostic owner per invocation. Values are repository paths,
// commit identities and fixed reason labels, never command stderr or app data.
export function diagnostics() {
  const events = [];
  const rules = {};
  const fallbacks = new Set();
  let omitted = 0;
  return {
    report(event) {
      if (event.rule) rules[event.rule] = (rules[event.rule] ?? 0) + 1;
      if (event.fallback) fallbacks.add(event.fallback);
      if (events.length < 60) events.push(event);
      else omitted++;
    },
    snapshot: () => ({ events, omitted, rules, fallbacks: [...fallbacks] }),
  };
}

export function output(result, diagnostic = diagnostics()) {
  if (!validDecisions(result))
    result = fallback('malformed-decisions', diagnostic.report);
  console.log(JSON.stringify({ decisions: result, ...diagnostic.snapshot() }));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      decisionKeys.map((key) => `${key}=${result[key]}\n`).join(''),
    );
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const diagnostic = diagnostics();
  let result;
  try {
    result = classifyEvent(
      process.env.GITHUB_EVENT_NAME,
      JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
      undefined,
      diagnostic.report,
    );
  } catch {
    result = fallback('unreadable-event', diagnostic.report);
  }
  output(result, diagnostic);
}
