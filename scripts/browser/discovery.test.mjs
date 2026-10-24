import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// A reviewed inventory of distinct cases, independent of project grep/tag rules.
// Update deliberately when adding/removing a journey, not to bless lost discovery.
const groups = {
  'personal.spec.mjs': [
    19,
    [
      /^Personal connections reflow/,
      /^Connections keeps healthy institution management compact/,
      /^Personal transactions reflow/,
      /^Personal detail reflows/,
    ],
  ],
  'activity.spec.mjs': [16, [/^activity row composition/]],
  'creation.spec.mjs': [7, [/^creation page keeps fields/]],
  'members.spec.mjs': [9, [/ Members reflows long names/]],
  'refresh-spacing.spec.mjs': [3, []],
  'smoke.spec.mjs': [
    80,
    [
      / enlarged header geometry /,
      /^account resolution: the slow opening screen/,
      /^directory cards contain long exact amounts/,
      /^shared header aligns Household/,
      /^compact identity and navigation remain/,
      /^Balance layout: long names/,
      / short enlarged viewport keeps expense controls/,
      /^balance and repayment layout retains/,
      /^creation recovery and validation stay/,
      /^Overview [HFT] compact vertical composition/,
      /^Overview exact long amounts/,
    ],
  ],
  'startup-theme.spec.mjs': [13, []],
  'touch-focus.spec.mjs': [5, [/^focus presentation: enlarged short filters/]],
};

function cases(report) {
  const visit = (suite) => [
    ...(suite.specs ?? []).flatMap((spec) =>
      spec.tests.map((execution) => ({
        file: spec.file,
        title: spec.title,
        project: execution.projectName,
      })),
    ),
    ...(suite.suites ?? []).flatMap(visit),
  ];
  return report.suites.flatMap(visit);
}

function assertCoverage(discovered) {
  assert.deepEqual(
    [...new Set(discovered.map((item) => item.file))].sort(),
    Object.keys(groups).sort(),
    'Every required browser file must remain selected',
  );
  for (const [file, [count, owned]] of Object.entries(groups)) {
    const mobile = discovered.filter(
      (item) => item.file === file && item.project === 'chromium-390',
    );
    assert.equal(mobile.length, count, `${file}: distinct required cases`);
    assert.equal(new Set(mobile.map((item) => item.title)).size, count);
    for (const pattern of owned)
      assert.ok(
        mobile.some((item) => pattern.test(item.title)),
        `${pattern}`,
      );
    for (const item of mobile) {
      const ownsViewport = owned.some((pattern) => pattern.test(item.title));
      assert.equal(
        item.title.includes('@owns-viewport'),
        ownsViewport,
        `${item.title}: only audited self-contained viewports are partitioned`,
      );
    }
    assert.deepEqual(
      discovered
        .filter(
          (item) => item.file === file && item.project === 'chromium-1280',
        )
        .map((item) => item.title)
        .sort(),
      mobile
        .filter((item) => !owned.some((pattern) => pattern.test(item.title)))
        .map((item) => item.title)
        .sort(),
      `${file}: retain every project-dependent desktop case exactly once`,
    );
  }
  assert.ok(
    discovered.every((item) => /^chromium-(390|1280)$/.test(item.project)),
  );
}

const discovery = spawnSync(
  process.execPath,
  ['node_modules/@playwright/test/cli.js', 'test', '--list', '--reporter=json'],
  {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  },
);
assert.equal(discovery.status, 0, 'Required browser discovery must succeed');
const report = JSON.parse(discovery.stdout);
assert.deepEqual(report.errors, []);
const discovered = cases(report);

test('actual default discovery preserves required journeys and viewport ownership', () => {
  assert.equal(report.config.workers, 2);
  assert.equal(report.config.fullyParallel, false);
  assert.equal(report.config.forbidOnly, true);
  assert.ok(report.config.projects.every((project) => project.retries === 0));
  assertCoverage(discovered);
});

for (const [name, omitted] of [
  [
    'a responsive matrix',
    (item) => /activity row composition/.test(item.title),
  ],
  [
    'a desktop journey',
    (item) =>
      item.project === 'chromium-1280' && /auth boundary:/.test(item.title),
  ],
  ['a required partition', (item) => item.project === 'chromium-390'],
])
  test(`discovery rejects selection that omits ${name}`, () => {
    assert.throws(() =>
      assertCoverage(discovered.filter((item) => !omitted(item))),
    );
  });

// Run actual Playwright partitioning, rather than duplicating its scheduler.
// Keep file-level state grouped; the smoke file already opts into parallel cases.
test('three actual shards have an exact disjoint required inventory union', () => {
  const shards = [1, 2, 3].map((index) => {
    const result = spawnSync(
      process.execPath,
      [
        'node_modules/@playwright/test/cli.js',
        'test',
        '--list',
        '--reporter=json',
        `--shard=${index}/3`,
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    assert.equal(result.status, 0, `Shard ${index} discovery succeeds`);
    const listed = JSON.parse(result.stdout);
    assert.deepEqual(listed.errors, []);
    return cases(listed);
  });
  const key = (item) => JSON.stringify(item);
  const union = shards.flat();
  assert.equal(
    new Set(union.map(key)).size,
    union.length,
    'No execution is duplicated across partitions',
  );
  assert.deepEqual(
    union.map(key).sort(),
    discovered.map(key).sort(),
    'All reviewed required executions remain selected exactly once',
  );
  assertCoverage(union);
  for (const shard of shards) assert.ok(shard.length > 0, 'No empty partition');
  console.log(
    'Browser partition execution counts:',
    shards.map((shard) => shard.length).join(', '),
  );
});

test('discovery rejects a duplicate desktop execution of the owned account-opening matrix', () => {
  const account = discovered.find((item) =>
    /^account resolution:/.test(item.title),
  );
  assert.ok(account);
  assert.throws(() =>
    assertCoverage([...discovered, { ...account, project: 'chromium-1280' }]),
  );
});
