import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { compare, conservative, git, output } from './changes.mjs';
import { validResult } from './verify.mjs';

export const context = 'kami-split/api-release';
export const released = 'API release succeeded';
export const unnecessary = 'API release not required';

// A success is published only after every applicable release branch succeeds.
// This baseline therefore retains both API and legacy-web work after failures.
export function successfulBaseline(statuses) {
  const latest = statuses.find((status) => status.context === context);
  return (
    latest?.creator?.login === 'github-actions[bot]' &&
    latest.state === 'success' &&
    [released, unnecessary].includes(latest.description)
  );
}

export function releaseResult({ plan, apiRequired, webRequired, api, web }) {
  const success =
    plan === 'success' &&
    validResult(apiRequired, api) &&
    validResult(webRequired, web);
  return {
    state: success ? 'success' : 'failure',
    description: success
      ? apiRequired === 'true'
        ? released
        : unnecessary
      : 'Required release or classification failed',
  };
}

// Include every transition since the successful baseline, not just the net
// diff: an unsuccessful release may already have promoted one service. A later
// revert must actively restore that service even when its final files match base.
export function compareReleases(base, head, cwd) {
  try {
    git(['merge-base', '--is-ancestor', base, head], cwd);
    const commits = git(['rev-list', '--first-parent', `${base}..${head}`], cwd)
      .split('\n')
      .filter(Boolean);
    if (!commits.length) return conservative();
    const changes = commits.map((commit) =>
      compare(git(['rev-parse', `${commit}^`], cwd), commit, cwd),
    );
    return {
      web_changed: changes.some((change) => change.web_changed),
      api_changed: changes.some((change) => change.api_changed),
      shared_changed: changes.some((change) => change.shared_changed),
      deployment_changed: changes.some((change) => change.deployment_changed),
      docs_only: changes.every((change) => change.docs_only),
    };
  } catch {
    return conservative();
  }
}

export function planRelease({
  sha,
  ancestors,
  statuses,
  diff = compareReleases,
}) {
  try {
    // Bounded search: no authenticated baseline is a full release, never a skip.
    const base = ancestors.find((ancestor) =>
      successfulBaseline(statuses(ancestor)),
    );
    return base ? diff(base, sha) : conservative();
  } catch {
    return conservative();
  }
}

function api(path, fields) {
  return JSON.parse(
    execFileSync(
      'gh',
      ['api', path, ...(fields ? ['--method', 'POST', '--input', '-'] : [])],
      {
        encoding: 'utf8',
        input: fields ? JSON.stringify(fields) : undefined,
      },
    ),
  );
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const run = event.workflow_run;
  const repository = process.env.GITHUB_REPOSITORY;
  const sha = run?.head_sha;
  if (
    !/^[a-f0-9]{40}$/.test(sha ?? '') ||
    run.event !== 'push' ||
    run.head_branch !== 'main' ||
    run.head_repository?.full_name !== repository ||
    run.conclusion !== 'success'
  ) {
    throw new Error('Release requires successful same-repository main push CI');
  }
  const publish = (result) =>
    api(`repos/${repository}/statuses/${sha}`, {
      ...result,
      context,
      target_url: `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    });
  if (process.argv[2] === 'plan') {
    publish({
      state: 'pending',
      description: 'Evaluating required production release',
    });
    // Queue order is not commit order. A delayed older CI run must not roll back
    // a newer main release; the newer run will include all unreleased changes.
    const main = api(`repos/${repository}/git/ref/heads/main`).object.sha;
    if (main !== sha)
      throw new Error(
        'Superseded main commit; release the newest verified main instead',
      );
    let result;
    try {
      const ancestors = git([
        'rev-list',
        '--first-parent',
        '--max-count=100',
        `${sha}^`,
      ]).split('\n');
      result = planRelease({
        sha,
        ancestors,
        statuses: (ancestor) =>
          api(`repos/${repository}/commits/${ancestor}/statuses?per_page=100`),
      });
    } catch {
      result = conservative();
    }
    output(result);
  } else if (process.argv[2] === 'finish') {
    const e = process.env;
    const result = releaseResult({
      plan: e.PLAN_RESULT,
      apiRequired: e.API_REQUIRED,
      webRequired: e.WEB_REQUIRED,
      api: e.API_RESULT,
      web: e.WEB_RESULT,
    });
    publish(result);
    if (result.state !== 'success') process.exitCode = 1;
  } else throw new Error('Unknown release operation');
}
