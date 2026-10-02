import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from './vercel-promote.mjs';

const env = {
  VERCEL_TOKEN: 'dummy-token-never-log',
  VERCEL_AUTOMATION_BYPASS_SECRET: 'dummy-bypass-never-log',
  VERCEL_ORG_ID: 'team_expected',
  VERCEL_PROJECT_ID: 'prj_expected',
  DEPLOYMENT_URL: 'https://candidate.vercel.app',
  PRODUCTION_WEB_ORIGIN: 'https://finances.mckardah.com',
};
const candidate = {
  id: 'dpl_candidate',
  url: 'candidate.vercel.app',
  projectId: env.VERCEL_PROJECT_ID,
  ownerId: env.VERCEL_ORG_ID,
  team: { id: env.VERCEL_ORG_ID },
  readyState: 'READY',
  target: 'production',
};
const project = { id: env.VERCEL_PROJECT_ID, accountId: env.VERCEL_ORG_ID };
const alias = (deploymentId = candidate.id, overrides = {}) => ({
  alias: 'finances.mckardah.com',
  projectId: env.VERCEL_PROJECT_ID,
  deploymentId,
  ...overrides,
});
const reply = (body, status = 200) => ({ body, status });

// Scripted transport: an unexpected request fails the test, without a network call.
async function run(responses, options = {}) {
  const calls = [];
  const output = [];
  let clock = 0;
  let sleeps = 0;
  let hostedRuns = 0;
  let unexpectedRequest = false;
  const code = await main(
    { ...env, ...options.env },
    {
      now: () => clock,
      wait: async (ms) => {
        clock += ms;
        sleeps++;
      },
      fetch: async (url, init) => {
        calls.push({ url, init });
        const next = responses.shift();
        if (!next) {
          unexpectedRequest = true;
          throw new Error('Unexpected extra API request');
        }
        if (next.error) throw next.error;
        clock += next.elapsed ?? 0;
        return new Response(next.raw ?? JSON.stringify(next.body), {
          status: next.status,
        });
      },
    },
    (line) => output.push(line),
  );
  // GitHub's default success() gate must only be reached with exit status zero.
  if (code === 0) hostedRuns++;
  assert.equal(unexpectedRequest, false);
  assert.equal(responses.length, 0, 'Expected API request did not occur');
  for (const { url, init } of calls) {
    assert.equal(url.origin, 'https://api.vercel.com');
    assert.equal(url.searchParams.get('teamId'), env.VERCEL_ORG_ID);
    assert.equal(
      url.searchParams.get('projectId'),
      url.pathname.startsWith('/v4/aliases/') ? env.VERCEL_PROJECT_ID : null,
    );
    assert.equal(init.headers.Authorization, `Bearer ${env.VERCEL_TOKEN}`);
    assert.equal(init.headers['x-vercel-protection-bypass'], undefined);
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.ok(calls.filter(({ init }) => init.method === 'POST').length <= 1);
  assert.doesNotMatch(
    output.join('\n'),
    /dummy-token|dummy-bypass|Bearer|sensitive-body/,
  );
  return { code, calls, output, sleeps, clock, hostedRuns };
}

async function fails(responses, options = {}) {
  const result = await run(responses, options);
  assert.equal(result.code, 1);
  assert.equal(result.hostedRuns, 0);
  return result;
}
const lookup = () => [reply(candidate), reply(project)];
const accepted = () => [...lookup(), reply({}, 202)];

test('old deployment then candidate confirms the immutable candidate', async () => {
  const result = await run([
    ...accepted(),
    reply(alias('dpl_old')),
    reply(alias()),
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.hostedRuns, 1);
  assert.equal(result.sleeps, 1);
  assert.deepEqual(
    result.calls.map(({ url, init }) => [init.method, url.pathname]),
    [
      ['GET', '/v13/deployments/candidate.vercel.app'],
      ['GET', '/v9/projects/prj_expected'],
      ['POST', '/v10/projects/prj_expected/promote/dpl_candidate'],
      ['GET', '/v4/aliases/finances.mckardah.com'],
      ['GET', '/v4/aliases/finances.mckardah.com'],
    ],
  );
  assert.equal(result.calls[2].init.body, '{}');
});

for (const status of [201, 202]) {
  test(`${status}: alias already points to candidate on first check`, async () => {
    const result = await run([
      reply({ ...candidate, team: undefined }),
      // Unobservable/stale project promotion state has no role in confirmation.
      reply({
        ...project,
        lastAliasRequest: { jobStatus: 'unknown' },
        targets: { production: { id: 'dpl_old' } },
      }),
      reply({}, status),
      reply(alias()),
    ]);
    assert.equal(result.code, 0);
    assert.equal(result.sleeps, 0);
    assert.equal(result.hostedRuns, 1);
    assert.equal(
      result.calls.filter(({ init }) => init.method === 'POST').length,
      1,
    );
  });
}

for (const status of [301, 401, 403, 404, 429, 500]) {
  test(`lookup HTTP ${status} never mutates production`, async () => {
    const result = await fails([reply({ message: env.VERCEL_TOKEN }, status)]);
    assert.equal(result.calls.length, 1);
  });
}
for (const [label, change] of Object.entries({
  'wrong project': { projectId: 'prj_other' },
  'wrong owner': { ownerId: 'team_other' },
  'conflicting team': { team: { id: 'team_other' } },
  'missing ownership': { ownerId: undefined },
  'missing project': { projectId: undefined },
  'mutable alias': { url: 'other.vercel.app' },
  'not ready': { readyState: 'BUILDING' },
  'preview candidate': { target: null },
  'invalid ID': { id: '../other' },
})) {
  test(`${label} prevents promotion`, async () => {
    await fails([reply({ ...candidate, ...change })]);
  });
}
for (const changed of [
  { id: 'prj_other' },
  { accountId: 'team_other' },
  { accountId: undefined },
]) {
  test(`project ownership checked before POST: ${JSON.stringify(changed)}`, async () => {
    await fails([reply(candidate), reply({ ...project, ...changed })]);
  });
}
for (const status of [200, 204, 302, 400, 401, 403, 409, 422, 500]) {
  test(`unexpected promotion HTTP ${status} prevents hosted checks`, async () => {
    await fails([
      ...lookup(),
      { status, raw: status === 204 ? null : 'sensitive-body' },
    ]);
  });
}
for (const [label, value] of Object.entries({
  'wrong project': alias(candidate.id, { projectId: 'prj_other' }),
  'missing project': alias(candidate.id, { projectId: undefined }),
  'missing deployment': alias(undefined, { deploymentId: undefined }),
  'empty project': alias(candidate.id, { projectId: '' }),
  'empty deployment': alias(''),
  'invalid deployment': alias('../candidate'),
  'wrong hostname': alias(candidate.id, { alias: 'other.example.com' }),
  'missing hostname': alias(candidate.id, { alias: undefined }),
  'redirect alias': alias(candidate.id, {
    redirect: 'https://other.example.com',
  }),
  'deleted alias': alias(candidate.id, { deletedAt: 1 }),
  null: null,
  array: [],
  string: 'sensitive-body',
  number: 42,
  'empty object': {},
})) {
  test(`malformed/unsafe alias fails closed: ${label}`, async () => {
    await fails([...accepted(), reply(value)]);
  });
}
for (const status of [
  201, 202, 204, 301, 302, 307, 308, 400, 401, 403, 404, 410, 429, 500, 503,
]) {
  test(`alias HTTP ${status} fails closed`, async () => {
    await fails([
      ...accepted(),
      { status, raw: status === 204 ? null : 'sensitive-body' },
    ]);
  });
}
test('three minute overall timeout while alias still points to old deployment', async () => {
  const result = await fails([
    ...accepted(),
    ...Array.from({ length: 90 }, () => reply(alias('dpl_old'))),
  ]);
  assert.equal(result.clock, 180_000);
  assert.deepEqual(result.output, ['Promotion timed out.']);
});
test('lookups and POST consume the same overall deadline', async () => {
  const result = await fails([
    { ...reply(candidate), elapsed: 20_000 },
    { ...reply(project), elapsed: 20_000 },
    { ...reply({}, 202), elapsed: 20_000 },
    ...Array.from({ length: 60 }, () => reply(alias('dpl_old'))),
  ]);
  assert.equal(result.clock, 180_000);
});
test('a response arriving after the deadline cannot succeed', async () => {
  await fails([...accepted(), { ...reply(alias()), elapsed: 180_000 }]);
});
for (const prefix of [[], lookup(), accepted()]) {
  test(`transport errors at request ${prefix.length + 1} are sanitized and never retried`, async () => {
    await fails([
      ...prefix,
      {
        error: new Error(
          `Bearer ${env.VERCEL_TOKEN} ${env.VERCEL_AUTOMATION_BYPASS_SECRET}`,
        ),
      },
    ]);
  });
}
for (const prefix of [[], [reply(candidate)], accepted()]) {
  test(`invalid JSON at request ${prefix.length + 1} never leaks provider data`, async () => {
    await fails([
      ...prefix,
      {
        status: 200,
        raw: `sensitive-body ${env.VERCEL_TOKEN} ${env.VERCEL_AUTOMATION_BYPASS_SECRET}`,
      },
    ]);
  });
}
for (const origin of [
  undefined,
  '',
  'http://example.com',
  'https://user:secret@example.com',
  'https://example.com/path',
  'https://example.com?secret=value',
  'https://example.com#fragment',
  'https://example.com:8443',
  'https://example.com:443',
  'https://example.com/../',
  'https://example.com\\@evil.com',
  'https://example.com\n',
  'https://%65xample.com',
  'https://-bad.example.com',
  'https://127.0.0.1',
  'https://[::1]',
  '//example.com',
]) {
  test(`unsafe production origin rejected before mutation: ${JSON.stringify(origin)}`, async () => {
    await fails([], { env: { PRODUCTION_WEB_ORIGIN: origin } });
  });
}
test('production alias derives from configured HTTPS origin, normalizing case and optional slash', async () => {
  const result = await run(
    [
      ...accepted(),
      reply(alias(candidate.id, { alias: 'production.example.org' })),
    ],
    { env: { PRODUCTION_WEB_ORIGIN: 'https://Production.Example.org/' } },
  );
  assert.equal(result.code, 0);
  assert.equal(
    result.calls.at(-1).url.pathname,
    '/v4/aliases/production.example.org',
  );
});
for (const deploymentUrl of [
  'https://evil.example',
  'https://candidate.vercel.app/path',
  'https://user@candidate.vercel.app',
  'https://candidate.vercel.app?token=secret',
]) {
  test(`invalid URL rejected before credentials are used: ${deploymentUrl}`, async () => {
    await fails([], { env: { DEPLOYMENT_URL: deploymentUrl } });
  });
}
test('missing credential fails before requests', async () => {
  await fails([], { env: { VERCEL_TOKEN: '' } });
});

test('workflow gates promotion/hosted checks and keeps credentials step scoped', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/deploy.yml', import.meta.url),
    'utf8',
  );
  const web = workflow.slice(workflow.indexOf('\n  web:'));
  const [job, ...steps] = web.split(/\n      - /);
  const staged = steps.find((step) =>
    step.startsWith('name: Verify staged web deployment'),
  );
  const promotion = steps.find((step) =>
    step.startsWith('name: Promote verified web deployment'),
  );
  const hosted = steps.find((step) =>
    step.startsWith('name: Verify hosted application'),
  );
  assert.ok(steps.indexOf(staged) < steps.indexOf(promotion));
  assert.ok(steps.indexOf(promotion) < steps.indexOf(hosted));
  for (const step of [staged, promotion, hosted]) {
    assert.doesNotMatch(step, /\n        (?:if|continue-on-error):/);
    assert.match(step, /set -euo pipefail/);
  }
  assert.match(
    job,
    /PRODUCTION_WEB_ORIGIN: \$\{\{ vars.PRODUCTION_WEB_ORIGIN \}\}/,
  );
  assert.match(promotion, /node scripts\/vercel-promote.mjs/);
  assert.match(promotion, /VERCEL_TOKEN: \$\{\{ secrets.VERCEL_TOKEN \}\}/);
  assert.doesNotMatch(promotion, /vercel@|BYPASS/);
  assert.doesNotMatch(
    job + hosted,
    /VERCEL_TOKEN|VERCEL_AUTOMATION_BYPASS_SECRET|x-vercel-protection-bypass|Authorization/,
  );
  assert.equal(
    (staged.match(/--header "x-vercel-protection-bypass:/g) ?? []).length,
    3,
  );
  assert.equal((hosted.match(/curl --fail --silent/g) ?? []).length, 3);
});

for (const success of [true, false]) {
  test(`CLI exit gates the next shell command (${success ? 'success' : 'failure'})`, () => {
    const fixtures = success
      ? [...accepted(), reply(alias())]
      : [...accepted(), reply(alias(candidate.id, { projectId: 'prj_other' }))];
    const preload = `const replies = ${JSON.stringify(fixtures)};
      globalThis.fetch = async () => {
        const reply = replies.shift();
        return new Response(JSON.stringify(reply.body), { status: reply.status });
      };`;
    const result = spawnSync(
      'bash',
      [
        '-euc',
        '"$NODE_BINARY" --import "$MOCK_PRELOAD" "$PROMOTION_SCRIPT"; printf "HOSTED_CHECK_REACHED"',
      ],
      {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          ...env,
          NODE_BINARY: process.execPath,
          MOCK_PRELOAD: `data:text/javascript,${encodeURIComponent(preload)}`,
          PROMOTION_SCRIPT: fileURLToPath(
            new URL('./vercel-promote.mjs', import.meta.url),
          ),
        },
      },
    );
    assert.equal(result.status, success ? 0 : 1);
    assert.equal(result.stdout.includes('HOSTED_CHECK_REACHED'), success);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /dummy-token|dummy-bypass|Bearer/,
    );
  });
}
