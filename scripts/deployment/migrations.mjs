import { execFileSync } from 'node:child_process';
import {
  localMigrations,
  migrationPlan,
  parseHistory,
} from './migration-policy.mjs';

export function pushMigrations({
  mode,
  target = ['--linked'],
  workdir,
  directory = 'supabase/migrations',
  run,
}) {
  if (!['rehearsal', 'release'].includes(mode))
    throw new Error('Invalid migration mode');
  const args = workdir ? ['--workdir', workdir] : [];
  const history = run([
    'migration',
    'list',
    '--output-format',
    'json',
    ...target,
    ...args,
  ]);
  const plan = migrationPlan(localMigrations(directory), parseHistory(history));
  console.log(
    JSON.stringify({
      pendingMigrationVersions: plan.missing,
      reviewedRecovery: plan.includeAll,
    }),
  );
  const push = [
    'db',
    'push',
    ...target,
    ...args,
    ...(plan.includeAll ? ['--include-all'] : []),
  ];
  run([...push, '--dry-run']);
  if (mode === 'release') {
    // Re-read immediately before applying. A changed history cannot reuse a
    // previously authorized exception; deployment concurrency owns serialization.
    const fresh = migrationPlan(
      localMigrations(directory),
      parseHistory(
        run([
          'migration',
          'list',
          '--output-format',
          'json',
          ...target,
          ...args,
        ]),
      ),
    );
    if (JSON.stringify(fresh) !== JSON.stringify(plan))
      throw new Error('Migration history changed after dry run');
    run([...push, '--yes']);
    console.log(JSON.stringify({ appliedMigrationVersions: plan.missing }));
  }
  return plan;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    const plan = pushMigrations({
      mode: process.env.DEPLOY_MODE,
      run: (args) =>
        execFileSync('./scripts/db-tool.sh', ['supabase', ...args], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'inherit'],
        }),
    });
    console.log(JSON.stringify(plan));
  } catch (error) {
    // CLI stderr owns diagnostics; do not echo connection strings or raw output.
    console.error(error.status ? 'Migration command failed' : error.message);
    process.exitCode = 1;
  }
}
