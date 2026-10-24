import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest } from './ci-build.mjs';

export function assertPartitionCoverage({
  expected,
  manifest,
  reports,
  count,
  results,
}) {
  assert.equal(manifest.version, 1, 'Unknown browser build manifest');
  assert.match(manifest.revision, /^[a-f0-9]{40}$/, 'Missing build revision');
  assert.match(
    manifest.archiveDigest,
    /^[a-f0-9]{64}$/,
    'Missing build digest',
  );
  assert.ok(
    typeof manifest.buildId === 'string' && manifest.buildId.length,
    'Missing build ID',
  );
  assert.ok(
    results.length === 3 && results.every((result) => result === 'success'),
    'Every web job must succeed',
  );
  assert.ok(Number.isInteger(count) && count > 0, 'Expected partition count');
  assert.equal(
    reports.length,
    count,
    'Missing or extra browser partition reports',
  );
  assert.ok(
    expected.length && expected.every((key) => typeof key === 'string'),
    'Missing discovery inventory',
  );
  assert.equal(
    new Set(expected).size,
    expected.length,
    'Duplicate required inventory',
  );
  assert.equal(
    new Set(reports.map((report) => report.partition)).size,
    count,
    'Duplicate browser partition',
  );
  const actual = [];
  for (const report of reports) {
    assert.ok(
      Number.isInteger(report.partition) &&
        report.partition >= 1 &&
        report.partition <= count,
      'Unexpected partition',
    );
    assert.equal(report.count, count, 'Partition count mismatch');
    assert.equal(
      report.revision,
      manifest.revision,
      'Partition revision mismatch',
    );
    assert.equal(
      report.archiveDigest,
      manifest.archiveDigest,
      'Partition production build mismatch',
    );
    assert.equal(
      report.buildId,
      manifest.buildId,
      'Partition build ID mismatch',
    );
    assert.equal(report.status, 'passed', 'Unsuccessful browser partition');
    assert.ok(report.tests.length, 'Empty browser partition');
    for (const test of report.tests) {
      assert.equal(
        test.expectedStatus,
        'passed',
        'Expected failure or skipped journey',
      );
      assert.deepEqual(
        test.attempts,
        ['passed'],
        'Missing, failed, retried or skipped journey',
      );
      actual.push(test.key);
    }
  }
  assert.equal(
    new Set(actual).size,
    actual.length,
    'Duplicate browser execution',
  );
  assert.deepEqual(
    actual.sort(),
    [...expected].sort(),
    'Browser partition union must equal required inventory',
  );
}

function main() {
  const build = resolve(process.argv[2] || 'test-results/browser-build');
  const directory = resolve(process.argv[3] || 'test-results/browser-coverage');
  const inventory = readFileSync(resolve(build, 'inventory.json'));
  const manifest = JSON.parse(
    readFileSync(resolve(build, 'build.json'), 'utf8'),
  );
  assert.equal(
    manifest.inventoryDigest,
    digest(inventory),
    'Required inventory digest mismatch',
  );
  assertPartitionCoverage({
    expected: JSON.parse(inventory),
    manifest,
    count: 3,
    reports: readdirSync(directory)
      .filter((file) => file.endsWith('.json'))
      .map((file) =>
        JSON.parse(readFileSync(resolve(directory, file), 'utf8')),
      ),
    results: [
      process.env.WEB_CHECK_RESULT,
      process.env.BUILD_RESULT,
      process.env.BROWSER_RESULT,
    ],
  });
  console.log(
    'All three browser partitions match the required inventory and production build.',
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
