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
  const before = await getProject();
  const previousRequest = before.lastAliasRequest?.requestedAt ?? 0;
  requireCondition(
    Number.isFinite(previousRequest) && previousRequest >= 0,
    'Invalid previous promotion timestamp.',
  );
  await api(
    `/v10/projects/${encodeURIComponent(projectId)}/promote/${encodeURIComponent(deployment.id)}`,
    'POST',
  );
  for (;;) {
    const project = await getProject();
    const state = project.lastAliasRequest;
    // A queued request may not yet have replaced the previous alias request.
    if (state != null) {
      requireCondition(
        ['pending', 'in-progress', 'succeeded', 'failed', 'skipped'].includes(
          state.jobStatus,
        ) &&
          Number.isFinite(state.requestedAt) &&
          state.requestedAt > 0,
        'Unknown or malformed promotion state.',
      );
      if (state.requestedAt > previousRequest) {
        requireCondition(
          state.type === 'promote' && state.toDeploymentId === deployment.id,
          'Promotion refers to a different deployment or operation.',
        );
        requireCondition(
          state.jobStatus !== 'failed' && state.jobStatus !== 'skipped',
          'Promotion failed or was skipped.',
        );
        if (state.jobStatus === 'succeeded') {
          requireCondition(
            project.targets?.production?.id === deployment.id,
            'Promoted production target does not match the candidate.',
          );
          return deployment.id;
        }
      }
    }
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
