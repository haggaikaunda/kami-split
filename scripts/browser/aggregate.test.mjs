import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPartitionCoverage } from './aggregate.mjs';
import { digest, verifyBuild } from './ci-build.mjs';
import { verify } from '../ci/verify.mjs';

const manifest = {
  version: 1,
  revision: 'a'.repeat(40),
  archiveDigest: digest('build'),
  buildId: 'production',
};
const candidate = () => ({
  expected: ['mobile:a', 'desktop:a', 'mobile:matrix'],
  manifest,
  count: 3,
  results: ['success', 'success', 'success'],
  reports: ['mobile:a', 'desktop:a', 'mobile:matrix'].map((key, index) => ({
    ...manifest,
    partition: index + 1,
    count: 3,
    status: 'passed',
    tests: [{ key, expectedStatus: 'passed', attempts: ['passed'] }],
  })),
});

test('complete disjoint partitions from one production build satisfy the stable gate', () => {
  assert.doesNotThrow(() => assertPartitionCoverage(candidate()));
  assert.ok(
    verify({
      classification: 'success',
      repository: 'success',
      webRequired: 'true',
      apiRequired: 'false',
      web: 'success',
      api: 'skipped',
    }),
  );
});
for (const status of ['failure', 'cancelled', 'skipped', '', undefined]) {
  for (let job = 0; job < 3; job++)
    test(`web job ${job} cannot be ${status}`, () => {
      const input = candidate();
      input.results[job] = status;
      assert.throws(() => assertPartitionCoverage(input), /Every web job/);
    });
  test(`classification ${status} cannot pass Verify`, () => {
    assert.equal(
      verify({
        classification: status,
        repository: 'success',
        webRequired: 'false',
        apiRequired: 'false',
        web: 'skipped',
        api: 'skipped',
      }),
      false,
    );
  });
}
for (const [name, change, message] of [
  ['missing job result', (c) => c.results.pop(), /Every web job/],
  ['missing partition', (c) => c.reports.pop(), /Missing or extra/],
  [
    'duplicate partition',
    (c) => (c.reports[2].partition = 1),
    /Duplicate browser partition/,
  ],
  [
    'unexpected partition',
    (c) => (c.reports[2].partition = 4),
    /Unexpected partition/,
  ],
  ['different count', (c) => (c.reports[2].count = 4), /count mismatch/],
  [
    'different source',
    (c) => (c.reports[2].revision = 'b'.repeat(40)),
    /revision mismatch/,
  ],
  [
    'different archive',
    (c) => (c.reports[2].archiveDigest = digest('other')),
    /production build mismatch/,
  ],
  [
    'different build ID',
    (c) => (c.reports[2].buildId = 'other'),
    /build ID mismatch/,
  ],
  ['failed suite', (c) => (c.reports[2].status = 'failed'), /Unsuccessful/],
  ['empty partition', (c) => (c.reports[2].tests = []), /Empty/],
  [
    'omitted desktop counterpart',
    (c) => (c.reports[1].tests[0].key = 'other'),
    /union/,
  ],
  [
    'duplicate execution',
    (c) => (c.reports[2].tests[0].key = 'mobile:a'),
    /Duplicate browser execution/,
  ],
  [
    'unexpected extra execution',
    (c) =>
      c.reports[2].tests.push({
        key: 'extra',
        expectedStatus: 'passed',
        attempts: ['passed'],
      }),
    /union/,
  ],
  [
    'duplicate inventory',
    (c) => c.expected.push(c.expected[0]),
    /Duplicate required/,
  ],
  ['empty inventory', (c) => (c.expected = []), /Missing discovery/],
  [
    'expected failure',
    (c) => (c.reports[2].tests[0].expectedStatus = 'failed'),
    /Expected failure/,
  ],
])
  test(`aggregate rejects ${name}`, () => {
    const input = candidate();
    change(input);
    assert.throws(() => assertPartitionCoverage(input), message);
  });
for (const attempts of [
  [],
  ['skipped'],
  ['failed'],
  ['interrupted'],
  ['timedOut'],
  ['failed', 'passed'],
  ['passed', 'passed'],
])
  test(`aggregate rejects attempts ${JSON.stringify(attempts)}`, () => {
    const input = candidate();
    input.reports[1].tests[0].attempts = attempts;
    assert.throws(
      () => assertPartitionCoverage(input),
      /Missing, failed, retried or skipped/,
    );
  });
test('archive digest and exact revision are checked before extraction', () => {
  assert.doesNotThrow(() => verifyBuild(manifest, manifest.revision, 'build'));
  assert.throws(
    () => verifyBuild(manifest, 'b'.repeat(40), 'build'),
    /revision mismatch/,
  );
  assert.throws(
    () => verifyBuild(manifest, manifest.revision, 'changed'),
    /archive mismatch/,
  );
  assert.throws(() => verifyBuild(manifest, 'main', 'build'), /exact checkout/);
  assert.throws(
    () => verifyBuild({ ...manifest, version: 2 }, manifest.revision, 'build'),
    /Unknown/,
  );
  assert.throws(
    () => verifyBuild({ ...manifest, buildId: '' }, manifest.revision, 'build'),
    /build ID/,
  );
});
