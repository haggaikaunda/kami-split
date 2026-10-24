import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'api-image-cache-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'bin'));
  const env = {
    ...process.env,
    PATH: `${root}/bin:${process.env.PATH}`,
    RUNNER_TEMP: root,
    GITHUB_OUTPUT: join(root, 'output'),
    GCP_REGION: 'region',
    GCP_PROJECT_ID: 'project',
    GCP_ARTIFACT_REPOSITORY: 'repo',
    DEPLOY_SHA: 'a'.repeat(40),
    GITHUB_RUN_ID: '42',
    GITHUB_RUN_ATTEMPT: '1',
    CALLS: join(root, 'calls'),
  };
  writeFileSync(
    join(root, 'bin/docker'),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALLS"
if [[ "$1 $2" == 'buildx build' ]]; then
  [[ "\${BUILD_EXIT:-0}" == 0 ]] || exit "$BUILD_EXIT"
  if [[ "\${EXPORT_CACHE:-1}" == 1 ]]; then
    mkdir -p "$RUNNER_TEMP/api-build-cache-export"
    printf '{}' > "$RUNNER_TEMP/api-build-cache-export/index.json"
  fi
fi
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(root, 'bin/gcloud'),
    `#!/usr/bin/env bash
if [[ "$1 $2 $3" == 'artifacts docker images' ]]; then echo "\${DIGEST:-sha256:${'b'.repeat(64)}}"; fi
`,
    { mode: 0o755 },
  );
  return {
    root,
    env,
    run: (overrides = {}) =>
      spawnSync('bash', [resolve('scripts/deployment/image.sh')], {
        cwd: root,
        env: { ...env, ...overrides },
        encoding: 'utf8',
      }),
    calls: () => readFileSync(env.CALLS, 'utf8'),
  };
}

test('cache miss still builds selected linux/amd64 source, exports intermediate layers, and resolves immutable digest', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  assert.match(
    f.calls(),
    /buildx build --platform linux\/amd64 --target runtime --load/,
  );
  assert.ok(!f.calls().includes('--cache-from'));
  assert.match(
    f.calls(),
    /--cache-to type=local,dest=.*api-build-cache-export,mode=max,ignore-error=true/,
  );
  assert.match(f.calls(), /--file source\/apps\/api\/Dockerfile source/);
  assert.match(
    f.calls(),
    new RegExp(`org.opencontainers.image.revision=${f.env.DEPLOY_SHA}`),
  );
  assert.ok(existsSync(join(f.root, 'api-build-cache/index.json')));
  assert.ok(!existsSync(join(f.root, 'api-build-cache-export')));
  assert.match(
    readFileSync(f.env.GITHUB_OUTPUT, 'utf8'),
    /\/api@sha256:[a-f0-9]{64}/,
  );
});

test('restored cache is imported; failed compilation never pushes or emits a deployment reference', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, 'api-build-cache'));
  writeFileSync(join(f.root, 'api-build-cache/index.json'), '{}');
  assert.equal(f.run({ BUILD_EXIT: '1' }).status, 1);
  assert.match(f.calls(), /--cache-from type=local,src=.*api-build-cache/);
  assert.ok(!f.calls().includes('push '));
  assert.ok(!existsSync(f.env.GITHUB_OUTPUT));
  assert.equal(f.run({ DIGEST: 'latest' }).status, 1);
});

test('failed cache export still publishes and cannot be saved under a new revision key', (t) => {
  const f = fixture(t);
  assert.equal(f.run({ EXPORT_CACHE: '0' }).status, 0);
  assert.ok(!readFileSync(f.env.GITHUB_OUTPUT, 'utf8').includes('cache_ready'));
});

test('dependency seed tracks external runtime imports and remains before application source', () => {
  const dockerfile = readFileSync('apps/api/Dockerfile', 'utf8');
  const seed = dockerfile
    .split('RUN CGO_ENABLED=0 go build -trimpath')[1]
    .split('FROM dependencies AS source')[0];
  const seeded = new Set(seed.match(/(?:github\.com|golang\.org)\/[^\s\\]+/g));
  const imported = new Set();
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.go') && !entry.name.endsWith('_test.go')) {
        const source = readFileSync(path, 'utf8');
        for (const [, dependency] of source.matchAll(
          /"((?:github\.com|golang\.org)\/[^"\s]+)"/g,
        )) {
          if (!dependency.startsWith('github.com/haggaikaunda/kami-split/'))
            imported.add(dependency);
        }
      }
    }
  }
  visit('apps/api');
  assert.deepEqual([...seeded].sort(), [...imported].sort());
  assert.ok(
    dockerfile.indexOf('FROM dependencies AS source') <
      dockerfile.indexOf('COPY apps/api/ ./'),
  );
  assert.ok(!dockerfile.includes('--mount=type=cache'));
});

test('cache namespace binds build inputs and only release can save the main cache', () => {
  const workflow = readFileSync('.github/workflows/api-deploy.yml', 'utf8');
  assert.match(workflow, /uses: docker\/setup-buildx-action@v4/);
  const save = workflow
    .split('- name: Save trusted API build cache')[1]
    .split('- name: Install pinned database tools')[0];
  assert.match(save, /if: inputs.mode == 'release'/);
  assert.match(save, /actions\/cache\/save@v5/);
  assert.match(
    save,
    /hashFiles\('source\/apps\/api\/Dockerfile', 'source\/apps\/api\/go.mod', 'source\/apps\/api\/go.sum'\)/,
  );
  assert.match(save, /api-deploy-main-linux-amd64-v1-/);
  assert.match(save, /inputs.sha/);
  assert.match(save, /steps.image.outputs.cache_ready == 'true'/);
  const cachePaths = [
    ...workflow.matchAll(/path: \$\{\{ runner.temp \}\}\/api-build-cache(.*)/g),
  ].map((match) => match[1]);
  assert.deepEqual(cachePaths, ['', '']);
  assert.match(save, /continue-on-error: true/);
  const restore = workflow
    .split('- name: Restore trusted API build cache')[1]
    .split('- name: Build and publish immutable API image')[0];
  assert.match(restore, /continue-on-error: true/);
  const build = workflow
    .split('- name: Build and publish immutable API image')[1]
    .split('# Rehearsals')[0];
  assert.ok(!build.includes('continue-on-error'));
});
