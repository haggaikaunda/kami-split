import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix, matchesGlob } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { classify, git } from './changes.mjs';

// These are objective guards for the classifier's exemptions, not a general
// dependency analyzer. New loaders/generators require a fresh rule audit.
function referencedPaths(file, literal) {
  if (literal.startsWith('@/')) return [`apps/web/src/${literal.slice(2)}`];
  if (!literal.startsWith('.')) return [];
  return [posix.normalize(posix.join(posix.dirname(file), literal))];
}
function webBoundaryViolations(file, source, nonDeploying) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const failures = [];
  const testOnly = nonDeploying.has(file);
  function visit(node) {
    if (
      testOnly &&
      ts.isTaggedTemplateExpression(node) &&
      /(^|\.)graphql$/.test(node.tag.getText(ast))
    )
      failures.push('test-only file supplies Relay generation input');
    if (!testOnly && ts.isStringLiteralLike(node)) {
      for (const path of referencedPaths(file, node.text)) {
        for (const candidate of [
          path,
          ...[
            '.ts',
            '.tsx',
            '.js',
            '.mjs',
            '.cjs',
            '/index.ts',
            '/index.tsx',
          ].map((ext) => path + ext),
        ]) {
          if (nonDeploying.has(candidate))
            failures.push(`production reference to ${candidate}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return failures;
}

test('runtime references and generation cannot hide behind a unit-test exemption', () => {
  const exempt = new Set([
    'apps/web/src/lib/value.test.ts',
    'apps/web/src/lib/fixture.test.tsx',
  ]);
  for (const source of [
    "import {value} from './value.test';",
    "export {value} from '@/lib/value.test';",
    "const value = import('./value.test');",
    "const value = require('./value.test.ts');",
    "const value = new URL('./value.test.ts', import.meta.url);",
  ])
    assert.ok(
      webBoundaryViolations('apps/web/src/lib/runtime.ts', source, exempt)
        .length,
      source,
    );
  assert.ok(
    webBoundaryViolations(
      'apps/web/src/lib/value.test.ts',
      'const query = graphql`query Test { health { status } }`;',
      exempt,
    ).length,
  );
  assert.deepEqual(
    webBoundaryViolations(
      'apps/web/src/lib/value.test.ts',
      "import './fixture.test';",
      exempt,
    ),
    [],
  );
  assert.deepEqual(
    webBoundaryViolations(
      'apps/web/src/lib/runtime.ts',
      "import './value';",
      exempt,
    ),
    [],
  );
});

test('current runtime and Relay inputs respect non-deploying test/tooling boundaries', () => {
  const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
  const nonDeploying = new Set(
    files.filter((file) => {
      const result = classify([file]);
      return !result.deploy_web && !result.deploy_api;
    }),
  );
  for (const file of files.filter(
    (file) =>
      /^apps\/web\/.*\.tsx?$/.test(file) ||
      file === 'scripts/relay/generate.mjs',
  )) {
    assert.deepEqual(
      webBoundaryViolations(file, readFileSync(file, 'utf8'), nonDeploying),
      [],
      file,
    );
  }
  // The Go compiler excludes *_test.go, but go:embed could reintroduce them.
  // Any new embed pattern must remain disjoint from exempt files.
  for (const file of files.filter(
    (file) => /^apps\/api\/.*\.go$/.test(file) && !file.endsWith('_test.go'),
  )) {
    const source = readFileSync(file, 'utf8');
    for (const line of source.matchAll(/^\/\/go:embed\s+(.+)$/gm)) {
      const patterns = line[1]
        .split(/\s+/)
        .map((pattern) => pattern.replace(/^all:/, '').replace(/^"|"$/g, ''));
      for (const candidate of nonDeploying) {
        const relative = posix.relative(posix.dirname(file), candidate);
        assert.ok(
          !patterns.some(
            (pattern) =>
              matchesGlob(relative, pattern) ||
              relative.startsWith(`${pattern}/`),
          ),
          `${file} embeds non-deploying ${candidate}`,
        );
      }
    }
  }
});
