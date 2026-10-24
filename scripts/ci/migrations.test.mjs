import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  renameSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkEvent, checkMigrations } from './migrations.mjs';
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'migration-order-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  mkdirSync(join(cwd, 'supabase/migrations'), { recursive: true });
  const file = (name, sql = 'select 1;') =>
    writeFileSync(join(cwd, 'supabase/migrations', name), sql);
  const commit = () => {
    git('add', '.');
    git('commit', '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  file('20261022000000_old.sql');
  const base = commit();
  return { cwd, git, file, commit, base };
}
test('new versions advance the actual base while unchanged historical order is accepted', (t) => {
  const f = fixture(t);
  assert.equal(checkMigrations(f.base, f.base, f.cwd).additions, 0);
  f.file('20261023000000_new.sql');
  const head = f.commit();
  assert.equal(checkMigrations(f.base, head, f.cwd).additions, 1);
  assert.equal(
    checkEvent('push', { before: f.base, after: head }, f.cwd).head,
    head,
  );
  assert.equal(
    checkEvent(
      'pull_request',
      { pull_request: { base: { sha: f.base }, head: { sha: head } } },
      f.cwd,
    ).base,
    f.base,
  );
});
for (const scenario of [
  'retroactive',
  'duplicate',
  'malformed',
  'invalid-timestamp',
  'modified',
  'removed',
  'renamed',
])
  test(`rejects ${scenario} history`, (t) => {
    const f = fixture(t);
    if (scenario === 'retroactive') f.file('20261021000000_late.sql');
    if (scenario === 'duplicate') f.file('20261022000000_collision.sql');
    if (scenario === 'invalid-timestamp') f.file('20269999000000_bad.sql');
    if (scenario === 'malformed') f.file('123_bad.sql');
    if (scenario === 'modified') f.file('20261022000000_old.sql', 'select 2;');
    if (scenario === 'removed')
      rmSync(join(f.cwd, 'supabase/migrations/20261022000000_old.sql'));
    if (scenario === 'renamed')
      renameSync(
        join(f.cwd, 'supabase/migrations/20261022000000_old.sql'),
        join(f.cwd, 'supabase/migrations/20261022000000_renamed.sql'),
      );
    const head = f.commit();
    assert.throws(() => checkMigrations(f.base, head, f.cwd));
  });
test('PR uses advanced target history rather than stale merge-base', (t) => {
  const f = fixture(t);
  f.file('20261023000000_candidate.sql');
  const head = f.commit();
  f.git('checkout', '--detach', f.base);
  f.file('20261024000000_concurrent.sql');
  const base = f.commit();
  assert.throws(() =>
    checkEvent(
      'pull_request',
      { pull_request: { base: { sha: base }, head: { sha: head } } },
      f.cwd,
    ),
  );
});
test('invalid, unavailable, non-ancestor and unsupported comparison inputs fail closed', (t) => {
  const f = fixture(t);
  for (const bad of ['', '0'.repeat(40), 'f'.repeat(40), '--all']) {
    assert.throws(() => checkMigrations(bad, f.base, f.cwd));
    assert.throws(() => checkMigrations(f.base, bad, f.cwd));
  }
  assert.throws(() => checkEvent('pull_request', {}, f.cwd));
  assert.throws(() => checkEvent('workflow_dispatch', {}, f.cwd));
  f.file('20261023000000_new.sql');
  const head = f.commit();
  assert.throws(() =>
    checkEvent('push', { before: head, after: f.base }, f.cwd),
  );
});

test('advanced target migrations do not appear as deletion on an unrelated stale PR', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, 'README.md'), 'unrelated docs');
  const head = f.commit();
  f.git('checkout', '--detach', f.base);
  f.file('20261024000000_concurrent.sql');
  const base = f.commit();
  assert.equal(
    checkEvent(
      'pull_request',
      { pull_request: { base: { sha: base }, head: { sha: head } } },
      f.cwd,
    ).additions,
    0,
  );
});
