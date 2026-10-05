import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSchema, printSchema } from 'graphql';
const root = fileURLToPath(new URL('../../', import.meta.url));
mkdirSync(`${root}/.tools`, { recursive: true });
mkdirSync(`${root}/apps/web/src/lib/relay/__generated__`, { recursive: true });
const schema = readdirSync(`${root}/packages/schema`)
  .filter((name) => name.endsWith('.graphql'))
  .sort()
  .map((name) => readFileSync(`${root}/packages/schema/${name}`, 'utf8'))
  .join('\n');
// These extensions belong to the server. Relay otherwise treats them as
// client-only fields and removes them from the transmitted operations.
writeFileSync(
  `${root}/.tools/relay-schema.graphql`,
  printSchema(buildSchema(schema)),
);
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
