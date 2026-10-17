import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  classify,
  conservative,
  diagnostics,
  git,
  validDecisions,
} from './changes.mjs';
import {
  compareReleases,
  planRelease,
  releaseResult,
  context,
  released,
} from './release.mjs';

const choices = (verify_web, verify_api, deploy_web, deploy_api) => ({
  verify_web,
  verify_api,
  deploy_web,
  deploy_api,
});
for (const [paths, expected] of [
  // Historical full changed-path sets: tests/docs #279 and web plus tests #292.
  [
    [
      'apps/web/src/proxy.test.ts',
      'docs/application/home-screen-app.md',
      'docs/application/web-auth-routing.md',
      'scripts/installation-browser.cjs',
    ],
    choices(true, false, false, false),
  ],
  [
    [
      'apps/web/src/components/groups/household-frame.tsx',
      'apps/web/src/components/groups/journey.tsx',
      'apps/web/src/components/workspace/patterns.tsx',
      'apps/web/src/lib/relay/intent.independent.test.ts',
      'apps/web/src/lib/relay/intent.ts',
      'docs/application/frontend.md',
      'docs/application/relay-expenses.md',
      'docs/browser-verification.md',
      'docs/navigation/workspace-loading.md',
      'scripts/navigation-browser.cjs',
      'tests/browser/data.mjs',
      'tests/browser/fixtures.mjs',
      'tests/browser/smoke.spec.mjs',
    ],
    choices(true, false, true, false),
  ],
  [['docs/agents/change-aware-ci.md'], choices(false, false, false, false)],
  [
    [
      '.agents/skills/prepare-issue/SKILL.md',
      '.agents/skills/verify-requirements/SKILL.md',
      '.agents/skills/start-task/SKILL.md',
      '.agents/skills/close-delivery/SKILL.md',
      '.agents/skills/author-repository-skill/assets/skill-template.md',
      '.codex/agents/kami-builder.toml',
      'docs/agents/records/stage-event.schema.json',
      'scripts/agents/check_stage_event.py',
      'scripts/agents/collect_delivery.py',
      'scripts/agents/collect_delivery_test.py',
      'scripts/agents/requirements.txt',
    ],
    choices(false, false, false, false),
  ],
  [
    ['scripts/agents/execution.mjs', 'scripts/agents/execution.test.mjs'],
    choices(true, false, false, false),
  ],
  [['.agents/new-input.json'], conservative()],
  [['.agents/skills/prepare-issue/new-helper.mjs'], conservative()],
  [['.codex/agents/new-role.toml'], conservative()],
  [['scripts/agents/new-helper.py'], conservative()],
  [['docs/agents/records/new-schema.json'], conservative()],
  [
    ['apps/api/internal/expense/read_sql.go', 'supabase/schemas/001.sql'],
    choices(false, true, false, true),
  ],
  [
    [
      'apps/web/src/components/groups/journey.graphql.ts',
      'apps/web/relay.config.json',
    ],
    choices(true, false, true, false),
  ],
  [['scripts/edit-real-browser.cjs'], choices(true, true, false, false)],
  [['scripts/percentage-real-browser.cjs'], choices(true, true, false, false)],
  [['scripts/browser-auth-fixture.cjs'], choices(true, true, false, false)],
  [
    [
      'docs/primitives-preview/examples.tsx',
      'docs/primitives-preview/vite.config.ts',
    ],
    choices(true, false, false, false),
  ],
  [
    ['apps/api/internal/auth/auth_test.go', 'supabase/tests/expense.sql'],
    choices(false, true, false, false),
  ],
  [
    ['apps/web/src/lib/relay/test-queries.tsx', 'apps/web/vitest.config.ts'],
    choices(true, false, false, false),
  ],
  [
    ['apps/web/src/lib/relay/__generated__/journeyWorkspaceQuery.graphql.ts'],
    choices(true, true, true, false),
  ],
  // Test-shaped names outside proven boundaries, new harnesses and inputs are not exemptions.
  [['packages/schema/testdata/percentage.json'], conservative()],
  [['scripts/unknown-browser.cjs'], conservative()],
  [['scripts/browser/new-server.mjs'], conservative()],
  [['tests/browser/new.spec.mjs'], conservative()],
  [['docs/new-example.tsx'], conservative()],
  [['apps/web/public/example.test.ts'], choices(true, false, true, false)],
  [['apps/api/internal/fixture.json'], choices(false, true, false, true)],
  [['scripts/db-test.sh'], choices(false, true, false, true)],
  [['supabase/migrations/test.sql'], choices(false, true, false, true)],
  [['apps/web/next.config.ts'], choices(true, false, true, false)],
  [['apps/api/Dockerfile'], choices(false, true, false, true)],
  [['scripts/deployment/migrate.sh'], conservative()],
  [['pnpm-lock.yaml'], conservative()],
])
  test(`verification / deployment: ${paths.join(', ')}`, () =>
    assert.deepEqual(classify(paths), expected));

test('malformed decisions and deployment without verification cannot authorize no-release', () => {
  for (const value of [
    undefined,
    null,
    {},
    { verify_web: false },
    { ...conservative(), deploy_api: 'false' },
    choices(false, false, true, false),
  ]) {
    assert.equal(validDecisions(value), false);
    assert.deepEqual(
      planRelease({
        sha: 'target',
        ancestors: ['base'],
        statuses: () => [
          {
            context,
            creator: { login: 'github-actions[bot]' },
            state: 'success',
            description: released,
          },
        ],
        diff: () => value,
      }),
      conservative(),
    );
  }
});

test('bounded diagnostics retain rule counts, comparison identity and conservative reasons', () => {
  const diagnostic = diagnostics();
  diagnostic.report({
    comparison: { base: 'a'.repeat(40), head: 'b'.repeat(40) },
  });
  classify(
    [
      ...Array.from(
        { length: 200 },
        (_, i) => `apps/web/src/component-${i}.tsx`,
      ),
      'unrecognized\nname',
    ],
    diagnostic.report,
  );
  const report = diagnostic.snapshot();
  assert.equal(report.events.length, 60);
  assert.equal(report.omitted, 143);
  assert.equal(report.rules['web-production'], 200);
  assert.equal(report.rules['unknown-path'], 1);
  assert.deepEqual(report.fallbacks, ['unknown-path']);
  assert.equal(report.events[0].comparison.head, 'b'.repeat(40));
  assert.doesNotMatch(JSON.stringify(report), /\n/);
});

function history(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'applicability-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const g = (...args) => git(args, cwd);
  g('init', '-b', 'main');
  g('config', 'user.name', 'Test');
  g('config', 'user.email', 'test@example.test');
  const commit = (path, value) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), value);
    g('add', '.');
    g('commit', '-m', 'fixture');
    return g('rev-parse', 'HEAD');
  };
  return { cwd, g, commit };
}

test('test-only transitions do not release; successful evaluation becomes a safe baseline', (t) => {
  const { cwd, commit } = history(t);
  const base = commit('README.md', 'base');
  const tests = commit('apps/web/src/proxy.test.ts', 'test');
  assert.deepEqual(
    compareReleases(base, tests, cwd),
    choices(true, false, false, false),
  );
  const next = commit('apps/api/internal/auth/auth_test.go', 'test');
  assert.deepEqual(
    compareReleases(tests, next, cwd),
    choices(false, true, false, false),
  );
  assert.equal(
    releaseResult({
      plan: 'success',
      apiRequired: 'false',
      webRequired: 'false',
      api: 'skipped',
      web: 'skipped',
    }).description,
    'API release not required',
  );
});

for (const service of ['web', 'api'])
  test(`failed/partial ${service} release survives tests/docs follow-up and net-empty revert`, (t) => {
    const { cwd, g, commit } = history(t);
    const path =
      service === 'web' ? 'apps/web/src/runtime.ts' : 'apps/api/runtime.go';
    const base = commit(path, 'old');
    const failed = commit(path, 'partially promoted');
    g('revert', '--no-edit', 'HEAD');
    commit('apps/web/src/proxy.test.ts', 'new test');
    const head = commit('docs/follow-up.md', 'documentation');
    const events = [];
    const result = planRelease({
      sha: head,
      ancestors: [
        g('rev-parse', 'HEAD^'),
        g('rev-parse', 'HEAD^^'),
        failed,
        base,
      ],
      statuses: (sha) => [
        {
          context,
          creator: { login: 'github-actions[bot]' },
          state: sha === base ? 'success' : 'failure',
          description: released,
        },
      ],
      diff: (a, b, _, report) => compareReleases(a, b, cwd, report),
      report: (event) => events.push(event),
    });
    assert.equal(result[`deploy_${service}`], true);
    assert.equal(result[`deploy_${service === 'web' ? 'api' : 'web'}`], false);
    assert.equal(events[0].baseline, base);
    assert.equal(events[0].target, head);
    assert.equal(events[1].releaseRange.transitions, 4);
  });
