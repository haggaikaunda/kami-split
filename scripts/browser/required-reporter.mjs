import { readFileSync, writeFileSync } from 'node:fs';
import { executionKey } from './inventory.mjs';

// A skipped test is a missing required journey, even when Playwright calls it OK.
export default class RequiredCoverageReporter {
  onBegin(_config, suite) {
    this.tests = suite.allTests();
    this.rootDir = _config.rootDir;
  }
  onEnd(result) {
    const missing =
      !this.tests?.length ||
      this.tests.some(
        (test) =>
          test.expectedStatus !== 'passed' ||
          !test.results.length ||
          test.results.some((attempt) => attempt.status !== 'passed'),
      );
    if (process.env.BROWSER_COVERAGE_FILE) {
      const manifest = JSON.parse(
        readFileSync(process.env.BROWSER_BUILD_MANIFEST, 'utf8'),
      );
      writeFileSync(
        process.env.BROWSER_COVERAGE_FILE,
        JSON.stringify({
          partition: Number(process.env.BROWSER_PARTITION),
          count: Number(process.env.BROWSER_PARTITIONS),
          revision: manifest.revision,
          archiveDigest: manifest.archiveDigest,
          buildId: manifest.buildId,
          status: missing ? 'failed' : result.status,
          tests: (this.tests ?? []).map((test) => ({
            key: executionKey(test, this.rootDir),
            expectedStatus: test.expectedStatus,
            attempts: test.results.map((attempt) => attempt.status),
          })),
        }),
      );
    }
    if (missing) {
      console.error(
        'Browser coverage failed: no tests, a skip, or an unsuccessful attempt.',
      );
      return { status: 'failed' };
    }
    return { status: result.status };
  }
}
