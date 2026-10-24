import { readFileSync } from 'node:fs';
import { git } from './changes.mjs';

const directory = 'supabase/migrations/';
const shaPattern = /^[a-f0-9]{40}$/;
export function migrationTree(revision, cwd) {
  if (!shaPattern.test(revision ?? '') || /^0+$/.test(revision))
    throw new Error('Invalid migration comparison revision');
  git(['cat-file', '-e', `${revision}^{commit}`], cwd);
  const entries = git(['ls-tree', '-r', '-z', revision, '--', directory], cwd)
    .split('\0')
    .filter(Boolean);
  if (!entries.length) throw new Error('Migration history is unavailable');
  const versions = new Set();
  return new Map(
    entries.map((entry) => {
      const match =
        /^(100644) blob ([a-f0-9]{40})\t(supabase\/migrations\/(\d{14})_[a-z0-9_]+\.sql)$/.exec(
          entry,
        );
      if (!match)
        throw new Error('Malformed migration filename or non-regular SQL file');
      const [, , blob, path, version] = match;
      const timestamp = `${version.slice(0, 4)}-${version.slice(4, 6)}-${version.slice(6, 8)}T${version.slice(8, 10)}:${version.slice(10, 12)}:${version.slice(12, 14)}.000Z`;
      if (
        !Number.isFinite(Date.parse(timestamp)) ||
        new Date(timestamp).toISOString() !== timestamp
      )
        throw new Error(`Malformed migration version: ${version}`);
      if (versions.has(version))
        throw new Error(`Duplicate migration version: ${version}`);
      versions.add(version);
      return [path, { blob, version }];
    }),
  );
}

export function checkMigrations(base, head, cwd, branchBase = base) {
  const target = migrationTree(base, cwd);
  const previous = migrationTree(branchBase, cwd);
  const current = migrationTree(head, cwd);
  const highest = [...target.values()]
    .map(({ version }) => version)
    .sort()
    .at(-1);
  for (const [path, { blob }] of previous)
    if (current.get(path)?.blob !== blob)
      throw new Error(`Existing migration history changed: ${path}`);
  for (const [path, { version }] of current)
    if (!previous.has(path) && version <= highest)
      throw new Error(
        `New migration ${version} must be above comparison-base maximum ${highest}`,
      );
  return { base, head, highest, additions: current.size - previous.size };
}

export function checkEvent(eventName, event, cwd) {
  let base, head;
  if (eventName === 'pull_request') {
    base = event.pull_request?.base?.sha;
    head = event.pull_request?.head?.sha;
    // Detect branch edits against its ancestor, but order new versions against
    // the actual target tip. A stale unrelated branch did not delete target SQL.
    migrationTree(base, cwd);
    migrationTree(head, cwd);
    const branchBase = git(['merge-base', base, head], cwd);
    return checkMigrations(base, head, cwd, branchBase);
  } else if (eventName === 'push') {
    base = event.before;
    head = event.after;
    migrationTree(base, cwd);
    migrationTree(head, cwd);
    git(['merge-base', '--is-ancestor', base, head], cwd);
  } else throw new Error('Unsupported migration comparison event');
  return checkMigrations(base, head, cwd);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    console.log(
      JSON.stringify(
        checkEvent(
          process.env.GITHUB_EVENT_NAME,
          JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
        ),
      ),
    );
  } catch (error) {
    console.error(`Migration history check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
