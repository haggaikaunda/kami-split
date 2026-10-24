import { relative } from 'node:path';

// Project + full suite path distinguish repeated titles and viewport executions.
export function executionKey(test, rootDir) {
  return JSON.stringify([
    relative(rootDir, test.location.file).replaceAll('\\', '/'),
    test.titlePath(),
  ]);
}

export function inventory(tests, rootDir) {
  return tests.map((test) => executionKey(test, rootDir)).sort();
}
