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
const state = (jobStatus, overrides = {}) => ({
  ...project,
  lastAliasRequest: {
    jobStatus,
    requestedAt: 10,
    type: 'promote',
    toDeploymentId: candidate.id,
  },
  targets: { production: { id: candidate.id } },
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
    assert.equal(url.search, '?teamId=team_expected');
    assert.equal(init.headers.Authorization, `Bearer ${env.VERCEL_TOKEN}`);
    assert.equal(init.headers['x-vercel-protection-bypass'], undefined);
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
  }
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

test('pending/in-progress then success confirms the immutable candidate', async () => {
  const result = await run([
    ...accepted(),
    reply(state('pending')),
    reply(state('in-progress')),
    reply(state('succeeded')),
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.hostedRuns, 1);
  assert.equal(result.sleeps, 2);
  assert.deepEqual(
    result.calls.map(({ url, init }) => [init.method, url.pathname]),
    [
      ['GET', '/v13/deployments/candidate.vercel.app'],
      ['GET', '/v9/projects/prj_expected'],
      ['POST', '/v10/projects/prj_expected/promote/dpl_candidate'],
      ['GET', '/v9/projects/prj_expected'],
      ['GET', '/v9/projects/prj_expected'],
      ['GET', '/v9/projects/prj_expected'],
    ],
  );
  assert.equal(result.calls[2].init.body, '{}');
});

test('201 still waits for success; team is optional when ownerId proves ownership', async () => {
  const result = await run([
    reply({ ...candidate, team: undefined }),
    reply(project),
    reply({}, 201),
    reply(state('succeeded')),
  ]);
  assert.equal(result.code, 0);
});

test('queued request waits through absent and old records instead of accepting old success', async () => {
  const old = state('succeeded', {
    lastAliasRequest: {
      ...state('succeeded').lastAliasRequest,
      requestedAt: 5,
    },
  });
  const result = await run([
    reply(candidate),
    reply(old),
    reply({}, 202),
    reply(project),
    reply(old),
    reply(state('pending')),
    reply(state('succeeded')),
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.sleeps, 3);
});

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
for (const jobStatus of ['failed', 'skipped', 'unknown', 'queued', undefined]) {
  test(`promotion state ${jobStatus} fails closed`, async () => {
    await fails([...accepted(), reply(state(jobStatus))]);
  });
}
for (const change of [
  { toDeploymentId: 'dpl_other' },
  { type: 'rollback' },
  { requestedAt: undefined },
]) {
  test(`mismatched/malformed promotion: ${JSON.stringify(change)}`, async () => {
    await fails([
      ...accepted(),
      reply(
        state('succeeded', {
          lastAliasRequest: {
            ...state('succeeded').lastAliasRequest,
            ...change,
          },
        }),
      ),
    ]);
  });
}
for (const target of [{ production: { id: 'dpl_other' } }, {}]) {
  test(`success requires matching production target: ${JSON.stringify(target)}`, async () => {
    await fails([
      ...accepted(),
      reply(state('succeeded', { targets: target })),
    ]);
  });
}
test('ownership change during polling fails', async () => {
  await fails([
    ...accepted(),
    reply(state('succeeded', { accountId: 'team_other' })),
  ]);
});
test('polling HTTP error fails', async () => {
  await fails([...accepted(), reply({}, 503)]);
});
for (const value of [state('pending'), project]) {
  test(`three minute timeout bounds ${value.lastAliasRequest ? 'pending' : 'absent'} state`, async () => {
    const result = await fails([
      ...accepted(),
      ...Array.from({ length: 90 }, () => reply(value)),
    ]);
    assert.equal(result.clock, 180_000);
  });
}
test('old success cannot confirm a new request and times out', async () => {
  const old = state('succeeded');
  const result = await fails([
    reply(candidate),
    reply(old),
    reply({}, 202),
    ...Array.from({ length: 90 }, () => reply(old)),
  ]);
  assert.equal(result.clock, 180_000);
});
test('a response arriving after the deadline cannot succeed', async () => {
  await fails([
    ...accepted(),
    { ...reply(state('succeeded')), elapsed: 180_000 },
  ]);
});
test('transport errors and invalid JSON never leak provider data or credentials', async () => {
  await fails([
    {
      error: new Error(
        `Bearer ${env.VERCEL_TOKEN} ${env.VERCEL_AUTOMATION_BYPASS_SECRET}`,
      ),
    },
  ]);
  await fails([{ status: 200, raw: `sensitive-body ${env.VERCEL_TOKEN}` }]);
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
      ? [...accepted(), reply(state('succeeded'))]
      : [reply({ message: env.VERCEL_TOKEN }, 403)];
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
