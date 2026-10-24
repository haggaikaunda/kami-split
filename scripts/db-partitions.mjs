import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Packages sharing a provider/cluster remain serial: permission probes mutate
// cluster roles. Each CI lane starts an entirely separate Supabase project.
export const partitions = {
  banking: ['database', 'auth', 'profile', 'banking'],
  expenses: ['invitation', 'expense', 'graph', 'onboarding', 'bootstrap'],
};
export const modes = ['migrations', ...Object.keys(partitions)];

// These existing opt-in/provider-preview checks and subprocess entry points
// are skipped by the full serial command too. Every other skip fails closed.
const optionalTests = new Map([
  ['banking/TestInitialConsumerCrashHelper', 'child process only'],
  ['banking/TestLifecycleWorkerCrashHelper', 'child process only'],
  ['banking/TestSyncSandboxContract', 'opt-in Sandbox contract check disabled'],
  ['banking/TestInitialSandboxConsumer', 'opt-in Sandbox consumer disabled'],
  ['banking/TestBackgroundSandboxConsumer', 'opt-in Sandbox consumer disabled'],
  [
    'expense/TestPercentageRealBrowserJourney',
    'optional browser evidence requires a production web preview',
  ],
  [
    'expense/TestEditRealBrowserJourney',
    'optional browser evidence requires a production web preview',
  ],
  [
    'graph/TestBankingDetailRealBrowserJourney',
    'optional real browser journey requires an owned production preview',
  ],
  [
    'graph/TestBankingManagementRealBrowserJourney',
    'opt-in bridge requires an exclusively owned production preview; this skip is not acceptance evidence',
  ],
]);

export function validateProject(project) {
  assert.match(project, /^kami-split-test-[a-z0-9-]+$/);
  // Supabase silently truncates longer IDs, breaking container lookup/cleanup.
  assert.ok(
    project.length <= 40,
    'Database project exceeds Supabase identity limit',
  );
}

export function discover(root = 'apps/api') {
  // Discover tagged integration tests anywhere, plus every test-bearing package
  // covered by the original recursive database command (including profile).
  const packages = new Set();
  // These roots are the pre-partition command's recursive package arguments.
  // Include untagged test-bearing descendants too, so their addition needs an
  // explicit lane assignment rather than silently losing existing coverage.
  const legacyRoots = [
    'database',
    'auth',
    'invitation',
    'expense',
    'graph',
    'onboarding',
    'bootstrap',
    'profile',
    'banking',
  ];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('_test.go')) {
        const source = readFileSync(path, 'utf8');
        const constraint = source.match(/^\/\/go:build (.+)$/m)?.[1];
        const packagePath = relative(resolve(root), dirname(path));
        if (constraint && /\bintegration\b/.test(constraint)) {
          // New platform/compound constraints require an explicit inventory audit.
          assert.equal(
            constraint,
            'integration',
            'Audit integration build constraint',
          );
          packages.add(`./${packagePath}`);
        }
        if (
          legacyRoots.some(
            (name) =>
              packagePath === `internal/${name}` ||
              packagePath.startsWith(`internal/${name}/`),
          )
        )
          packages.add(`./${packagePath}`);
      }
    }
  }
  visit(resolve(root));
  assert.ok(packages.size, 'Empty integration discovery');
  return [...packages].sort();
}

export function selection(mode, inventory = discover()) {
  assert.ok(
    mode === 'all' || modes.includes(mode),
    'Unknown database test mode',
  );
  const assigned = Object.values(partitions)
    .flat()
    .map((name) => `./internal/${name}`);
  assert.equal(
    new Set(assigned).size,
    assigned.length,
    'Duplicate integration assignment',
  );
  assert.deepEqual(
    [...assigned].sort(),
    inventory,
    'Integration partition union differs from discovery',
  );
  return mode === 'migrations'
    ? []
    : mode === 'all'
      ? assigned
      : partitions[mode].map((name) => `./internal/${name}`);
}

export function passedPackages(events, expected) {
  const actual = [];
  const outputs = new Map();
  const modulePath = readFileSync('apps/api/go.mod', 'utf8').match(
    /^module (\S+)/m,
  )[1];
  for (const event of events) {
    assert.notEqual(event.Action, 'fail', 'Failed integration execution');
    const key = `${event.Package?.slice(modulePath.length + '/internal/'.length)}/${event.Test}`;
    if (event.Output) outputs.set(key, (outputs.get(key) || '') + event.Output);
    if (event.Action === 'skip') {
      const reason = optionalTests.get(key);
      assert.ok(
        reason && outputs.get(key)?.includes(reason),
        'Unexpected skipped integration execution or reason',
      );
    }
    if (event.Action === 'pass' && !event.Test) {
      assert.ok(
        event.Package.startsWith(`${modulePath}/`),
        'Unexpected package outside API module',
      );
      actual.push(`./${event.Package.slice(modulePath.length + 1)}`);
    }
  }
  assert.equal(
    new Set(actual).size,
    actual.length,
    'Duplicate package execution',
  );
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    'Missing or unexpected integration package execution',
  );
  return actual;
}

export function validatePopulation(mode, population) {
  if (mode === 'migrations') {
    assert.equal(
      population,
      null,
      'Migration lane has no integration fixture claim',
    );
    return;
  }
  const required = ['users', 'authUsers'];
  if (mode === 'all' || mode === 'banking')
    required.push('bankingSources', 'bankingRevisions');
  if (mode === 'all' || mode === 'expenses')
    required.push('expenses', 'financialRecords', 'allocations');
  for (const field of required)
    assert.ok(
      Number.isSafeInteger(population?.[field]) && population[field] > 0,
      `Missing populated integration fixture: ${field}`,
    );
}

export function aggregate(reports, revision, results, inventory = discover()) {
  assert.match(
    revision,
    /^[a-f0-9]{40}$/,
    'Missing expected database revision',
  );
  assert.ok(
    results.length === 4 && results.every((result) => result === 'success'),
    'Every API job must succeed',
  );
  assert.equal(
    reports.length,
    modes.length,
    'Missing or extra database reports',
  );
  assert.deepEqual(
    reports.map((report) => report.mode).sort(),
    [...modes].sort(),
    'Missing or duplicate database mode',
  );
  assert.equal(
    new Set(reports.map((report) => report.project)).size,
    modes.length,
    'Database projects must be independent',
  );
  const actual = [];
  for (const report of reports) {
    assert.equal(report.revision, revision, 'Database revision mismatch');
    assert.equal(report.status, 'passed', 'Incomplete database verification');
    validateProject(report.project);
    validatePopulation(report.mode, report.population);
    assert.ok(
      Number.isInteger(report.port) && report.port > 0 && report.port < 65536,
      'Missing database port',
    );
    assert.deepEqual(
      report.inventory,
      inventory,
      'Database discovery mismatch',
    );
    const expected = selection(report.mode, inventory);
    assert.deepEqual(
      [...report.packages].sort(),
      [...expected].sort(),
      'Database lane coverage mismatch',
    );
    actual.push(...report.packages);
  }
  assert.equal(
    new Set(actual).size,
    actual.length,
    'Duplicate database coverage',
  );
  assert.deepEqual(actual.sort(), inventory, 'Missing database coverage');
}

function main() {
  const [command, mode, ...args] = process.argv.slice(2);
  const inventory = discover();
  if (command === 'select') {
    console.log(selection(mode, inventory).join('\n'));
  } else if (command === 'population') {
    validatePopulation(mode, JSON.parse(readFileSync(args[0], 'utf8')));
  } else if (command === 'project') {
    validateProject(mode);
  } else if (command === 'report') {
    const [project, port, eventsFile, populationFile] = args;
    const expected = selection(mode, inventory);
    const events = eventsFile
      ? readFileSync(eventsFile, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
    const packages = passedPackages(events, expected);
    const population = populationFile
      ? JSON.parse(readFileSync(populationFile, 'utf8'))
      : null;
    validatePopulation(mode, population);
    const directory = resolve(
      process.env.DB_TEST_REPORT_DIR || 'test-results/database',
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      resolve(directory, `${mode}.json`),
      JSON.stringify({
        mode,
        project,
        port: Number(port),
        inventory,
        packages,
        population,
        status: 'passed',
        revision: execFileSync('git', ['rev-parse', 'HEAD'], {
          encoding: 'utf8',
        }).trim(),
      }),
    );
  } else if (command === 'aggregate') {
    const directory = resolve(mode || 'test-results/database');
    const reports = readdirSync(directory)
      .filter((file) => file.endsWith('.json'))
      .map((file) =>
        JSON.parse(readFileSync(resolve(directory, file), 'utf8')),
      );
    aggregate(
      reports,
      process.env.GITHUB_SHA,
      [
        process.env.SOURCE_RESULT,
        process.env.MIGRATIONS_RESULT,
        process.env.INTEGRATION_RESULT,
        process.env.RUNTIME_RESULT,
      ],
      inventory,
    );
    console.log(
      'Migration checks and every discovered integration package passed in independent database projects.',
    );
  } else throw new Error('Unknown database partition command');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
