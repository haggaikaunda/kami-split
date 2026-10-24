import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

// Exercise the real Playwright reporter lifecycle without a browser or services.
// This checks listing/run identity independently of the aggregate's unit inputs.
test('actual listing and execution reporters agree on nested/project identities and attempts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kami-browser-report-'));
  try {
    const playwright = pathToFileURL(
      resolve('node_modules/@playwright/test/index.mjs'),
    ).href;
    const reporter = resolve('scripts/browser/required-reporter.mjs');
    const inventoryReporter = resolve('scripts/browser/inventory-reporter.mjs');
    const configuration = join(directory, 'playwright.config.mjs');
    writeFileSync(
      configuration,
      `export default ${JSON.stringify({ testDir: directory, testMatch: '*.spec.mjs', workers: 2, retries: 0, reporter: [[reporter]], projects: [{ name: 'mobile' }, { name: 'desktop' }] })};`,
    );
    writeFileSync(
      join(directory, 'identity.spec.mjs'),
      `import {test} from ${JSON.stringify(playwright)}; test.describe('nested suite', () => { test('same title', () => {}); });`,
    );
    const inventoryFile = join(directory, 'inventory.json');
    const coverageFile = join(directory, 'coverage.json');
    const manifestFile = join(directory, 'build.json');
    writeFileSync(
      manifestFile,
      JSON.stringify({
        revision: 'a'.repeat(40),
        archiveDigest: 'b'.repeat(64),
        buildId: 'production',
      }),
    );
    const execute = (args) =>
      spawnSync(
        process.execPath,
        [
          'node_modules/@playwright/test/cli.js',
          'test',
          '--config',
          configuration,
          ...args,
        ],
        {
          encoding: 'utf8',
          timeout: 30_000,
          env: {
            ...process.env,
            BROWSER_INVENTORY_FILE: inventoryFile,
            BROWSER_COVERAGE_FILE: coverageFile,
            BROWSER_BUILD_MANIFEST: manifestFile,
            BROWSER_PARTITION: '2',
            BROWSER_PARTITIONS: '3',
          },
        },
      );
    const listed = execute(['--list', `--reporter=${inventoryReporter}`]);
    assert.equal(listed.status, 0, listed.stderr);
    const ran = execute([]);
    assert.equal(ran.status, 0, ran.stderr);
    const report = JSON.parse(readFileSync(coverageFile, 'utf8'));
    assert.deepEqual(
      report.tests.map((item) => item.key).sort(),
      JSON.parse(readFileSync(inventoryFile, 'utf8')),
    );
    assert.equal(new Set(report.tests.map((item) => item.key)).size, 2);
    assert.equal(report.partition, 2);
    assert.equal(report.count, 3);
    assert.equal(report.revision, 'a'.repeat(40));
    assert.equal(report.archiveDigest, 'b'.repeat(64));
    assert.equal(report.status, 'passed');
    assert.ok(
      report.tests.every(
        (item) =>
          item.expectedStatus === 'passed' &&
          item.attempts.length === 1 &&
          item.attempts[0] === 'passed',
      ),
    );
    writeFileSync(
      join(directory, 'identity.spec.mjs'),
      `import {test} from ${JSON.stringify(playwright)}; test.skip('missing journey', () => {});`,
    );
    assert.notEqual(
      execute([]).status,
      0,
      'An actual skipped case fails the reporter',
    );
    const skipped = JSON.parse(readFileSync(coverageFile, 'utf8'));
    assert.equal(skipped.status, 'failed');
    assert.ok(skipped.tests.every((item) => item.attempts.includes('skipped')));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
