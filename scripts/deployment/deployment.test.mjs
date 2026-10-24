import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateSelection } from './select.mjs';
const sha = 'a'.repeat(40);
const repository = 'owner/repo';
const selection = () => ({
  mode: 'rehearsal',
  sha,
  pr: '156',
  repository,
  request: {
    state: 'open',
    head: { sha, repo: { full_name: repository } },
    base: { ref: 'main', repo: { full_name: repository } },
  },
  runs: [
    {
      check_suite_id: 123,
      head_sha: sha,
      event: 'pull_request',
      conclusion: 'success',
      status: 'completed',
      path: '.github/workflows/ci.yml',
    },
  ],
  checks: [
    {
      check_suite: { id: 123 },
      name: 'Verify',
      app: { slug: 'github-actions' },
      status: 'completed',
      conclusion: 'success',
    },
  ],
});
test('selection requires exact open same-repository head and successful trusted CI', () => {
  assert.doesNotThrow(() => validateSelection(selection()));
  for (const mutate of [
    (s) => (s.sha = 'bad'),
    (s) => (s.pr = '../1'),
    (s) => (s.mode = 'unknown'),
    (s) => (s.request.state = 'closed'),
    (s) => (s.request.head.sha = 'b'.repeat(40)),
    (s) => (s.request.head.repo.full_name = 'fork/repo'),
    (s) => (s.request.base.ref = 'other'),
    (s) => (s.checks = []),
    (s) => (s.checks[0].conclusion = 'failure'),
    (s) => (s.checks[0].app.slug = 'untrusted'),
    (s) => (s.runs = []),
    (s) => (s.runs[0].head_sha = 'b'.repeat(40)),
    (s) => (s.runs[0].event = 'workflow_dispatch'),
    (s) => (s.runs[0].check_suite_id = 456),
    (s) => (s.runs[0].conclusion = 'failure'),
  ]) {
    const s = selection();
    mutate(s);
    assert.throws(() => validateSelection(s));
  }
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'deployment-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(resolve('scripts/deployment'), join(root, 'scripts/deployment'), {
    recursive: true,
  });
  cpSync(
    resolve('scripts/cloud-run-traffic-flag.sh'),
    join(root, 'scripts/cloud-run-traffic-flag.sh'),
  );
  mkdirSync(join(root, 'bin'));
  mkdirSync(join(root, 'supabase/migrations'), { recursive: true });
  mkdirSync(join(root, 'source/supabase/migrations'), { recursive: true });
  writeFileSync(
    join(root, 'source/supabase/migrations/20261022000000_test.sql'),
    'select 1;',
  );
  const env = {
    ...process.env,
    PATH: `${root}/bin:${process.env.PATH}`,
    LOG: `${root}/calls`,
    GITHUB_OUTPUT: `${root}/output`,
    RUNNER_TEMP: root,
    DEPLOY_MODE: 'rehearsal',
    DEPLOY_SHA: sha,
    PR_NUMBER: '156',
    GITHUB_RUN_ID: '123456',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_REPOSITORY: repository,
    GCP_PROJECT_ID: 'kami-finances-production',
    GCP_REGION: 'us-west1',
    GCP_CLOUD_RUN_SERVICE: 'kami-split-api',
    GCP_ARTIFACT_REPOSITORY: 'kami-split',
    SUPABASE_PROJECT_REF: 'zlxpapkxacnwnmgagbth',
    PRODUCTION_WEB_ORIGIN: 'https://example.com',
    IMAGE_REF:
      'image@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    CANDIDATE_URL: 'https://candidate.example.com',
    GRAPHQL_RESPONSE: JSON.stringify({ data: { health: { status: 'ok' } } }),
  };
  for (const key of [
    'GCP_RUNTIME_SERVICE_ACCOUNT',
    'GCP_WORKLOAD_IDENTITY_PROVIDER',
    'GCP_DEPLOY_SERVICE_ACCOUNT',
    'SUPABASE_PUBLISHABLE_KEY',
    'INVITATION_FROM',
    'SUPABASE_ACCESS_TOKEN',
    'SUPABASE_DB_PASSWORD',
  ])
    env[key] = 'private-test-value';
  for (const key of [
    'DATABASE_URL',
    'SUPABASE_CA',
    'CURSOR_SIGNING_KEYS',
    'INVITATION_KEYS',
    'ONBOARDING_AUTH_ADMIN_KEY',
    'RESEND_API_KEY',
  ])
    env[`${key}_SECRET_VERSION`] = '1';
  const service = {
    spec: { traffic: [{ revisionName: 'prod', percent: 100 }] },
    status: {
      url: 'https://service.example.com',
      traffic: [
        { revisionName: 'prod', percent: 100 },
        {
          tag: 'pr-156',
          revisionName: 'kami-split-api-pr-156-aaaaaaaaaaaa-123456-1',
          url: env.CANDIDATE_URL,
        },
      ],
    },
  };
  function state(value = service) {
    writeFileSync(join(root, 'service.json'), JSON.stringify(value));
  }
  state();
  function stub(name, body) {
    const path = join(root, name.includes('/') ? name : `bin/${name}`);
    writeFileSync(
      path,
      `#!/usr/bin/env bash\nset -eu\nprintf '%s\\n' '${name}'\" $*\" >> \"$LOG\"\n${body}\n`,
      { mode: 0o755 },
    );
  }
  stub(
    'gcloud',
    `case "$*" in
 'run services list '*) if [[ \"\${SERVICE_MISSING:-0}\" != 1 ]]; then echo kami-split-api; fi;;
 'run services describe '*) cat '${root}/service.json';;
 'artifacts docker images describe '*) echo sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;;
 'run deploy '*) exit "\${DEPLOY_EXIT:-0}";;
 esac`,
  );
  stub(
    'docker',
    'if [[ "$1" == push ]]; then exit "${PUSH_EXIT:-0}"; fi\nexit "${DOCKER_EXIT:-0}"',
  );
  stub('gh', 'echo "${PR_STATE:-open}"');
  stub(
    'curl',
    'if [[ "$*" == *"${FAIL_ENDPOINT:-no-failure}"* ]]; then exit 22; fi\nif [[ "$*" == */graphql ]]; then printf "%s" "$GRAPHQL_RESPONSE"; fi',
  );
  stub(
    'scripts/db-tool.sh',
    `if [[ "$*" == *"migration list"* ]]; then
 printf '%s' '{"migrations":[{"local":"20261022000000","remote":"20261022000000","time":"2026-10-22 00:00:00"}],"message":"Migrations listed"}'
fi
if [[ "$*" == *--dry-run* ]]; then exit "\${MIGRATION_EXIT:-0}"; fi`,
  );
  const run = (script, overrides = {}, args = []) =>
    spawnSync('bash', [`scripts/deployment/${script}.sh`, ...args], {
      cwd: root,
      env: { ...env, ...overrides },
      encoding: 'utf8',
    });
  return {
    root,
    env,
    state,
    service,
    run,
    calls: () => {
      try {
        return readFileSync(env.LOG, 'utf8');
      } catch {
        return '';
      }
    },
  };
}
test('configuration rejects omissions and mutable secret versions without leaking values', (t) => {
  const f = fixture(t);
  assert.equal(f.run('validate').status, 0);
  for (const overrides of [
    { GCP_PROJECT_ID: '' },
    { GCP_REGION: 'wrong' },
    { DATABASE_URL_SECRET_VERSION: 'latest' },
    { SUPABASE_DB_PASSWORD: '' },
  ]) {
    const r = f.run('validate', overrides);
    assert.notEqual(r.status, 0, JSON.stringify(overrides));
    assert.ok(
      !r.stdout.includes('private-test-value') &&
        !r.stderr.includes('private-test-value'),
    );
  }
});
test('image build failure prevents publication; success resolves immutable digest', (t) => {
  const f = fixture(t);
  assert.notEqual(f.run('image', { DOCKER_EXIT: '1' }).status, 0);
  assert.ok(!f.calls().includes('docker push'));
  assert.notEqual(f.run('image', { PUSH_EXIT: '1' }).status, 0);
  assert.equal(f.run('image').status, 0);
  assert.match(
    readFileSync(f.env.GITHUB_OUTPUT, 'utf8'),
    /@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/,
  );
  assert.match(f.calls(), new RegExp(`api:${sha}`));
});
test('repeated publications retain commit identity with distinct immutable tags', (t) => {
  const f = fixture(t);
  assert.equal(f.run('image').status, 0);
  assert.equal(f.run('image', { GITHUB_RUN_ATTEMPT: '2' }).status, 0);
  const publications = f
    .calls()
    .split('\n')
    .filter((line) => line.startsWith('docker push '));
  assert.equal(publications.length, 2);
  assert.ok(publications[0].endsWith(`api:${sha}-123456-1`));
  assert.ok(publications[1].endsWith(`api:${sha}-123456-2`));
  assert.notEqual(publications[0], publications[1]);
  const references = readFileSync(f.env.GITHUB_OUTPUT, 'utf8')
    .trim()
    .split('\n');
  assert.equal(references.length, 2);
  for (const reference of references)
    assert.match(reference, /\/api@sha256:[a-f0-9]{64}$/);
});
test('rehearsal migrations dry-run only, including failure; release applies after dry-run', (t) => {
  const f = fixture(t);
  assert.equal(f.run('migrate').status, 0);
  assert.notEqual(f.run('migrate', { MIGRATION_EXIT: '1' }).status, 0);
  assert.ok(
    f
      .calls()
      .split('\n')
      .filter((l) => l.includes('db push'))
      .every((l) => l.endsWith('--dry-run')),
  );
  assert.equal(f.run('migrate', { DEPLOY_MODE: 'release' }).status, 0);
  assert.match(f.calls(), /db push --linked --yes\n/);
});
test('candidate uses zero traffic, immutable image, durable provenance, stable tag across retries', (t) => {
  const f = fixture(t);
  assert.equal(f.run('candidate').status, 0);
  f.service.status.traffic[1].revisionName =
    'kami-split-api-pr-156-aaaaaaaaaaaa-123456-2';
  f.state();
  assert.equal(f.run('candidate', { GITHUB_RUN_ATTEMPT: '2' }).status, 0);
  const deploys = f
    .calls()
    .split('\n')
    .filter((l) => l.startsWith('gcloud run deploy'));
  assert.equal(deploys.length, 2);
  for (const call of deploys) {
    assert.match(call, /--no-traffic/);
    assert.match(call, /--tag pr-156/);
    assert.match(
      call,
      /--image image@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/,
    );
    assert.match(call, new RegExp(`commit-sha=${sha}`));
  }
  assert.match(deploys[0], /--revision-suffix pr-156-aaaaaaaaaaaa-123456-1/);
  assert.match(deploys[1], /--revision-suffix pr-156-aaaaaaaaaaaa-123456-2/);
  assert.notEqual(f.run('candidate', { DEPLOY_EXIT: '1' }).status, 0);
  assert.ok(!f.calls().includes('update-traffic'));
  assert.notEqual(f.run('promote').status, 0);
  assert.ok(!f.calls().includes('--to-revisions'));
});
test('health, readiness, GraphQL transport and application errors fail probes', (t) => {
  const f = fixture(t);
  assert.equal(f.run('probe').status, 0);
  for (const endpoint of ['/health', '/ready', '/graphql'])
    assert.notEqual(f.run('probe', { FAIL_ENDPOINT: endpoint }).status, 0);
  for (const response of [
    { data: { health: { status: 'bad' } } },
    { data: { health: { status: 'ok' } }, errors: [{ message: 'bad' }] },
  ])
    assert.notEqual(
      f.run('probe', { GRAPHQL_RESPONSE: JSON.stringify(response) }).status,
      0,
    );
  assert.ok(!f.calls().includes('gcloud'));
});
test('traffic guard rejects changed allocation and LATEST routing; tolerates tag changes', (t) => {
  const f = fixture(t);
  assert.equal(f.run('traffic', {}, ['before']).status, 0);
  assert.equal(f.run('traffic', {}, ['after']).status, 0);
  f.service.status.traffic.pop();
  f.state();
  assert.equal(f.run('traffic', {}, ['after']).status, 0);
  f.service.status.traffic[0].revisionName = 'candidate';
  f.state();
  assert.notEqual(f.run('traffic', {}, ['after']).status, 0);
  f.service.spec.traffic[0].latestRevision = true;
  f.state();
  assert.notEqual(f.run('traffic', {}, ['before']).status, 0);
});
test('open PR keeps tag; closed PR cleanup only removes tag and is repeatable', (t) => {
  const f = fixture(t);
  assert.equal(f.run('cleanup').status, 0);
  assert.equal(f.calls().includes('gcloud'), false);
  assert.equal(f.run('cleanup', { PR_STATE: 'closed' }).status, 0);
  assert.match(f.calls(), /--remove-tags pr-156/);
  assert.ok(
    !f.calls().includes('delete') && !f.calls().includes('--to-revisions'),
  );
  f.service.status.traffic.pop();
  f.state();
  assert.equal(f.run('cleanup', { PR_STATE: 'closed' }).status, 0);
  assert.equal(f.calls().split('--remove-tags').length - 1, 1);
});

test('migration symlinks fail before linking production', (t) => {
  const f = fixture(t);
  symlinkSync(
    '/etc/passwd',
    join(f.root, 'source/supabase/migrations/002.sql'),
  );
  assert.notEqual(f.run('migrate').status, 0);
  assert.equal(f.calls(), '');
});
test('first service creation and unknown cleanup state fail closed', (t) => {
  const f = fixture(t);
  assert.notEqual(f.run('candidate', { SERVICE_MISSING: '1' }).status, 0);
  assert.ok(!f.calls().includes('gcloud run deploy'));
  assert.notEqual(f.run('cleanup', { PR_STATE: 'unknown' }).status, 0);
  assert.ok(!f.calls().includes('update-traffic'));
});

test('stale candidate tag and candidate receiving traffic fail verification', (t) => {
  const f = fixture(t);
  f.service.status.traffic[1].revisionName = 'kami-split-api-stale';
  f.state();
  assert.notEqual(f.run('candidate').status, 0);
  f.service.status.traffic[1].revisionName =
    'kami-split-api-pr-156-aaaaaaaaaaaa-123456-1';
  f.service.status.traffic[1].percent = 1;
  f.state();
  assert.notEqual(f.run('candidate').status, 0);
});
test('release candidate clears inherited PR labels and promotion targets verified revision', (t) => {
  const f = fixture(t);
  f.service.status.traffic[1].tag = 'candidate-aaaaaaaaaaaa';
  f.state();
  assert.equal(f.run('candidate', { DEPLOY_MODE: 'release' }).status, 0);
  assert.match(f.calls(), /deployment-purpose=release/);
  assert.match(f.calls(), /--remove-labels pr-number/);
  f.service.status.traffic[0].revisionName = 'kami-split-api-release';
  f.state();
  assert.equal(
    f.run('promote', {
      DEPLOY_MODE: 'release',
      CANDIDATE_REVISION: 'kami-split-api-release',
      CANDIDATE_TAG: 'candidate-aaaaaaaaaaaa',
      SERVICE_URL: 'https://service.example.com',
    }).status,
    0,
  );
  assert.match(f.calls(), /--to-revisions kami-split-api-release=100/);
});
