import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compare, git } from '../ci/changes.mjs';

const validator = '.tools/skills-validator/bin/python';
const expectedOrigins = new Set([
  'https://github.com/haggaikaunda/kami-split.git',
  'git@github.com:haggaikaunda/kami-split.git',
]);

// Never print raw probe output: even Git remotes and Docker errors can contain
// credentials or unrelated workstation data. No shell or install command here.
export function probe(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      GOTOOLCHAIN: 'local',
      COREPACK_ENABLE_NETWORK: '0',
      COREPACK_ENABLE_AUTO_PIN: '0',
      PYTHONDONTWRITEBYTECODE: '1',
    },
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function portState(port) {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = (state) => {
      socket.destroy();
      done(state);
    };
    socket.setTimeout(1000, () => finish('unknown'));
    socket.once('connect', () => finish('occupied'));
    socket.once('error', (error) =>
      finish(error.code === 'ECONNREFUSED' ? 'available' : 'unknown'),
    );
  });
}

export function candidate(cwd, base, ownedIdle) {
  const issues = [];
  let head, decisions;
  try {
    if (
      realpathSync(cwd) !==
      realpathSync(git(['rev-parse', '--show-toplevel'], cwd))
    )
      issues.push('Run from the repository root.');
    if (!expectedOrigins.has(git(['remote', 'get-url', 'origin'], cwd)))
      issues.push(
        'Wrong origin: use the approved Kami Split checkout; inspect the remote privately.',
      );
    head = git(['rev-parse', 'HEAD'], cwd);
    if (!/^[a-f0-9]{40}$/.test(base ?? '')) throw new Error('baseline');
    git(['merge-base', '--is-ancestor', base, head], cwd);
    decisions = compare(base, head, cwd);
    if (git(['status', '--porcelain', '--untracked-files=all'], cwd))
      issues.push(
        'Dirty checkout: preserve and commit intended work before verification; do not stash/reset/clean implicitly.',
      );
    if (git(['branch', '--show-current'], cwd) === 'main')
      issues.push('Use an owned feature checkout, not primary main.');
    for (const name of [
      'MERGE_HEAD',
      'CHERRY_PICK_HEAD',
      'REVERT_HEAD',
      'rebase-merge',
      'rebase-apply',
      'index.lock',
    ]) {
      const path = git(['rev-parse', '--git-path', name], cwd);
      if (existsSync(resolve(cwd, path)))
        issues.push(
          'Git operation or lock present: coordinate with its owner before continuing.',
        );
    }
  } catch {
    issues.push(
      'Repository/baseline unavailable: supply the recorded full ancestor SHA after coordinator fetch/prune and synchronization.',
    );
  }
  if (!ownedIdle)
    issues.push(
      'Ownership unknown: coordinate exclusive checkout and output access, stop only owned previews/checks, then pass --owned-idle.',
    );
  for (const path of [
    'apps/web',
    'apps/web/.next',
    'test-results',
    'test-results/browser',
  ]) {
    if (
      existsSync(join(cwd, path)) &&
      lstatSync(join(cwd, path)).isSymbolicLink()
    )
      issues.push(
        'Shared output path: use real checkout-local web and test-results directories.',
      );
  }
  if (
    existsSync(join(cwd, 'apps/web/.next/lock')) ||
    existsSync(join(cwd, 'apps/web/.next/dev/lock'))
  )
    issues.push(
      'Next output lock present: coordinate with the owning process; do not remove its lock.',
    );
  return { base, head, decisions, issues };
}

export async function preflight(
  cwd,
  base,
  ownedIdle,
  { run = probe, ports = portState } = {},
) {
  const result = candidate(cwd, base, ownedIdle);
  const { issues, decisions } = result;
  if (!decisions) return result;
  const json = (path) => JSON.parse(readFileSync(join(cwd, path), 'utf8'));
  const pkg = json('package.json');
  const node = readFileSync(join(cwd, '.nvmrc'), 'utf8').trim();
  if (process.versions.node.split('.')[0] !== node)
    issues.push(`Select Node ${node} on PATH before running checks.`);
  const pnpm = pkg.packageManager.split('@')[1];
  result.pins = {
    node,
    pnpm,
    database: 'scripts/tool-versions.env',
    validator: 'scripts/agents/requirements.txt',
  };
  result.configuration =
    'Synthetic browser and disposable database harnesses need no application credentials; preflight reads no .env values.';
  if (run('pnpm', ['--version'], cwd) !== pnpm)
    issues.push(
      `pnpm unavailable, inaccessible or mismatched: select pinned pnpm ${pnpm}; no installation was attempted.`,
    );
  for (const directory of ['', 'apps/web']) {
    const manifest = json(join(directory, 'package.json'));
    for (const [name, version] of Object.entries({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    })) {
      try {
        const installed = json(
          join(directory, 'node_modules', name, 'package.json'),
        ).version;
        if (/^\d/.test(version) && installed !== version)
          throw new Error('version');
      } catch {
        issues.push(
          'Workspace dependency missing/mismatched: run pnpm install --frozen-lockfile in this owned checkout.',
        );
        break;
      }
    }
  }
  if (
    run(
      validator,
      ['-c', 'import skills_ref, strictyaml, markdown_it, jsonschema'],
      cwd,
    ) === null
  )
    issues.push(
      'Pinned Python validator unavailable: follow docs/agents/skill-authoring.md#objective-checks-from-a-fresh-checkout.',
    );
  if (decisions.verify_web) {
    try {
      const require = createRequire(join(cwd, 'package.json'));
      const { chromium } = require('@playwright/test');
      if (!existsSync(chromium.executablePath())) throw new Error('browser');
    } catch {
      issues.push(
        'Managed Chromium missing: run pnpm exec playwright install chromium (Linux: --with-deps).',
      );
    }
    // Import the existing browser settings rather than duplicating its defaults.
    try {
      const { webPort, authPort } = await import(
        pathToFileURL(join(cwd, 'scripts/browser/settings.mjs'))
      );
      for (const port of [webPort, authPort]) {
        if ((await ports(port)) !== 'available')
          issues.push(
            `Browser port ${port} occupied or unavailable: choose distinct unused BROWSER_PORT/BROWSER_AUTH_PORT; never reuse/kill an unowned server.`,
          );
      }
    } catch {
      issues.push(
        'Invalid browser settings: use distinct ports 1024–65535; see docs/browser-verification.md.',
      );
    }
    if (process.env.BROWSER_OUTPUT_DIR)
      issues.push(
        'Unset BROWSER_OUTPUT_DIR for this helper; it uses owned checkout-local test-results/browser.',
      );
  }
  if (decisions.verify_api) {
    for (const path of [
      'supabase/config.toml',
      'supabase/seeds/local.sql',
      'sqlc.yaml',
      'compose.yaml',
      'compose.database.yaml',
    ]) {
      if (!existsSync(join(cwd, path)))
        issues.push(
          `Missing required harness configuration: ${path}; restore the approved tracked input.`,
        );
    }
    const go = readFileSync(join(cwd, 'apps/api/go.mod'), 'utf8').match(
      /^go (\S+)/m,
    )[1];
    if (!run('go', ['version'], cwd)?.startsWith(`go version go${go} `))
      issues.push(
        `Go ${go} unavailable/mismatched: select the pinned toolchain and prepare its module cache; sandbox/cache failures require an owning permission action.`,
      );
    for (const command of ['make', 'python3']) {
      if (run(command, ['--version'], cwd) === null)
        issues.push(
          `${command} unavailable/inaccessible: install database prerequisites from docs/application/database-development.md.`,
        );
    }
    if (run('python3', ['-c', 'import tomllib'], cwd) === null)
      issues.push('Database harness needs Python 3.11+ (tomllib).');
    for (const tool of ['supabase', 'sqlc']) {
      if (!existsSync(join(cwd, '.tools', tool)))
        issues.push(
          `Missing .tools/${tool}: run make db-tools for scripts/tool-versions.env pins. Version validation occurs in db-tool.sh; preflight does not invoke Supabase telemetry.`,
        );
    }
    const containers = run('docker', ['ps', '--format', '{{.Names}}'], cwd);
    if (containers === null)
      issues.push(
        'Docker unavailable/inaccessible: start the owned daemon or resolve sandbox permissions; no containers were changed.',
      );
    else {
      result.database = containers
        .split('\n')
        .filter((name) => name.startsWith('supabase_db_')).length;
      // Database tests choose unique projects/ports. Existing stacks are not
      // reclaimed; caller coordinates host capacity before starting another.
    }
  }
  return result;
}

function nodeTests(directory) {
  return [
    'node',
    '--test',
    ...readdirSync(directory)
      .filter((name) => name.endsWith('.test.mjs'))
      .sort()
      .map((name) => `${directory}/${name}`),
  ];
}

export function verificationPlan(decisions) {
  const steps = [
    ['pnpm', 'relay:check'],
    ['pnpm', 'format:check'],
    ['pnpm', 'lint'],
    ['pnpm', 'typecheck'],
    ['pnpm', 'test'],
    ['pnpm', 'build'],
    nodeTests('scripts/ci'),
    nodeTests('scripts/agents'),
    [validator, 'scripts/agents/check_skills.py'],
    [
      validator,
      '-m',
      'unittest',
      'discover',
      '-s',
      'scripts/agents',
      '-p',
      '*_test.py',
    ],
  ];
  if (decisions.verify_web)
    steps.push(
      ['node', '--test', 'scripts/vercel-promote.test.mjs'],
      nodeTests('scripts/browser'),
      ['pnpm', 'test:browser'],
    );
  if (decisions.verify_api)
    steps.push(
      ['bash', 'scripts/cloud-run-traffic-flag-test.sh'],
      nodeTests('scripts/deployment'),
      ['make', 'api-check'],
      ['make', 'db-generation-check'],
      ['make', 'db-test'],
    );
  return steps;
}

export function executePlan(
  steps,
  cwd,
  { run = spawnSync, report = console.log } = {},
) {
  for (const [command, ...args] of steps) {
    report(`Running: ${[command, ...args].join(' ')}`);
    const result = run(command, args, {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        BROWSER_SKIP_BUILD: '1',
        PYTHONDONTWRITEBYTECODE: '1',
      },
    });
    if (result.status !== 0 || result.error || result.signal) {
      report(
        `Failed: ${command} ${args.join(' ')}; later checks did not run. Inspect the owning command diagnostic; permission/cache failures are not a passing check.`,
      );
      return Number.isInteger(result.status) && result.status > 0
        ? result.status
        : 1;
    }
  }
  return 0;
}

async function main() {
  const [mode, base, ownership, ...extra] = process.argv.slice(2);
  if (
    !['preflight', 'verify'].includes(mode) ||
    (ownership && ownership !== '--owned-idle') ||
    extra.length
  )
    throw new Error('usage');
  const cwd = realpathSync(process.cwd());
  const result = await preflight(cwd, base, ownership === '--owned-idle');
  console.log(JSON.stringify(result, null, 2));
  if (result.issues.length) return 1;
  const plan = verificationPlan(result.decisions);
  console.log(
    'Root policy checks always run; classifier adds browser/API checks. Commands run serially:',
  );
  for (const step of plan) console.log(`  ${step.join(' ')}`);
  console.log(
    'Browser harness owns its services. db-test owns a unique disposable project/ports; existing stacks are preserved. Coordinate host capacity.',
  );
  console.log(
    'This is local verification only: applicable container/Compose startup remains required in isolated API CI, plus independent testing/review and final-head Verify.',
  );
  if (mode === 'preflight') return 0;
  // Recheck immediately before effects; the assertion is coordination, not a lock.
  const current = candidate(cwd, base, true);
  if (current.issues.length || current.head !== result.head) {
    console.error(
      'Candidate changed during preflight; coordinate ownership and rerun for the current head.',
    );
    return 1;
  }
  return executePlan(plan, cwd);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    process.exitCode = await main();
  } catch {
    console.error(
      'Cannot inspect execution prerequisites. Run from repository root: node scripts/agents/execution.mjs preflight|verify <recorded-base-sha> [--owned-idle]. See docs/agents/execution.md; no raw probe/configuration data was printed.',
    );
    process.exitCode = 1;
  }
}
