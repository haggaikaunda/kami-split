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
if [[ "$1" == push ]]; then exit "\${PUSH_EXIT:-0}"; fi
if [[ "$1 $2" == 'buildx build' ]]; then
  [[ "\${BUILD_EXIT:-0}" == 0 ]] || exit "$BUILD_EXIT"
  if [[ "$*" == *--cache-to* ]]; then
    mkdir -p "$RUNNER_TEMP/api-build-cache-export" || exit 23
    if [[ "\${EXPORT_CACHE:-1}" == 1 ]]; then
      printf '{}' > "$RUNNER_TEMP/api-build-cache-export/index.json"
    fi
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

test('an export path collision is advisory and cannot publish a stale cache', (t) => {
  for (const collision of ['file', 'stale-directory']) {
    const f = fixture(t);
    const exportRoot = join(f.root, 'api-build-cache-export');
    if (collision === 'file') writeFileSync(exportRoot, 'preserved');
    else {
      mkdirSync(exportRoot);
      writeFileSync(join(exportRoot, 'index.json'), 'stale');
    }
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /cache export disabled/);
    assert.ok(!f.calls().includes('--cache-to'));
    assert.match(f.calls(), /push /);
    const output = readFileSync(f.env.GITHUB_OUTPUT, 'utf8');
    assert.match(output, /ref=.*\/api@sha256:[a-f0-9]{64}/);
    assert.ok(!output.includes('cache_ready'));
    assert.equal(
      readFileSync(
        collision === 'file' ? exportRoot : join(exportRoot, 'index.json'),
        'utf8',
      ),
      collision === 'file' ? 'preserved' : 'stale',
    );
  }
});

test('an exact trusted seed hit skips export while still building and publishing each selected source identity', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, 'api-build-cache'));
  writeFileSync(join(f.root, 'api-build-cache/index.json'), '{}');
  // A stale export index must not be promoted after export was intentionally skipped.
  mkdirSync(join(f.root, 'api-build-cache-export'));
  writeFileSync(join(f.root, 'api-build-cache-export/index.json'), 'stale');
  for (const selectedSha of ['a'.repeat(40), 'c'.repeat(40)]) {
    assert.equal(
      f.run({ API_CACHE_HIT: 'true', DEPLOY_SHA: selectedSha }).status,
      0,
    );
    assert.match(f.calls(), new RegExp(`--tag .*api:${selectedSha}-42-1`));
    assert.match(
      f.calls(),
      new RegExp(`org.opencontainers.image.revision=${selectedSha}`),
    );
  }
  const calls = f.calls();
  assert.equal(calls.match(/buildx build/g).length, 2);
  assert.equal(
    calls.match(/--file source\/apps\/api\/Dockerfile source/g).length,
    2,
  );
  assert.ok(calls.includes('--cache-from'));
  assert.ok(!calls.includes('--cache-to'));
  assert.equal(
    readFileSync(join(f.root, 'api-build-cache-export/index.json'), 'utf8'),
    'stale',
  );
  assert.ok(!readFileSync(f.env.GITHUB_OUTPUT, 'utf8').includes('cache_ready'));
});

test('only literal confirmed hits with a restored index suppress export', (t) => {
  for (const hit of ['', 'false', 'TRUE', 'unknown']) {
    const f = fixture(t);
    mkdirSync(join(f.root, 'api-build-cache'));
    writeFileSync(join(f.root, 'api-build-cache/index.json'), 'malformed');
    assert.equal(f.run({ API_CACHE_HIT: hit }).status, 0);
    assert.ok(f.calls().includes('--cache-to'));
    assert.match(readFileSync(f.env.GITHUB_OUTPUT, 'utf8'), /cache_ready=true/);
  }
  const missing = fixture(t);
  assert.equal(missing.run({ API_CACHE_HIT: 'true' }).status, 0);
  assert.ok(missing.calls().includes('--cache-to'));
});

test('an exact seed hit cannot turn a real build, push or digest failure into success', (t) => {
  for (const overrides of [
    { BUILD_EXIT: '17' },
    { PUSH_EXIT: '18' },
    { DIGEST: 'latest' },
  ]) {
    const f = fixture(t);
    mkdirSync(join(f.root, 'api-build-cache'));
    writeFileSync(join(f.root, 'api-build-cache/index.json'), '{}');
    assert.notEqual(f.run({ API_CACHE_HIT: 'true', ...overrides }).status, 0);
    assert.ok(!existsSync(f.env.GITHUB_OUTPUT));
  }
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
  const keys = [...workflow.matchAll(/^          key: (.*)$/gm)].map(
    (match) => match[1],
  );
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.match(keys[0], /^api-deploy-main-linux-amd64-seed-v2-/);
  assert.ok(!keys[0].includes('inputs.sha'));
  assert.ok(!workflow.includes('restore-keys:'));
  assert.match(save, /steps.api-cache.outcome != 'success'/);
  assert.match(save, /steps.api-cache.outputs.cache-hit != 'true'/);
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
  assert.match(
    build,
    /API_CACHE_HIT: \$\{\{ steps.api-cache.outcome == 'success' && steps.api-cache.outputs.cache-hit == 'true' \}\}/,
  );
});

test('only the verified release caller grants inherited cache writes; rehearsal is capped at read', () => {
  const release = readFileSync('.github/workflows/deploy.yml', 'utf8');
  const rehearsal = readFileSync('.github/workflows/rehearse.yml', 'utf8');
  const shared = readFileSync('.github/workflows/api-deploy.yml', 'utf8');
  function job(workflow, name) {
    const marker = `\n  ${name}:\n`;
    assert.ok(workflow.includes(marker), `missing caller job ${name}`);
    return workflow.split(marker)[1].split(/\n  [a-zA-Z_][\w-]*:\n/)[0];
  }
  // GitHub propagates a calling job's cache mode to its reusable workflow.
  // Leave the shared workflow without a broader override or global grant.
  assert.ok(!shared.includes('cache-mode:'));
  for (const [workflow, name, mode, deploymentMode] of [
    [release, 'api', 'write', 'release'],
    [rehearsal, 'rehearsal', 'read', 'rehearsal'],
  ]) {
    const caller = job(workflow, name);
    assert.match(
      caller,
      /^    uses: \.\/\.github\/workflows\/api-deploy\.yml$/m,
    );
    const inheritedMode = caller.match(/^    cache-mode: (read|write)$/m)?.[1];
    assert.equal(
      inheritedMode,
      mode,
      `${name} must use a static caller cache mode`,
    );
    assert.match(caller, new RegExp(`^      mode: ${deploymentMode}$`, 'm'));
  }
  const plan = job(release, 'plan');
  assert.match(job(release, 'api'), /^    needs: plan$/m);
  for (const condition of [
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_branch == 'main'",
  ])
    assert.ok(
      plan.includes(condition),
      `trusted release prerequisite missing: ${condition}`,
    );
  assert.match(job(release, 'api'), /needs.plan.outputs.deploy_api == 'true'/);
  assert.match(
    job(rehearsal, 'rehearsal'),
    /github.ref == 'refs\/heads\/main'/,
  );
  const grants = readdirSync('.github/workflows').flatMap((file) =>
    [
      ...readFileSync(join('.github/workflows', file), 'utf8').matchAll(
        /^(\s*)cache-mode: (.*)$/gm,
      ),
    ].map((match) => [file, match[1].length, match[2]]),
  );
  assert.deepEqual(grants, [
    ['deploy.yml', 4, 'write'],
    ['rehearse.yml', 4, 'read'],
  ]);
});
