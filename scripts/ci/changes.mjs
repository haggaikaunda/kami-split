import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

export const conservative = () => ({
  web_changed: true,
  api_changed: true,
  shared_changed: true,
  deployment_changed: true,
  docs_only: false,
});

// Unknown paths deliberately affect both consumers. Add exclusions only with
// dependency evidence and a regression test; extensions alone are not evidence.
export function classify(paths) {
  if (!paths.length) return conservative();
  const result = {
    web_changed: false,
    api_changed: false,
    shared_changed: false,
    deployment_changed: false,
    docs_only: true,
  };
  for (const path of paths) {
    if (
      /(^|\/)AGENTS\.md$/.test(path) ||
      /^(README|CONTRIBUTING)\.md$/.test(path) ||
      /^\.github\/(ISSUE_TEMPLATE\/|pull_request_template\.md$)/.test(path) ||
      (/^docs\//.test(path) && /\.(md|png|jpg|jpeg|svg)$/.test(path)) ||
      /^(apps\/(api|web)|packages\/schema)\/README\.md$/.test(path)
    )
      continue;
    result.docs_only = false;
    if (path.startsWith('apps/web/') || path.startsWith('scripts/relay/')) {
      result.web_changed = true;
    } else if (
      path.startsWith('apps/api/') ||
      path.startsWith('supabase/') ||
      /^compose(\.[^/]+)?\.ya?ml$/.test(path) ||
      path === 'sqlc.yaml' ||
      /^scripts\/(db-|check-sqlc|install-db-tools|cloud-run-traffic)/.test(
        path,
      ) ||
      path === 'scripts/tool-versions.env' ||
      path === '.dockerignore' ||
      /^go\.(mod|sum|work|work\.sum)$/.test(path)
    ) {
      result.api_changed = true;
    } else {
      result.web_changed = true;
      result.api_changed = true;
      result.shared_changed = true;
    }
    if (
      path.startsWith('.github/workflows/') ||
      path.startsWith('scripts/deployment/') ||
      path.startsWith('scripts/ci/')
    ) {
      result.deployment_changed = true;
    }
  }
  return result;
}

export function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

export function compare(base, head, cwd) {
  try {
    if (
      ![base, head].every(
        (sha) => /^[a-f0-9]{40}$/.test(sha ?? '') && !/^0+$/.test(sha),
      )
    )
      throw new Error('Missing commit identity');
    git(['merge-base', '--is-ancestor', base, head], cwd);
    // --no-renames includes both deleted and added paths, including moves
    // out of runtime directories. NUL separation preserves unusual filenames.
    const paths = git(
      ['diff', '--name-only', '--no-renames', '-z', base, head, '--'],
      cwd,
    )
      .split('\0')
      .filter(Boolean);
    return classify(paths);
  } catch {
    console.error(
      'Change classification unavailable; selecting all consumers.',
    );
    return conservative();
  }
}

export function classifyEvent(eventName, event, cwd) {
  if (eventName === 'pull_request') {
    const { base, head } = event.pull_request ?? {};
    try {
      // The branch's merge base excludes unrelated changes added to main.
      const mergeBase = git(['merge-base', base.sha, head.sha], cwd);
      return compare(mergeBase, head.sha, cwd);
    } catch {
      return conservative();
    }
  }
  if (eventName === 'push') return compare(event.before, event.after, cwd);
  return conservative();
}

export function output(result) {
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(result)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    );
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  let result;
  try {
    result = classifyEvent(
      process.env.GITHUB_EVENT_NAME,
      JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
    );
  } catch {
    result = conservative();
  }
  output(result);
}
