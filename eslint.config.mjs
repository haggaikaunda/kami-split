import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  { settings: { next: { rootDir: 'apps/web/' } } },
  globalIgnores([
    '**/.next/**',
    '**/relay/__generated__/**',
    '**/coverage/**',
    '**/playwright-report/**',
    'docs/design/prototype/**',
  ]),
]);
