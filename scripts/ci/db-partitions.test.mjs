import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  aggregate,
  discover,
  modes,
  passedPackages,
  selection,
  validateProject,
  validatePopulation,
} from '../db-partitions.mjs';

const revision = 'a'.repeat(40);
const inventory = discover();
const results = ['success', 'success', 'success', 'success'];
const reports = () =>
  modes.map((mode, index) => ({
    mode,
    revision,
    inventory,
    status: 'passed',
    project: `kami-split-test-${index}`,
    port: 30000 + index,
    packages: selection(mode),
    population:
      mode === 'migrations'
        ? null
        : {
            users: 1,
            authUsers: 1,
            expenses: 1,
            financialRecords: 1,
            allocations: 1,
            bankingSources: 1,
            bankingRevisions: 1,
          },
  }));

test('project identities cannot be silently truncated or escape the owned namespace', () => {
  validateProject(`kami-split-test-${'a'.repeat(20)}`);
  for (const project of [
    '',
    'kami-split',
    `kami-split-test-${'a'.repeat(32)}`,
    'kami-split-test-../other',
  ]) {
    assert.throws(() => validateProject(project));
  }
});

test('the real shell entry rejects empty, unknown and extra selections before setup', () => {
  for (const args of [[''], ['unknown'], ['banking', 'expenses']]) {
    const result = spawnSync('bash', ['scripts/db-test.sh', ...args], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /Owned database project/);
    assert.match(result.stderr, /Unknown database test mode|Usage: db-test/);
  }
});

test('independent source discovery covers all nine existing packages exactly once', () => {
  assert.equal(inventory.length, 9);
  assert.deepEqual(selection('all').sort(), inventory);
  assert.deepEqual(selection('migrations'), []);
  for (const mode of ['', 'unknown', 'banking,expenses'])
    assert.throws(() => selection(mode));
  assert.throws(() =>
    selection('banking', [...inventory, './internal/new-feature']),
  );
  assert.throws(() => selection('banking', inventory.slice(1)));
});

test('discovery notices a newly added integration package and rejects unaudited constraints', () => {
  const root = mkdtempSync(join(tmpdir(), 'kami-discovery-'));
  try {
    mkdirSync(join(root, 'internal/new-feature'), { recursive: true });
    const file = join(root, 'internal/new-feature/feature_test.go');
    writeFileSync(file, '//go:build integration\n\npackage feature\n');
    assert.ok(discover(root).includes('./internal/new-feature'));
    assert.throws(() => selection('expenses', discover(root)));
    mkdirSync(join(root, 'internal/database/child'), { recursive: true });
    writeFileSync(
      join(root, 'internal/database/child/child_test.go'),
      'package child\n',
    );
    assert.ok(discover(root).includes('./internal/database/child'));
    assert.throws(() => selection('banking', discover(root)));
    writeFileSync(file, '//go:build integration && linux\n\npackage feature\n');
    assert.throws(() => discover(root));
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('actual Go events must contain each successful selected package with no failures or skips', () => {
  const expected = selection('banking');
  const events = expected.map((path) => ({
    Action: 'pass',
    Package: `github.com/haggaikaunda/kami-split/apps/api/${path.slice(2)}`,
  }));
  assert.deepEqual(passedPackages(events, expected), expected);
  for (const invalid of [
    events.slice(1),
    [...events, events[0]],
    [...events, { Action: 'fail' }],
    [...events, { Action: 'skip' }],
  ]) {
    assert.throws(() => passedPackages(invalid, expected));
  }
});

test('aggregation rejects missing, failed, skipped and cancelled API jobs', () => {
  aggregate(reports(), revision, results);
  for (let index = 0; index < results.length; index++) {
    for (const result of ['', undefined, 'failure', 'cancelled', 'skipped']) {
      const changed = [...results];
      changed[index] = result;
      assert.throws(() => aggregate(reports(), revision, changed));
    }
  }
  assert.throws(() => aggregate(reports(), revision, results.slice(1)));
});

test('aggregation rejects missing/duplicate reports, stale revisions, shared projects and false coverage', () => {
  assert.throws(() => aggregate(reports().slice(1), revision, results));
  assert.throws(() =>
    aggregate([...reports(), reports()[0]], revision, results),
  );
  for (const mutate of [
    (r) => {
      r[1].mode = r[2].mode;
    },
    (r) => {
      r[1].revision = 'b'.repeat(40);
    },
    (r) => {
      r[1].status = 'failed';
    },
    (r) => {
      r[1].project = r[0].project;
    },
    (r) => {
      r[1].port = 0;
    },
    (r) => {
      r[1].packages = r[1].packages.slice(1);
    },
    (r) => {
      r[1].packages.push(r[1].packages[0]);
    },
    (r) => {
      r[0].packages = [inventory[0]];
    },
    (r) => {
      r[1].inventory = inventory.slice(1);
    },
  ]) {
    const changed = reports();
    mutate(changed);
    assert.throws(() => aggregate(changed, revision, results));
  }
});

test('dump population requires actual relevant financial and provider fixture rows', () => {
  for (const mode of modes) {
    const population = reports().find(
      (report) => report.mode === mode,
    ).population;
    validatePopulation(mode, population);
    if (mode === 'migrations') continue;
    assert.throws(() => validatePopulation(mode, {}));
    for (const field of Object.keys(population)) {
      const changed = { ...population, [field]: 0 };
      if (
        field === 'users' ||
        field === 'authUsers' ||
        (mode === 'banking'
          ? field.startsWith('banking')
          : !field.startsWith('banking'))
      ) {
        assert.throws(() => validatePopulation(mode, changed));
      }
    }
  }
});

test('existing opt-in skip identities require their original reasons; unknown skips fail', () => {
  const Package =
    'github.com/haggaikaunda/kami-split/apps/api/internal/banking';
  const Test = 'TestInitialConsumerCrashHelper';
  const output = {
    Action: 'output',
    Package,
    Test,
    Output: 'child process only\n',
  };
  const skip = { Action: 'skip', Package, Test };
  const pass = { Action: 'pass', Package };
  assert.deepEqual(
    passedPackages([output, skip, pass], ['./internal/banking']),
    ['./internal/banking'],
  );
  for (const events of [
    [skip, pass],
    [{ ...output, Output: 'unrelated reason' }, skip, pass],
    [output, { ...skip, Test: 'TestRequiredBehavior' }, pass],
  ]) {
    assert.throws(() => passedPackages(events, ['./internal/banking']));
  }
});
