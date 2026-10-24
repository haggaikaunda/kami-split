import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, cpSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  localMigrations,
  migrationPlan,
  parseHistory,
  recovery,
} from './migration-policy.mjs';
import { pushMigrations } from './migrations.mjs';
const local = () => localMigrations('supabase/migrations');
const rows = (missing = [recovery.version], extra = []) => [
  ...[...local().keys()].map((version) => ({
    version,
    local: true,
    remote: !missing.includes(version) && version <= recovery.deployedMaximum,
  })),
  ...extra,
];
const table = (entries) =>
  JSON.stringify({
    message: 'Migrations listed',
    migrations: entries.map((row) => ({
      local: row.local ? row.version : '',
      remote: row.remote ? row.version : '',
      time: '2026-10-22 00:00:00',
    })),
  });
test('pinned structured history parses present and pending rows, rejects ambiguous output', () => {
  assert.deepEqual(parseHistory(table(rows())), rows());
  for (const invalid of [
    '',
    '[]',
    'error',
    table(rows()) + 'unexpected',
    table(rows()) + table(rows()),
    table([{ version: recovery.version, local: false, remote: false }]),
  ])
    assert.throws(() => parseHistory(invalid));
  assert.throws(() => parseHistory(table([...rows(), rows()[0]])));
});
test('only the exact reviewed missing SQL and complete deployed history allow recovery', () => {
  assert.equal(migrationPlan(local(), rows()).includeAll, true);
  const complete = rows([]).map((row) => ({ ...row, remote: true }));
  assert.equal(migrationPlan(local(), complete).includeAll, false);
  for (const entries of [
    rows([recovery.version, '20261021010000']),
    rows().filter((row) => row.version !== recovery.version),
    rows([], [{ version: '20261024000000', local: false, remote: true }]),
    rows().map((row) =>
      row.version === '20261022015000' ? { ...row, remote: true } : row,
    ),
  ])
    assert.throws(() => migrationPlan(local(), entries));
  const changed = local();
  changed.get(recovery.version).hash = '0'.repeat(64);
  assert.throws(() => migrationPlan(changed, rows()));
  changed.get(recovery.version).hash = recovery.sha256;
  changed.get(recovery.version).file = '20261022000000_other.sql';
  assert.throws(() => migrationPlan(changed, rows()));
});
test('rehearsal only dry-runs; release rechecks history and applies only after success', () => {
  for (const mode of ['rehearsal', 'release']) {
    const calls = [];
    const plan = pushMigrations({
      mode,
      run: (args) => {
        calls.push(args);
        return args[0] === 'migration' ? table(rows()) : '';
      },
    });
    assert.equal(plan.includeAll, true);
    const pushes = calls.filter((args) => args[0] === 'db');
    assert.equal(pushes.length, mode === 'release' ? 2 : 1);
    assert.ok(pushes.every((args) => args.includes('--include-all')));
    assert.ok(pushes[0].includes('--dry-run'));
    if (mode === 'release') assert.ok(pushes[1].includes('--yes'));
  }
  const calls = [];
  assert.throws(() =>
    pushMigrations({
      mode: 'release',
      run: (args) => {
        calls.push(args);
        if (args[0] === 'migration') return table(rows());
        throw new Error('dry-run failed');
      },
    }),
  );
  assert.equal(calls.filter((args) => args[0] === 'db').length, 1);
  let reads = 0;
  assert.throws(() =>
    pushMigrations({
      mode: 'release',
      run: (args) =>
        args[0] === 'migration' ? table(++reads === 1 ? rows() : rows([])) : '',
    }),
  );
});
test('changed local SQL cannot activate exception or reach dry-run', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'migration-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync('supabase/migrations', root, { recursive: true });
  appendFileSync(join(root, recovery.file), '\n-- changed');
  const calls = [];
  assert.throws(() =>
    pushMigrations({
      mode: 'release',
      directory: root,
      run: (args) => {
        calls.push(args);
        return table(rows());
      },
    }),
  );
  assert.equal(calls.length, 1);
});
