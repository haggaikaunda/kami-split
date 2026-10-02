import { setTimeout as sleep } from 'node:timers/promises';

class PromotionError extends Error {}

function requireCondition(condition, message) {
  if (!condition) throw new PromotionError(message);
}

// Public REST contracts and state semantics are linked in production-deployment.md.
export async function promote(env, dependencies = {}) {
  const {
    fetch: request = globalThis.fetch,
    now = () => performance.now(),
    wait = sleep,
  } = dependencies;
  const {
    VERCEL_TOKEN: token,
    VERCEL_ORG_ID: teamId,
    VERCEL_PROJECT_ID: projectId,
    DEPLOYMENT_URL: deploymentUrl,
    PRODUCTION_WEB_ORIGIN: productionOrigin,
  } = env;
  requireCondition(
    typeof token === 'string' &&
      token.trim().length > 0 &&
      /^team_[a-zA-Z0-9]+$/.test(teamId) &&
      /^prj_[a-zA-Z0-9]+$/.test(projectId),
    'Missing or invalid promotion configuration.',
  );
  requireCondition(
    typeof deploymentUrl === 'string' &&
      /^https:\/\/[a-zA-Z0-9-]+\.vercel\.app\/?$/.test(deploymentUrl),
    'Invalid candidate deployment URL.',
  );
  // Accept only an HTTPS DNS origin, not credentials, ports, paths or URL
  // normalization tricks. The configured host is data in a fixed API path.
  requireCondition(
    typeof productionOrigin === 'string' &&
      /^https:\/\/(?=.{1,253}\/?$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\/?$/.test(
        productionOrigin,
      ),
    'Invalid production web origin.',
  );
  const productionHostname = new URL(productionOrigin).hostname;
  const hostname = new URL(deploymentUrl).hostname;
  const deadline = now() + 180_000;
  function remaining() {
    const milliseconds = Math.ceil(deadline - now());
    requireCondition(milliseconds > 0, 'Promotion timed out.');
    return milliseconds;
  }
  async function api(path, method = 'GET') {
    const signal = AbortSignal.timeout(Math.min(30_000, remaining()));
    const url = new URL(path, 'https://api.vercel.com');
    url.searchParams.set('teamId', teamId);
    if (path.startsWith('/v4/aliases/')) {
      url.searchParams.set('projectId', projectId);
    }
    try {
      const response = await request(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        ...(method === 'POST' ? { body: '{}' } : {}),
        redirect: 'error',
        signal,
      });
      requireCondition(
        (method === 'POST' ? [201, 202] : [200]).includes(response.status),
        'Vercel API returned an unexpected HTTP status.',
      );
      // Never log provider bodies: deployment objects may contain environment values.
      const body = method === 'GET' ? await response.json() : undefined;
      if (method === 'POST') await response.body?.cancel();
      remaining();
      return body;
    } catch (error) {
      if (error instanceof PromotionError) throw error;
      throw new PromotionError(
        'Vercel API request failed or returned invalid JSON.',
      );
    }
  }
  const deployment = await api(
    `/v13/deployments/${encodeURIComponent(hostname)}`,
  );
  requireCondition(
    deployment?.projectId === projectId &&
      deployment?.ownerId === teamId &&
      (deployment.team == null || deployment.team.id === teamId),
    'Candidate project or team ownership mismatch.',
  );
  requireCondition(
    typeof deployment.id === 'string' &&
      /^dpl_[a-zA-Z0-9]+$/.test(deployment.id) &&
      deployment.url === hostname &&
      deployment.readyState === 'READY' &&
      deployment.target === 'production',
    'Candidate is not the expected ready production deployment.',
  );
  const projectPath = `/v9/projects/${encodeURIComponent(projectId)}`;
  async function getProject() {
    const project = await api(projectPath);
    requireCondition(
      project?.id === projectId && project?.accountId === teamId,
      'Project identity or team ownership mismatch.',
    );
    return project;
  }
  await getProject();
  await api(
    `/v10/projects/${encodeURIComponent(projectId)}/promote/${encodeURIComponent(deployment.id)}`,
    'POST',
  );
  for (;;) {
    const alias = await api(
      `/v4/aliases/${encodeURIComponent(productionHostname)}`,
    );
    requireCondition(
      alias !== null &&
        typeof alias === 'object' &&
        !Array.isArray(alias) &&
        alias.alias === productionHostname &&
        typeof alias.projectId === 'string' &&
        /^prj_[a-zA-Z0-9]+$/.test(alias.projectId) &&
        typeof alias.deploymentId === 'string' &&
        /^dpl_[a-zA-Z0-9]+$/.test(alias.deploymentId) &&
        alias.redirect == null &&
        alias.deletedAt == null,
      'Malformed or unsafe production alias.',
    );
    requireCondition(
      alias.projectId === projectId,
      'Production alias project ownership mismatch.',
    );
    if (alias.deploymentId === deployment.id) return deployment.id;
    // The previous deployment is normal while the canonical alias propagates.
    await wait(Math.min(2_000, remaining()));
  }
}

export async function main(
  env = process.env,
  dependencies = {},
  log = console.log,
) {
  try {
    await promote(env, dependencies);
    log('Vercel promotion confirmed for the verified candidate.');
    return 0;
  } catch (error) {
    // Only our fixed diagnostics can reach logs; never emit raw transport errors.
    log(
      error instanceof PromotionError
        ? error.message
        : 'Vercel promotion failed.',
    );
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main();
