import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
mkdirSync(`${root}/.tools`, { recursive: true });
mkdirSync(`${root}/apps/web/src/lib/relay/__generated__`, { recursive: true });
const schema = readdirSync(`${root}/packages/schema`)
  .filter((name) => name.endsWith('.graphql'))
  .sort()
  .map((name) => readFileSync(`${root}/packages/schema/${name}`, 'utf8'))
  .join('\n');
writeFileSync(`${root}/.tools/relay-schema.graphql`, schema);
const result = spawnSync(
  'pnpm',
  [
    '--filter',
    '@kami-split/web',
    'exec',
    'relay-compiler',
    ...(process.argv.includes('--validate') ? ['--validate'] : []),
  ],
  { cwd: root, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
