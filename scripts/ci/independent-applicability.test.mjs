import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { classify, conservative, git } from './changes.mjs';

test('Next Pages routes cannot use the colocated unit-test exemption', () => {
  for (const path of [
    'apps/web/src/pages/release.test.tsx',
    'apps/web/src/pages/api/release.test.ts',
  ]) {
    assert.deepEqual(classify([path]), {
      verify_web: true,
      verify_api: false,
      deploy_web: true,
      deploy_api: false,
    });
  }
});

test('authored Relay relocation preserves web-only checks while compiled wire changes include API', () => {
  assert.deepEqual(
    classify([
      'apps/web/relay.config.json',
      'apps/web/src/components/groups/journeyWorkspace.graphql.ts',
      'apps/web/src/lib/relay/journey.ts',
      'scripts/relay/generate.mjs',
    ]),
    {
      verify_web: true,
      verify_api: false,
      deploy_web: true,
      deploy_api: false,
    },
  );
  assert.deepEqual(
    classify([
      'apps/web/src/lib/relay/__generated__/journeyWorkspaceQuery.graphql.ts',
    ]),
    {
      verify_web: true,
      verify_api: true,
      deploy_web: true,
      deploy_api: false,
    },
  );
});

function history(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'independent-applicability-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const g = (...args) => git(args, cwd);
  g('init', '-b', 'main');
  g('config', 'user.name', 'Independent test');
  g('config', 'user.email', 'independent@example.test');
  function commit(files) {
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), body);
    }
    g('add', '--', ...Object.keys(files));
    g('commit', '-m', 'fixture');
    return g('rev-parse', 'HEAD');
  }
  function classifyCLI(eventName, eventText) {
    const event = join(cwd, '.event.json');
    const output = join(cwd, '.outputs');
    writeFileSync(event, eventText);
    writeFileSync(output, '');
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/ci/changes.mjs')],
      {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: eventName,
          GITHUB_EVENT_PATH: event,
          GITHUB_OUTPUT: output,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    return {
      report: JSON.parse(result.stdout),
      outputs: Object.fromEntries(
        readFileSync(output, 'utf8')
          .trim()
          .split('\n')
          .map((line) => line.split('=')),
      ),
    };
  }
  return { cwd, g, commit, classifyCLI };
}

test('actual push CLI distinguishes test-only and multi-commit runtime changes', (t) => {
  const { commit, classifyCLI } = history(t);
  const base = commit({ 'README.md': 'settled baseline' });
  const testOnly = commit({
    'apps/web/src/proxy.test.ts': 'test',
    'docs/application/home-screen-app.md': 'guide',
    'docs/application/web-auth-routing.md': 'guide',
    'scripts/installation-browser.cjs': 'fixture',
  });
  const tests = classifyCLI(
    'push',
    JSON.stringify({ before: base, after: testOnly }),
  );
  assert.deepEqual(tests.outputs, {
    verify_web: 'true',
    verify_api: 'false',
    deploy_web: 'false',
    deploy_api: 'false',
  });
  const runtime = commit({ 'apps/web/src/components/runtime.tsx': 'runtime' });
  const head = commit({ 'tests/browser/data.mjs': 'fixture' });
  const production = classifyCLI(
    'push',
    JSON.stringify({ before: testOnly, after: head }),
  );
  assert.deepEqual(production.outputs, {
    verify_web: 'true',
    verify_api: 'false',
    deploy_web: 'true',
    deploy_api: 'false',
  });
  assert.notEqual(runtime, head);
  assert.deepEqual(production.report.events[0].comparison, {
    base: testOnly,
    head,
  });
  assert.equal(production.report.rules['web-production'], 1);
});

test('actual classifier CLI conservatively handles malformed events and incomplete history', (t) => {
  const { commit, classifyCLI } = history(t);
  const head = commit({ 'README.md': 'baseline' });
  for (const [name, body] of [
    ['push', '{invalid'],
    ['push', 'null'],
    ['pull_request', '{}'],
    ['push', JSON.stringify({ before: 'f'.repeat(40), after: head })],
    ['push', JSON.stringify({ before: head, after: head })],
    ['untrusted_event', '{}'],
  ]) {
    const result = classifyCLI(name, body);
    assert.deepEqual(result.report.decisions, conservative());
    assert.deepEqual(result.outputs, {
      verify_web: 'true',
      verify_api: 'true',
      deploy_web: 'true',
      deploy_api: 'true',
    });
    assert.ok(result.report.fallbacks.length > 0);
  }
});

test('runtime deletion and relocation into an exempt test path still require release', (t) => {
  const { g, commit, classifyCLI } = history(t);
  const base = commit({ 'apps/web/src/retired.ts': 'runtime' });
  g('mv', 'apps/web/src/retired.ts', 'apps/web/src/retired.test.ts');
  g('commit', '-m', 'relocate fixture');
  const after = g('rev-parse', 'HEAD');
  const result = classifyCLI('push', JSON.stringify({ before: base, after }));
  assert.equal(result.outputs.deploy_web, 'true');
  assert.equal(result.outputs.deploy_api, 'false');
  assert.equal(result.report.rules['web-production'], 1);
  assert.equal(result.report.rules['web-unit-test'], 1);
});
