import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
export function verifyBuild(manifest, revision, archive) {
  assert.equal(manifest.version, 1, 'Unknown browser build manifest');
  assert.match(revision, /^[a-f0-9]{40}$/, 'Expected exact checkout revision');
  assert.equal(manifest.revision, revision, 'Browser build revision mismatch');
  assert.equal(
    manifest.archiveDigest,
    digest(archive),
    'Browser build archive mismatch',
  );
  assert.ok(
    typeof manifest.buildId === 'string' && manifest.buildId.length,
    'Missing production build ID',
  );
}

function main() {
  const directory = resolve(process.argv[3] || 'test-results/browser-build');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const archive = resolve(directory, 'production.tar');
  const manifestFile = resolve(directory, 'build.json');
  if (process.argv[2] === 'seal') {
    mkdirSync(directory, { recursive: true });
    execFileSync(
      process.execPath,
      [
        'node_modules/@playwright/test/cli.js',
        'test',
        '--list',
        '--reporter=./scripts/browser/inventory-reporter.mjs',
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          BROWSER_INVENTORY_FILE: resolve(directory, 'inventory.json'),
        },
      },
    );
    // tar retains permissions and hidden .next files; cache is not a runtime input.
    execFileSync('tar', [
      '--exclude=.next/cache',
      '-cf',
      archive,
      '-C',
      'apps/web',
      '.next',
    ]);
    writeFileSync(
      manifestFile,
      JSON.stringify({
        version: 1,
        revision,
        archiveDigest: digest(readFileSync(archive)),
        buildId: readFileSync('apps/web/.next/BUILD_ID', 'utf8').trim(),
        inventoryDigest: digest(
          readFileSync(resolve(directory, 'inventory.json')),
        ),
      }),
    );
  } else if (process.argv[2] === 'restore') {
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    verifyBuild(manifest, revision, readFileSync(archive));
    assert.equal(
      manifest.inventoryDigest,
      digest(readFileSync(resolve(directory, 'inventory.json'))),
      'Browser inventory mismatch',
    );
    execFileSync('tar', ['-xf', archive, '-C', 'apps/web']);
    assert.equal(
      readFileSync('apps/web/.next/BUILD_ID', 'utf8').trim(),
      manifest.buildId,
      'Restored build ID mismatch',
    );
  } else throw new Error('Use seal or restore for browser build artifacts');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
