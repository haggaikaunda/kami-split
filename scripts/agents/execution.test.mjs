import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import {
  candidate,
  executePlan,
  portState,
  preflight,
  probe,
  verificationPlan,
} from './execution.mjs';
import { git } from '../ci/changes.mjs';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'kami-execution-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const g = (...args) => git(args, cwd);
  g('init', '-b', 'codex/fixture');
  g('config', 'user.name', 'Fixture');
  g('config', 'user.email', 'fixture@example.test');
  g(
    'remote',
    'add',
    'origin',
    'https://github.com/haggaikaunda/kami-split.git',
  );
  const write = (path, value) => {
    mkdirSync(join(cwd, path, '..'), { recursive: true });
    writeFileSync(join(cwd, path), value);
  };
  write(
    'package.json',
    JSON.stringify({
      packageManager: 'pnpm@11.25.0',
      devDependencies: { missing: '1.0.0' },
    }),
  );
  write('apps/web/package.json', '{}');
  write('.nvmrc', '24');
  write('apps/api/go.mod', 'module fixture\ngo 1.27.1\n');
  write(
    'scripts/browser/settings.mjs',
    'export const webPort=3295; export const authPort=3296;',
  );
  g('add', '.');
  g('commit', '-m', 'fixture');
  return { cwd, g, write, base: g('rev-parse', 'HEAD') };
}

test('candidate rejects wrong remote without printing secrets, dirty/unowned work and unavailable baseline', (t) => {
  const { cwd, g, write, base } = fixture(t);
  assert.deepEqual(candidate(cwd, base, true).issues, []);
  g('remote', 'set-url', 'origin', 'https://secret@example.test/unowned.git');
  write('valuable.txt', 'keep me');
  const result = candidate(cwd, base, false);
  assert.match(
    result.issues.join(' '),
    /Wrong origin.*Dirty checkout.*Ownership unknown/,
  );
  assert.doesNotMatch(JSON.stringify(result), /secret|valuable/);
  assert.ok(
    candidate(cwd, 'a'.repeat(40), true).issues.some((value) =>
      value.includes('baseline unavailable'),
    ),
  );
});

test('locks and shared output are blockers, never removed', (t) => {
  const { cwd, write, base } = fixture(t);
  write('.git/index.lock', 'owned elsewhere');
  symlinkSync(tmpdir(), join(cwd, 'apps/web/.next'));
  const issues = candidate(cwd, base, true).issues.join(' ');
  assert.match(issues, /Git operation or lock/);
  assert.match(issues, /Shared output/);
});

test('fresh checkout reports missing prerequisites and occupied ports without tool stderr or installs', async (t) => {
  const { cwd, base } = fixture(t);
  const calls = [];
  const result = await preflight(cwd, base, true, {
    run: (command, args) => {
      calls.push([command, ...args]);
      return null;
    },
    ports: async () => 'occupied',
  });
  for (const expected of [
    'pnpm unavailable',
    'Workspace dependency',
    'Python validator',
    'Managed Chromium',
    'Browser port',
    'Go 1.27.1',
    'Missing .tools/supabase',
    'Docker unavailable',
  ])
    assert.ok(
      result.issues.some((value) => value.includes(expected)),
      expected,
    );
  assert.ok(
    calls.every(
      (call) => !call.includes('install') && !call[0].includes('supabase'),
    ),
  );
  assert.equal(
    probe(
      process.execPath,
      ['-e', 'console.error("secret"); process.exit(2)'],
      cwd,
    ),
    null,
  );
});

test('port probe preserves an unowned listener; available observation does not reserve it', async (t) => {
  const server = createServer((socket) => socket.end());
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  const port = server.address().port;
  assert.equal(await portState(port), 'occupied');
  assert.equal(server.listening, true);
  await new Promise((done) => server.close(done));
  assert.equal(await portState(port), 'available');
});

test('root checks persist without affected services; affected harnesses use supported serial commands', () => {
  const root = verificationPlan({ verify_web: false, verify_api: false }).map(
    (step) => step.join(' '),
  );
  assert.deepEqual(root.slice(0, 6), [
    'pnpm relay:check',
    'pnpm format:check',
    'pnpm lint',
    'pnpm typecheck',
    'pnpm test',
    'pnpm build',
  ]);
  assert.ok(root.some((step) => step.includes('check_skills.py')));
  const all = verificationPlan({ verify_web: true, verify_api: true });
  const commands = all.map((step) => step.join(' '));
  assert.ok(
    commands.indexOf('pnpm test:browser') > commands.indexOf('pnpm build'),
  );
  assert.ok(
    commands.indexOf('make db-test') >
      commands.indexOf('make db-generation-check'),
  );
  assert.ok(commands.includes('make api-check'));
  assert.ok(
    !commands.some((step) => /compose|dev-up|db-start|db-stop/.test(step)),
  );
  const seen = [];
  assert.equal(
    executePlan(all, process.cwd(), {
      run: (command, args, options) => {
        assert.equal(options.env.BROWSER_SKIP_BUILD, '1');
        seen.push([command, ...args]);
        return { status: 0 };
      },
      report: () => {},
    }),
    0,
  );
  assert.deepEqual(seen, all);
});

test('execution stops on real failing subprocess and preserves its nonzero status', (t) => {
  const { cwd } = fixture(t);
  const steps = [
    [process.execPath, '-e', 'process.exit(7)'],
    [
      process.execPath,
      '-e',
      'require("fs").writeFileSync("must-not-exist", "bad")',
    ],
  ];
  const messages = [];
  assert.equal(
    executePlan(steps, cwd, {
      run: (command, args, options) =>
        spawnSync(command, args, { ...options, stdio: 'pipe' }),
      report: (value) => messages.push(value),
    }),
    7,
  );
  assert.equal(messages.length, 2);
  assert.match(messages[1], /later checks did not run/);
  assert.equal(git(['status', '--porcelain'], cwd), '');
  assert.equal(
    executePlan([['missing-execution-command']], cwd, { report: () => {} }),
    1,
  );
});
