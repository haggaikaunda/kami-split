import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, lstatSync } from 'node:fs';

// Reviewed immutable exception. Remove this policy after every environment has
// recorded the migration; never turn it into a general ordering override.
export const recovery = {
  version: '20261022000000',
  file: '20261022000000_banking_background_sync.sql',
  sha256: '720bd285bbee5ed19bfacb65f62c23d4033f42d315beacce0a328af923ee6d2c',
  deployedMaximum: '20261022010000',
};

export function localMigrations(directory) {
  const files = readdirSync(directory).sort();
  if (!files.length) throw new Error('No local migration history');
  const result = new Map();
  for (const file of files) {
    const match = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(file);
    if (
      !match ||
      !lstatSync(`${directory}/${file}`).isFile() ||
      result.has(match[1])
    )
      throw new Error('Invalid local migration history');
    result.set(match[1], {
      file,
      hash: createHash('sha256')
        .update(readFileSync(`${directory}/${file}`))
        .digest('hex'),
    });
  }
  return result;
}

// Pinned Supabase 2.118.0 structured output was observed against the disposable
// database. Force --output-format json; --output json controls status variables.
export function parseHistory(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Error('Invalid migration history JSON');
  }
  if (
    !Array.isArray(document?.migrations) ||
    !document.migrations.length ||
    document.message !== 'Migrations listed'
  )
    throw new Error('Unrecognized remote migration history');
  const seen = new Set();
  return document.migrations.map((row) => {
    if (
      !row ||
      !['local', 'remote'].every(
        (key) =>
          typeof row[key] === 'string' &&
          (row[key] === '' || /^\d{14}$/.test(row[key])),
      ) ||
      (!row.local && !row.remote) ||
      (row.local && row.remote && row.local !== row.remote) ||
      !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(row.time ?? '')
    )
      throw new Error('Unrecognized remote migration history row');
    const version = row.local || row.remote;
    if (seen.has(version))
      throw new Error('Duplicate remote migration history');
    seen.add(version);
    return { version, local: !!row.local, remote: !!row.remote };
  });
}

export function migrationPlan(local, rows) {
  const versions = [...local.keys()].sort();
  if (
    rows.length !== local.size ||
    rows.some((row) => !row.local || !local.has(row.version))
  )
    throw new Error('Unexpected local or remote migration history');
  const remote = rows
    .filter((row) => row.remote)
    .map((row) => row.version)
    .sort();
  if (!remote.length) throw new Error('Missing remote migration history');
  const maximum = remote.at(-1);
  const missing = rows
    .filter((row) => !row.remote)
    .map((row) => row.version)
    .sort();
  const retroactive = missing.filter((version) => version <= maximum);
  if (!retroactive.length) return { includeAll: false, missing };
  if (
    retroactive.length !== 1 ||
    retroactive[0] !== recovery.version ||
    maximum !== recovery.deployedMaximum ||
    versions
      .filter((version) => version <= maximum && version !== recovery.version)
      .some((version) => !remote.includes(version)) ||
    local.get(recovery.version)?.file !== recovery.file ||
    local.get(recovery.version)?.hash !== recovery.sha256
  )
    throw new Error('Out-of-order migration does not match reviewed recovery');
  return { includeAll: true, missing };
}
