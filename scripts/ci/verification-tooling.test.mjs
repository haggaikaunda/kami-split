import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { classify, compare, conservative, git, pathRule } from './changes.mjs';
import { compareReleases, context, planRelease, released } from './release.mjs';

const verificationOnly = {
  verify_web: true,
  verify_api: true,
  deploy_web: false,
  deploy_api: false,
};
const ciInputs = [
  '.github/workflows/ci.yml',
  '.github/workflows/web.yml',
  '.github/workflows/api.yml',
  'scripts/db-test.sh',
  'scripts/db-partitions.mjs',
  'scripts/ci/db-partitions.test.mjs',
];
// The complete merged #407 file set, including its maintained documentation.
const partitionDelivery = [
  '.github/workflows/api.yml',
  'docs/agents/delivery-workflow.md',
  'docs/application/database-development.md',
  'scripts/ci/db-partitions.test.mjs',
  'scripts/db-partitions.mjs',
  'scripts/db-test.sh',
];

for (const path of ciInputs)
  test(`audited CI input retains both verification branches: ${path}`, () => {
    assert.equal(pathRule(path).rule, 'ci-verification-tooling');
    assert.deepEqual(classify([path]), verificationOnly);
  });

for (const path of [
  '.github/workflows/api.yaml',
  '.github/workflows/new-verification.yml',
  '.github/workflows/deploy.yml',
  '.github/workflows/api-deploy.yml',
  'scripts/ci/new.test.mjs',
  'scripts/ci/changes.mjs',
  'scripts/ci/release.mjs',
  'scripts/ci/verify.mjs',
  'scripts/deployment/image.sh',
  'scripts/deployment/migrate.sh',
  'scripts/vercel-promote.mjs',
  'package.json',
  'pnpm-lock.yaml',
  'Makefile',
])
  test(`unproved neighbor or shared release input stays conservative: ${path}`, () =>
    assert.deepEqual(classify([path]), conservative()));

function history(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'ci-verification-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const g = (...args) => git(args, cwd);
  g('init', '-b', 'main');
  g('config', 'user.name', 'Test');
  g('config', 'user.email', 'test@example.test');
  function commit(paths, value) {
    for (const path of paths) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), value);
    }
    g('add', '.');
    g('commit', '-m', 'fixture');
    return g('rev-parse', 'HEAD');
  }
  function plan(base, head) {
    return planRelease({
      sha: head,
      ancestors: g('rev-list', '--first-parent', `${head}^`).split('\n'),
      statuses: (sha) => [
        {
          context,
          creator: { login: 'github-actions[bot]' },
          state: sha === base ? 'success' : 'failure',
          description: released,
        },
      ],
      diff: (a, b, _, report) => compareReleases(a, b, cwd, report),
    });
  }
  return { cwd, g, commit, plan };
}

test('real #407 file-set transition requires verification without deployment', (t) => {
  const { cwd, commit, plan } = history(t);
  const base = commit(partitionDelivery, 'before');
  const head = commit(partitionDelivery, 'after');
  assert.deepEqual(compare(base, head, cwd), verificationOnly);
  assert.deepEqual(plan(base, head), verificationOnly);
});

for (const service of ['web', 'api'])
  test(`failed ${service} work survives CI-only follow-up and net-zero revert`, (t) => {
    const { cwd, g, commit, plan } = history(t);
    const path =
      service === 'web' ? 'apps/web/src/page.tsx' : 'apps/api/main.go';
    const base = commit([path], 'released');
    const failed = commit([path], 'partially promoted');
    const followup = commit(partitionDelivery, 'verification');
    assert.equal(plan(base, followup)[`deploy_${service}`], true);
    g('revert', '--no-edit', failed);
    const head = g('rev-parse', 'HEAD');
    // An endpoint diff has no runtime change, but restoration still deploys.
    assert.deepEqual(compare(base, head, cwd), verificationOnly);
    assert.deepEqual(plan(base, head), {
      ...verificationOnly,
      [`deploy_${service}`]: true,
    });
  });

test('CI-only deletion and known rename skip release; either unproved rename side releases', (t) => {
  const { cwd, g, commit } = history(t);
  const base = commit(['scripts/db-test.sh'], 'fixture');
  g('mv', 'scripts/db-test.sh', 'scripts/db-partitions.mjs');
  g('commit', '-m', 'known verification rename');
  const known = g('rev-parse', 'HEAD');
  assert.deepEqual(compare(base, known, cwd), verificationOnly);
  g('mv', 'scripts/db-partitions.mjs', 'scripts/new-runtime.sh');
  g('commit', '-m', 'unproved destination');
  const unknown = g('rev-parse', 'HEAD');
  assert.deepEqual(compare(known, unknown, cwd), conservative());
  g('mv', 'scripts/new-runtime.sh', 'scripts/db-test.sh');
  g('commit', '-m', 'unproved source');
  const restored = g('rev-parse', 'HEAD');
  assert.deepEqual(compare(unknown, restored, cwd), conservative());
  g('rm', 'scripts/db-test.sh');
  g('commit', '-m', 'verification deletion');
  assert.deepEqual(
    compare(restored, g('rev-parse', 'HEAD'), cwd),
    verificationOnly,
  );
});

test('CI-only exemption cannot mask mixed production, shared or deployment-tool inputs', () => {
  for (const [path, api, web] of [
    ['apps/api/main.go', true, false],
    ['supabase/migrations/20261024000000_change.sql', true, false],
    ['apps/web/src/page.tsx', false, true],
    ['scripts/deployment/image.sh', true, true],
    ['pnpm-lock.yaml', true, true],
  ])
    assert.deepEqual(classify([...partitionDelivery, path]), {
      ...verificationOnly,
      deploy_api: api,
      deploy_web: web,
    });
});

for (const path of [
  'scripts/db-test-new.sh',
  'scripts/db-partitions-new.mjs',
  'scripts/db-tool.sh',
  'scripts/tool-versions.env',
])
  test(`existing API runtime family remains deployable: ${path}`, () =>
    assert.deepEqual(classify([path]), {
      verify_web: false,
      verify_api: true,
      deploy_web: false,
      deploy_api: true,
    }));
