import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { validateWebSelection } from './web-selection.mjs';
import { releaseResult } from '../ci/release.mjs';

const sha = 'a'.repeat(40);
const env = {
  DEPLOY_SHA: sha,
  PREPARED_SHA: sha,
  API_ORIGIN: 'https://api.example.com',
  CONFIGURED_API_ORIGIN: 'https://api.example.com',
  RELEASED_API_ORIGIN: 'https://api.example.com',
  API_REQUIRED: 'true',
  API_RESULT: 'success',
  DEPLOYMENT_URL: 'https://candidate.vercel.app',
  PRODUCTION_WEB_ORIGIN: 'https://finances.mckardah.com',
  SUPABASE_PROJECT_REF: 'zlxpapkxacnwnmgagbth',
  SUPABASE_PUBLISHABLE_KEY: 'public-key',
  VERCEL_ORG_ID: 'team_example',
  VERCEL_PROJECT_ID: 'prj_example',
  VERCEL_TOKEN: 'private-test-token',
  VERCEL_AUTOMATION_BYPASS_SECRET: 'private-test-bypass',
};

test('preparation needs canonical production configuration but no completed API release', () => {
  validateWebSelection({ ...env, API_RESULT: 'in_progress' }, 'prepare', sha);
  for (const overrides of [
    { API_ORIGIN: '' },
    { API_ORIGIN: 'http://api.example.com' },
    { API_ORIGIN: 'https://api.example.com/' },
    { PRODUCTION_WEB_ORIGIN: 'https://preview.example.com' },
    { SUPABASE_PROJECT_REF: 'preview' },
    { VERCEL_TOKEN: '' },
    { VERCEL_AUTOMATION_BYPASS_SECRET: '' },
    { DEPLOY_SHA: 'b'.repeat(40) },
  ]) {
    assert.throws(() =>
      validateWebSelection({ ...env, ...overrides }, 'prepare', sha),
    );
  }
});

test('promotion requires exact candidate commit and API success/origin agreement', () => {
  validateWebSelection(env, 'promote', sha);
  validateWebSelection(
    {
      ...env,
      API_REQUIRED: 'false',
      API_RESULT: 'skipped',
      RELEASED_API_ORIGIN: '',
    },
    'promote',
    sha,
  );
  for (const overrides of [
    { PREPARED_SHA: 'b'.repeat(40) },
    { DEPLOYMENT_URL: '' },
    { DEPLOYMENT_URL: 'https://attacker.example.com' },
    { CONFIGURED_API_ORIGIN: 'https://other.example.com' },
    { RELEASED_API_ORIGIN: '' },
    { RELEASED_API_ORIGIN: 'https://other.example.com' },
    { API_REQUIRED: '' },
    ...['failure', 'cancelled', 'skipped', 'in_progress', ''].map(
      (API_RESULT) => ({ API_RESULT }),
    ),
    { API_REQUIRED: 'false', API_RESULT: 'success' },
  ]) {
    assert.throws(() =>
      validateWebSelection({ ...env, ...overrides }, 'promote', sha),
    );
  }
});

test('CLI rejects a foreign checkout identity before any following release command without exposing secrets', () => {
  const actual = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  for (const selected of [actual, 'b'.repeat(40)]) {
    const result = spawnSync(
      process.execPath,
      ['scripts/deployment/web-selection.mjs', 'prepare'],
      {
        encoding: 'utf8',
        env: { ...process.env, ...env, DEPLOY_SHA: selected },
      },
    );
    assert.equal(result.status, selected === actual ? 0 : 1);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /private-test-token|private-test-bypass/,
    );
  }
});

const workflow = readFileSync(
  new URL('../../.github/workflows/deploy.yml', import.meta.url),
  'utf8',
);
function job(name) {
  return workflow.split(`\n  ${name}:\n`)[1].split(/\n  [a-z-]+:\n/)[0];
}
function permits(jobSource, needs, cancelled = false) {
  const expression = jobSource
    .match(/    if: >-\n([\s\S]*?)    runs-on:/)[1]
    .trim();
  const js = expression
    .replace(/^\$\{\{\s*|\s*\}\}$/g, '')
    .replaceAll('needs.web-prepare', "needs['web-prepare']");
  return Function(
    'needs',
    'cancelled',
    `return (${js})`,
  )(needs, () => cancelled);
}

test('workflow overlaps only genuine production preparation and retains serialized trusted selection', () => {
  const prepare = job('web-prepare');
  assert.match(prepare, /needs: plan\n/);
  assert.doesNotMatch(
    prepare,
    /needs\.api|service_url|promote|Verify staged|prebuilt|--target[ =]preview/,
  );
  assert.match(prepare, /environment: Production/);
  assert.match(prepare, /API_ORIGIN: \$\{\{ vars.PRODUCTION_API_ORIGIN \}\}/);
  assert.match(prepare, /--prod /);
  assert.match(prepare, /--skip-domain /);
  for (const key of [
    'ONBOARDING_ORIGIN',
    'ONBOARDING_API_URL',
    'ONBOARDING_PUBLIC_SUPABASE_URL',
    'ONBOARDING_PUBLIC_SUPABASE_KEY',
  ]) {
    assert.match(prepare, new RegExp(`--env "${key}=`));
    assert.match(prepare, new RegExp(`--build-env "${key}=`));
  }
  for (const source of [prepare, job('web')]) {
    assert.match(source, /ref: \$\{\{ github.event.workflow_run.head_sha \}\}/);
    assert.match(source, /persist-credentials: false/);
    assert.doesNotMatch(source, /continue-on-error/);
  }
  assert.match(
    workflow,
    /group: production\n  cancel-in-progress: false\n  queue: max/,
  );
  assert.match(job('plan'), /ref: \$\{\{ github.workflow_sha \}\}/);
  assert.match(job('plan'), /node scripts\/ci\/release.mjs plan/);
  assert.match(job('release-status'), /needs: \[plan, api, web-prepare, web\]/);
});

test('promotion and exact release status fail closed for candidate/API failures and invalid selection', () => {
  const web = job('web');
  assert.match(web, /needs: \[plan, api, web-prepare\]/);
  const validation = web.indexOf(
    'node scripts/deployment/web-selection.mjs promote',
  );
  assert.ok(
    validation > 0 &&
      validation < web.indexOf('name: Verify staged web deployment'),
  );
  for (const apiRequired of ['true', 'false', '']) {
    for (const api of ['success', 'failure', 'cancelled', 'skipped', '']) {
      for (const preparation of [
        'success',
        'failure',
        'cancelled',
        'skipped',
        '',
      ]) {
        const needs = {
          plan: {
            result: 'success',
            outputs: { deploy_api: apiRequired, deploy_web: 'true' },
          },
          api: { result: api },
          'web-prepare': { result: preparation },
        };
        const expected =
          preparation === 'success' &&
          ((apiRequired === 'true' && api === 'success') ||
            (apiRequired === 'false' && api === 'skipped'));
        const allowed = permits(web, needs);
        assert.equal(allowed, expected, JSON.stringify(needs));
        assert.equal(
          releaseResult({
            plan: 'success',
            apiRequired,
            webRequired: 'true',
            api,
            web: allowed ? 'success' : 'skipped',
          }).state,
          expected ? 'success' : 'failure',
        );
        assert.equal(permits(web, needs, true), false);
        needs.plan.result = 'failure';
        assert.equal(permits(web, needs), false);
      }
    }
  }
  for (const deploy_web of ['false', '']) {
    assert.equal(
      permits(web, {
        plan: {
          result: 'success',
          outputs: { deploy_api: 'true', deploy_web },
        },
        api: { result: 'success' },
        'web-prepare': { result: 'success' },
      }),
      false,
    );
  }
});
