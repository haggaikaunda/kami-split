import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { digest } from './ci-build.mjs';

function repository(directory) {
  mkdirSync(directory);
  const git = (args) =>
    execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  git(['init', '--quiet']);
  git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--allow-empty',
    '--quiet',
    '-m',
    'fixture',
  ]);
  return git(['rev-parse', 'HEAD']);
}
const foreignOwner = {
  ...process.env,
  GIT_TEST_ASSUME_DIFFERENT_OWNER: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};
const buildScript = fileURLToPath(new URL('./ci-build.mjs', import.meta.url));

test('command-scoped checkout trust restores a revision-bound archive with exact permissions under restrictive umask', () => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), 'kami-browser-build-')),
  );
  try {
    const checkout = join(directory, 'checkout');
    const revision = repository(checkout);
    const other = join(directory, 'other');
    repository(other);
    const git = (cwd, args) =>
      spawnSync('git', args, { cwd, env: foreignOwner, encoding: 'utf8' });
    assert.match(
      git(checkout, ['rev-parse', 'HEAD']).stderr,
      /dubious ownership/,
    );
    const trusted = git(checkout, [
      '-c',
      `safe.directory=${checkout}`,
      'rev-parse',
      'HEAD',
    ]);
    assert.equal(trusted.status, 0);
    assert.equal(trusted.stdout.trim(), revision);
    assert.match(
      git(other, ['-c', `safe.directory=${checkout}`, 'rev-parse', 'HEAD'])
        .stderr,
      /dubious ownership/,
    );
    assert.match(
      git(checkout, ['rev-parse', 'HEAD']).stderr,
      /dubious ownership/,
      'Scoped trust does not persist',
    );

    const source = join(directory, 'source');
    const output = join(checkout, 'apps/web');
    const bundle = join(checkout, 'bundle');
    mkdirSync(join(source, '.next'), { recursive: true });
    mkdirSync(output, { recursive: true });
    mkdirSync(bundle);
    const files = [
      ['BUILD_ID', 'production-id', 0o664],
      ['.hidden', 'hidden runtime input', 0o660],
      ['executable', 'runtime helper', 0o775],
    ];
    chmodSync(join(source, '.next'), 0o775);
    for (const [name, content, mode] of files) {
      writeFileSync(join(source, '.next', name), content);
      chmodSync(join(source, '.next', name), mode);
    }
    const archive = join(bundle, 'production.tar');
    execFileSync('tar', ['-cf', archive, '-C', source, '.next']);
    const inventory = JSON.stringify(['required-journey']);
    writeFileSync(join(bundle, 'inventory.json'), inventory);
    writeFileSync(
      join(bundle, 'build.json'),
      JSON.stringify({
        version: 1,
        revision,
        buildId: 'production-id',
        archiveDigest: digest(readFileSync(archive)),
        inventoryDigest: digest(inventory),
      }),
    );
    // A child process owns the restrictive umask; do not mutate the test runner's.
    const invoke = (script) =>
      spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `process.umask(0o077); process.argv = [process.execPath, ${JSON.stringify(script)}, 'restore', 'bundle']; await import(${JSON.stringify(new URL('./ci-build.mjs', import.meta.url).href)});`,
        ],
        { cwd: checkout, env: foreignOwner, encoding: 'utf8' },
      );
    const restored = invoke(buildScript);
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(statSync(join(output, '.next')).mode & 0o777, 0o775);
    for (const [name, content, mode] of files) {
      assert.equal(readFileSync(join(output, '.next', name), 'utf8'), content);
      assert.equal(
        statSync(join(output, '.next', name)).mode & 0o777,
        mode,
        `${name}: preserve archived mode`,
      );
    }
    const manifest = JSON.parse(
      readFileSync(join(bundle, 'build.json'), 'utf8'),
    );
    writeFileSync(
      join(bundle, 'build.json'),
      JSON.stringify({ ...manifest, revision: 'f'.repeat(40) }),
    );
    const wrongRevision = invoke(buildScript);
    assert.notEqual(wrongRevision.status, 0);
    assert.match(wrongRevision.stderr, /Browser build revision mismatch/);
    assert.match(
      git(checkout, ['rev-parse', 'HEAD']).stderr,
      /dubious ownership/,
      'Restore does not persist Git trust',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
