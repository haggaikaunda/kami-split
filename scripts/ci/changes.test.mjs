import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  classify,
  classifyEvent,
  compare,
  conservative,
  git,
} from './changes.mjs';
import { verify, validResult } from './verify.mjs';
import {
  compareReleases,
  context,
  released,
  unnecessary,
  successfulBaseline,
  planRelease,
  releaseResult,
} from './release.mjs';

for (const [paths, web, api] of [
  [['apps/web/src/app/page.tsx'], true, false],
  [['scripts/relay/generate.mjs'], true, false],
  [['apps/api/internal/auth/auth.go'], false, true],
  [
    [
      'supabase/migrations/001.sql',
      'scripts/db-test.sh',
      'sqlc.yaml',
      'compose.database.yaml',
    ],
    false,
    true,
  ],
  [['packages/schema/expenses.graphql'], true, true],
  [['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'], true, true],
  [
    ['.github/workflows/deploy.yml', 'scripts/deployment/select.mjs'],
    true,
    true,
  ],
  [
    ['Makefile', '.nvmrc', 'eslint.config.mjs', 'tsconfig.docs.json'],
    true,
    true,
  ],
  [['docs/example.tsx'], true, true],
  [['playwright.config.mjs'], true, false],
  [['tests/browser/smoke.spec.mjs'], true, false],
  [['scripts/browser/auth-server.mjs'], true, false],
  [['new-unknown-package/input.txt'], true, true],
  [
    [
      'README.md',
      'AGENTS.md',
      'apps/api/AGENTS.md',
      'docs/agents/prompts/tester.md',
      '.github/ISSUE_TEMPLATE/bug.yml',
    ],
    false,
    false,
  ],
])
  test(`path contract: ${paths.join(', ')}`, () => {
    const actual = classify(paths);
    assert.equal(actual.verify_web, web);
    assert.equal(actual.verify_api, api);
  });

test('Activity browser fixture selects only web verification; unknown neighbors and classifier changes stay conservative', () => {
  assert.deepEqual(classify(['tests/browser/activity.spec.mjs']), {
    verify_web: true,
    verify_api: false,
    deploy_web: false,
    deploy_api: false,
  });
  assert.deepEqual(
    classify(['tests/browser/new-activity-runner.mjs']),
    conservative(),
  );
  assert.deepEqual(classify(['scripts/ci/changes.mjs']), conservative());
});

test('real history: PR merge base, multi-commit push, deletions, renames and unusual filenames', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'changes-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const g = (...args) => git(args, cwd);
  g('init', '-b', 'main');
  g('config', 'user.name', 'Test');
  g('config', 'user.email', 'test@example.com');
  const commit = (path) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), path);
    g('add', '.');
    g('commit', '-m', 'fixture');
    return g('rev-parse', 'HEAD');
  };
  const base = commit('README.md');
  g('checkout', '-b', 'pr');
  const head = commit('apps/web/new\npage.tsx');
  g('checkout', 'main');
  const main = commit('apps/api/new.go');
  const pr = classifyEvent(
    'pull_request',
    { pull_request: { base: { sha: main }, head: { sha: head } } },
    cwd,
  );
  assert.equal(pr.verify_web, true);
  assert.equal(pr.verify_api, false);
  const after = commit('docs/new.md');
  assert.equal(
    classifyEvent('push', { before: base, after }, cwd).verify_api,
    true,
  );
  g('mv', 'apps/api/new.go', 'docs/moved.md');
  g('commit', '-m', 'rename');
  assert.equal(compare(after, g('rev-parse', 'HEAD'), cwd).verify_api, true);
  assert.deepEqual(compare('0'.repeat(40), after, cwd), conservative());
  assert.deepEqual(compare('a'.repeat(40), after, cwd), conservative());
  assert.deepEqual(compare(head, after, cwd), conservative());
  assert.deepEqual(compare(after, after, cwd), conservative());
  assert.deepEqual(classifyEvent('unknown', {}, cwd), conservative());
});

test('aggregate exhaustively rejects failed, cancelled, unexpected skipped and malformed requirements', () => {
  const results = ['success', 'failure', 'cancelled', 'skipped', undefined];
  for (const webRequired of ['true', 'false', '', undefined])
    for (const apiRequired of ['true', 'false', '', undefined]) {
      for (const web of results)
        for (const api of results)
          for (const repository of results) {
            assert.equal(
              verify({ repository, webRequired, apiRequired, web, api }),
              repository === 'success' &&
                web === { true: 'success', false: 'skipped' }[webRequired] &&
                api === { true: 'success', false: 'skipped' }[apiRequired] &&
                ['true', 'false'].includes(webRequired) &&
                ['true', 'false'].includes(apiRequired),
            );
          }
    }
  assert.equal(validResult('', 'skipped'), false);
});
const status = (description = released) => ({
  compareReleases,
  context,
  creator: { login: 'github-actions[bot]' },
  state: 'success',
  description,
});
test('only latest authenticated exact-context success establishes a baseline', () => {
  assert.ok(successfulBaseline([status()]));
  assert.ok(successfulBaseline([status(unnecessary)]));
  for (const override of [
    { context: 'other' },
    { creator: { login: 'other' } },
    { state: 'failure' },
    { state: 'pending' },
    { description: 'unknown' },
  ]) {
    assert.equal(
      successfulBaseline([{ ...status(), ...override }]) || false,
      false,
    );
  }
  assert.equal(
    successfulBaseline([{ ...status(), state: 'failure' }, status()]),
    false,
  );
});
test('closely spaced releases include failed API and failed legacy-web changes', () => {
  for (const failedPath of ['apps/api/new.go', 'apps/web/new.tsx']) {
    const decision = planRelease({
      sha: 'C',
      ancestors: ['B', 'A'],
      statuses: (sha) =>
        sha === 'A' ? [status()] : [{ ...status(), state: 'failure' }],
      diff: (base, head) => {
        assert.equal(base, 'A');
        assert.equal(head, 'C');
        return classify([failedPath, 'docs/new.md']);
      },
    });
    assert.equal(
      failedPath.includes('/api/') ? decision.verify_api : decision.verify_web,
      true,
    );
  }
  assert.deepEqual(
    planRelease({ sha: 'B', ancestors: [], statuses: () => [] }),
    conservative(),
  );
  assert.deepEqual(
    planRelease({
      sha: 'B',
      ancestors: ['A'],
      statuses: () => {
        throw new Error('network');
      },
    }),
    conservative(),
  );
});
test('release signal distinguishes not required from failure and refuses unexpected skips', () => {
  assert.deepEqual(
    releaseResult({
      plan: 'success',
      apiRequired: 'false',
      webRequired: 'true',
      api: 'skipped',
      web: 'success',
    }),
    { state: 'success', description: unnecessary },
  );
  assert.deepEqual(
    releaseResult({
      plan: 'success',
      apiRequired: 'true',
      webRequired: 'false',
      api: 'success',
      web: 'skipped',
    }),
    { state: 'success', description: released },
  );
  for (const api of ['failure', 'cancelled', 'skipped'])
    assert.equal(
      releaseResult({
        plan: 'success',
        apiRequired: 'true',
        webRequired: 'false',
        api,
        web: 'skipped',
      }).state,
      'failure',
    );
  assert.equal(
    releaseResult({
      plan: 'failure',
      apiRequired: 'false',
      webRequired: 'false',
      api: 'skipped',
      web: 'skipped',
    }).state,
    'failure',
  );
});

test('release restoration includes reverted partially promoted changes', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'release-revert-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const g = (...args) => git(args, cwd);
  g('init', '-b', 'main');
  g('config', 'user.name', 'Test');
  g('config', 'user.email', 'test@example.com');
  mkdirSync(join(cwd, 'apps/api'), { recursive: true });
  writeFileSync(join(cwd, 'apps/api/runtime.go'), 'old');
  g('add', '.');
  g('commit', '-m', 'known successful release');
  const base = g('rev-parse', 'HEAD');
  writeFileSync(join(cwd, 'apps/api/runtime.go'), 'partially promoted');
  g('add', '.');
  g('commit', '-m', 'API promoted but web failed');
  g('revert', '--no-edit', 'HEAD');
  writeFileSync(join(cwd, 'README.md'), 'documentation');
  g('add', '.');
  g('commit', '-m', 'docs');
  const head = g('rev-parse', 'HEAD');
  assert.equal(compare(base, head, cwd).verify_api, false);
  assert.equal(compareReleases(base, head, cwd).verify_api, true);
  assert.equal(compareReleases(base, head, cwd).verify_web, false);
});

test('Members browser cases require web verification without deploying; unknown neighbor files remain conservative', () => {
  assert.deepEqual(classify(['tests/browser/members.spec.mjs']), {
    verify_web: true,
    verify_api: false,
    deploy_web: false,
    deploy_api: false,
  });
  assert.deepEqual(
    classify(['tests/browser/new-members-runner.mjs']),
    conservative(),
  );
});
