import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { git, conservative } from './changes.mjs';

// Exercise the real command boundary independently of the pure policy tests.
// The only provider interaction is a local executable recording request inputs.
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'release-cli-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(['init', '-b', 'main'], cwd);
  git(['config', 'user.name', 'Test'], cwd);
  git(['config', 'user.email', 'test@example.com'], cwd);
  writeFileSync(join(cwd, 'README.md'), 'fixture');
  git(['add', '.'], cwd);
  git(['commit', '-m', 'baseline'], cwd);
  const base = git(['rev-parse', 'HEAD'], cwd);
  writeFileSync(join(cwd, 'README.md'), 'docs change');
  git(['commit', '-am', 'docs'], cwd);
  const sha = git(['rev-parse', 'HEAD'], cwd);
  const event = {
    workflow_run: {
      head_sha: sha,
      event: 'push',
      head_branch: 'main',
      head_repository: { full_name: 'owner/repo' },
      conclusion: 'success',
    },
  };
  const eventPath = join(cwd, 'event.json');
  writeFileSync(eventPath, JSON.stringify(event));
  writeFileSync(
    join(cwd, 'gh'),
    `#!${process.execPath}
const fs = require('node:fs');
const [command, path, ...args] = process.argv.slice(2);
if (command !== 'api') process.exit(2);
if (args.includes('POST')) {
  const body = JSON.parse(fs.readFileSync(0, 'utf8'));
  fs.appendFileSync(process.env.TEST_LOG, JSON.stringify({ path, body }) + '\\n');
  console.log('{}');
} else if (path.endsWith('/git/ref/heads/main')) {
  console.log(JSON.stringify({ object: { sha: process.env.TEST_MAIN } }));
} else if (process.env.TEST_ERROR === 'true') {
  process.exit(1);
} else {
  console.log(process.env.TEST_STATUSES);
}
`,
    { mode: 0o755 },
  );
  function run(operation, overrides = {}) {
    const log = join(cwd, 'requests.jsonl');
    const output = join(cwd, 'outputs.txt');
    writeFileSync(log, '');
    writeFileSync(output, '');
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/ci/release.mjs'), operation],
      {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${cwd}:${process.env.PATH}`,
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: output,
          GITHUB_REPOSITORY: 'owner/repo',
          GITHUB_SERVER_URL: 'https://github.com',
          GITHUB_RUN_ID: '123',
          // Ambient workflow SHA deliberately differs from the released SHA.
          GITHUB_SHA: base,
          TEST_LOG: log,
          TEST_MAIN: sha,
          TEST_STATUSES: JSON.stringify([
            {
              context: 'kami-split/api-release',
              creator: { login: 'github-actions[bot]' },
              state: 'success',
              description: 'API release succeeded',
            },
          ]),
          ...overrides,
        },
      },
    );
    return {
      ...result,
      requests: readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse),
      outputs: Object.fromEntries(
        readFileSync(output, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => line.split('=')),
      ),
    };
  }
  return { run, sha, base, eventPath, event };
}

test('CLI plan and finish bind status to selected SHA; docs select no service', (t) => {
  const { run, sha } = fixture(t);
  const plan = run('plan');
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(plan.outputs.api_changed, 'false');
  assert.equal(plan.outputs.web_changed, 'false');
  assert.equal(plan.requests[0].path, `repos/owner/repo/statuses/${sha}`);
  assert.equal(plan.requests[0].body.state, 'pending');
  const finish = run('finish', {
    PLAN_RESULT: 'success',
    API_REQUIRED: 'false',
    WEB_REQUIRED: 'false',
    API_RESULT: 'skipped',
    WEB_RESULT: 'skipped',
  });
  assert.equal(finish.status, 0, finish.stderr);
  assert.equal(finish.requests[0].path, `repos/owner/repo/statuses/${sha}`);
  assert.equal(finish.requests[0].body.description, 'API release not required');
});

test('CLI stale queued run cannot select production work or publish success', (t) => {
  const { run, base } = fixture(t);
  const plan = run('plan', { TEST_MAIN: base });
  assert.notEqual(plan.status, 0);
  assert.deepEqual(plan.outputs, {});
  assert.deepEqual(
    plan.requests.map((request) => request.body.state),
    ['pending'],
  );
});

test('CLI missing baseline and status lookup failure conservatively select every service', (t) => {
  const { run } = fixture(t);
  for (const overrides of [
    { TEST_STATUSES: '[]' },
    { TEST_ERROR: 'true' },
    { TEST_STATUSES: '{}' },
  ]) {
    const plan = run('plan', overrides);
    assert.equal(plan.status, 0, plan.stderr);
    assert.deepEqual(
      plan.outputs,
      Object.fromEntries(
        Object.entries(conservative()).map(([key, value]) => [
          key,
          String(value),
        ]),
      ),
    );
  }
});

test('CLI failed or cancelled required release never reports not required', (t) => {
  const { run } = fixture(t);
  for (const apiResult of ['failure', 'cancelled', 'skipped', '']) {
    const finish = run('finish', {
      PLAN_RESULT: 'success',
      API_REQUIRED: 'true',
      WEB_REQUIRED: 'false',
      API_RESULT: apiResult,
      WEB_RESULT: 'skipped',
    });
    assert.notEqual(finish.status, 0);
    assert.equal(finish.requests[0].body.state, 'failure');
    assert.equal(
      finish.requests[0].body.description,
      'Required release or classification failed',
    );
  }
});

test('CLI foreign workflow repository is rejected before writing any status', (t) => {
  const { run, eventPath, event } = fixture(t);
  event.workflow_run.head_repository.full_name = 'other/repo';
  writeFileSync(eventPath, JSON.stringify(event));
  const result = run('plan');
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.requests, []);
  assert.deepEqual(result.outputs, {});
});
