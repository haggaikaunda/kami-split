// A skipped test is a missing required journey, even when Playwright calls it OK.
export default class RequiredCoverageReporter {
  onBegin(_config, suite) {
    this.tests = suite.allTests();
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
    if (missing) {
      console.error(
        'Browser coverage failed: no tests, a skip, or an unsuccessful attempt.',
      );
      return { status: 'failed' };
    }
    return { status: result.status };
  }
}
