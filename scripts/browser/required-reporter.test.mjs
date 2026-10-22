import assert from 'node:assert/strict';
import { test } from 'node:test';
import Reporter from './required-reporter.mjs';
import { verify } from '../ci/verify.mjs';

for (const status of [
  'passed',
  'failed',
  'skipped',
  'timedOut',
  'interrupted',
]) {
  test(`required browser ${status} propagates through Verify`, () => {
    const reporter = new Reporter();
    reporter.onBegin(
      {},
      { allTests: () => [{ expectedStatus: 'passed', results: [{ status }] }] },
    );
    const result = reporter.onEnd({
      status: status === 'passed' || status === 'skipped' ? 'passed' : 'failed',
    });
    assert.equal(result.status, status === 'passed' ? 'passed' : 'failed');
    assert.equal(
      verify({
        repository: 'success',
        webRequired: 'true',
        apiRequired: 'false',
        web: result.status === 'passed' ? 'success' : 'failure',
        api: 'skipped',
      }),
      status === 'passed',
    );
  });
}
test('zero discovery and expected failures cannot satisfy required coverage', () => {
  for (const tests of [
    [],
    [{ expectedStatus: 'failed', results: [{ status: 'failed' }] }],
  ]) {
    const reporter = new Reporter();
    reporter.onBegin({}, { allTests: () => tests });
    assert.equal(reporter.onEnd({ status: 'passed' }).status, 'failed');
  }
});

test('an unsuccessful earlier attempt cannot be masked by a later pass', () => {
  const reporter = new Reporter();
  reporter.onBegin(
    {},
    {
      allTests: () => [
        {
          expectedStatus: 'passed',
          results: [{ status: 'failed' }, { status: 'passed' }],
        },
      ],
    },
  );
  assert.equal(reporter.onEnd({ status: 'passed' }).status, 'failed');
});

test('startup failure, unrun cases and aggregate interruption remain failures', () => {
  const reporter = new Reporter();
  assert.equal(reporter.onEnd({ status: 'failed' }).status, 'failed');
  reporter.onBegin(
    {},
    { allTests: () => [{ expectedStatus: 'passed', results: [] }] },
  );
  assert.equal(reporter.onEnd({ status: 'passed' }).status, 'failed');
  reporter.onBegin(
    {},
    {
      allTests: () => [
        { expectedStatus: 'passed', results: [{ status: 'passed' }] },
      ],
    },
  );
  for (const status of ['failed', 'timedout', 'interrupted'])
    assert.equal(reporter.onEnd({ status }).status, status);
});
