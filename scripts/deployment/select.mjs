import { execFileSync } from 'node:child_process';

// Only trusted workflow code calls GitHub; PR fields remain data throughout.
export function validateSelection({
  mode,
  sha,
  pr,
  repository,
  request,
  checks,
  runs,
}) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Invalid commit SHA');
  if (mode === 'release') return;
  if (mode !== 'rehearsal') throw new Error('Invalid deployment mode');
  if (!/^[1-9][0-9]{0,9}$/.test(pr ?? '')) throw new Error('Invalid PR number');
  if (
    request.state !== 'open' ||
    request.head.repo?.full_name !== repository ||
    request.base.repo?.full_name !== repository ||
    request.base.ref !== 'main' ||
    request.head.sha !== sha
  )
    throw new Error(
      'Rehearsal requires the current head of an open same-repository PR to main',
    );
  if (
    !checks.some(
      (check) =>
        check.name === 'Verify' &&
        check.app?.slug === 'github-actions' &&
        check.status === 'completed' &&
        check.conclusion === 'success' &&
        runs.some(
          (run) =>
            run.head_sha === sha &&
            run.event === 'pull_request' &&
            run.status === 'completed' &&
            run.conclusion === 'success' &&
            run.check_suite_id === check.check_suite?.id,
        ),
    )
  )
    throw new Error('The selected commit requires successful Verify CI');
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const {
    DEPLOY_MODE: mode,
    DEPLOY_SHA: sha,
    PR_NUMBER: pr,
    GITHUB_REPOSITORY: repository,
  } = process.env;
  const api = (path) =>
    JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }));
  try {
    // Validate input syntax before it can enter an API path.
    if (!/^[a-f0-9]{40}$/.test(sha ?? ''))
      throw new Error('Invalid commit SHA');
    if (mode === 'rehearsal' && !/^[1-9][0-9]{0,9}$/.test(pr ?? ''))
      throw new Error('Invalid PR number');
    const request =
      mode === 'rehearsal' ? api(`repos/${repository}/pulls/${pr}`) : null;
    const checks =
      mode === 'rehearsal'
        ? api(
            `repos/${repository}/commits/${sha}/check-runs?per_page=100&filter=latest`,
          ).check_runs
        : [];
    const runs =
      mode === 'rehearsal'
        ? api(
            `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=pull_request&per_page=100`,
          ).workflow_runs
        : [];
    validateSelection({ mode, sha, pr, repository, request, checks, runs });
    console.log(`Validated ${mode} commit ${sha}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
