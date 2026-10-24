import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyEnvironment } from './ci-environment.mjs';

const environment = {
  declaredVersion: '1.64.0',
  installedVersion: '1.64.0',
  image: {
    driverVersion: '1.64.0',
    dockerImageName: 'mcr.microsoft.com/playwright:v1.64.0-noble',
  },
  nodeVersion: '24.19.0',
  nodeMajor: '24',
  browsersPath: '/ms-playwright',
};

test('matching pinned dependency, image, Node and browser location are accepted', () => {
  assert.doesNotThrow(() => verifyEnvironment(environment));
});

for (const [name, change, message] of [
  ['ranged dependency', { declaredVersion: '^1.64.0' }, /Pin @playwright/],
  ['installed dependency drift', { installedVersion: '1.64.1' }, /Installed/],
  [
    'image patch mismatch',
    { image: { ...environment.image, driverVersion: '1.64.1' } },
    /image mismatch/,
  ],
  [
    'different OS image',
    {
      image: {
        ...environment.image,
        dockerImageName: 'mcr.microsoft.com/playwright:v1.64.0-jammy',
      },
    },
    /official Noble/,
  ],
  ['absent image metadata', { image: {} }, /image mismatch/],
  ['wrong Node major', { nodeVersion: '22.22.0' }, /Node major/],
  ['default browser cache', { browsersPath: undefined }, /prebuilt browser/],
]) {
  test(`rejects ${name} before running the suite`, () => {
    assert.throws(
      () => verifyEnvironment({ ...environment, ...change }),
      message,
    );
  });
}
