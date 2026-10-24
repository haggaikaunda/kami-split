import { execFileSync } from 'node:child_process';

export function validateWebSelection(env, phase, checkoutSha) {
  const requireCondition = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  requireCondition(
    ['prepare', 'promote'].includes(phase),
    'Invalid web release phase',
  );
  requireCondition(
    /^[a-f0-9]{40}$/.test(env.DEPLOY_SHA ?? '') &&
      checkoutSha === env.DEPLOY_SHA,
    'Web checkout does not match the selected release commit',
  );
  for (const key of [
    'API_ORIGIN',
    'PRODUCTION_WEB_ORIGIN',
    'SUPABASE_PROJECT_REF',
    'SUPABASE_PUBLISHABLE_KEY',
    'VERCEL_ORG_ID',
    'VERCEL_PROJECT_ID',
    ...(phase === 'prepare'
      ? ['VERCEL_TOKEN', 'VERCEL_AUTOMATION_BYPASS_SECRET']
      : []),
  ])
    requireCondition(
      env[key]?.trim(),
      `Missing required production setting: ${key}`,
    );
  requireCondition(
    /^https:\/\/[a-zA-Z0-9.-]+$/.test(env.API_ORIGIN),
    'Invalid production API origin',
  );
  requireCondition(
    env.PRODUCTION_WEB_ORIGIN === 'https://finances.mckardah.com' &&
      env.SUPABASE_PROJECT_REF === 'zlxpapkxacnwnmgagbth',
    'Unexpected production web or Supabase selection',
  );
  if (phase === 'promote') {
    requireCondition(
      env.PREPARED_SHA === env.DEPLOY_SHA,
      'Prepared web candidate does not match the selected release commit',
    );
    requireCondition(
      /^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/.test(env.DEPLOYMENT_URL ?? ''),
      'Invalid prepared web candidate URL',
    );
    requireCondition(
      env.API_ORIGIN === env.CONFIGURED_API_ORIGIN,
      'Prepared web API origin does not match production configuration',
    );
    requireCondition(
      (env.API_REQUIRED === 'true' &&
        env.API_RESULT === 'success' &&
        env.RELEASED_API_ORIGIN === env.API_ORIGIN) ||
        (env.API_REQUIRED === 'false' && env.API_RESULT === 'skipped'),
      'Required API release did not succeed with the prepared web API origin',
    );
  }
}

if (import.meta.main) {
  try {
    const checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    validateWebSelection(process.env, process.argv[2], checkoutSha);
  } catch (error) {
    // Validation diagnostics name settings, never their values or provider bodies.
    console.error(error.message);
    process.exitCode = 1;
  }
}
