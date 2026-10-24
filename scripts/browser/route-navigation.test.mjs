import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRouteNavigation } from './route-navigation.mjs';

const destination = '/groups/F?tab=expenses';
const request = (path, headers = { rsc: '1' }) => ({
  url: () => `http://127.0.0.1:3295${path}`,
  headers: () => headers,
});

test('the exact activation Flight request qualifies with or without a cache key', () => {
  for (const path of [destination, `${destination}&_rsc=activation`]) {
    assert.equal(isRouteNavigation(request(path), destination), true);
  }
});

test('metadata prefetch and neighboring expense routes cannot claim the activation hold', () => {
  const beforeActivation = [
    request(`${destination}&create=F&_rsc=metadata`, {
      rsc: '1',
      'next-router-prefetch': '1',
    }),
    request(`${destination}&_rsc=metadata`, {
      rsc: '1',
      'next-router-prefetch': '1',
    }),
    request(`${destination}&create=F&_rsc=activation`),
    request(`${destination}&expense=e1&expenseGroup=F&_rsc=activation`),
    request('/groups/F?tab=balances&_rsc=activation'),
    request('/trips/F?tab=expenses&_rsc=activation'),
    request(destination, {}),
  ];
  assert.deepEqual(
    beforeActivation.map((item) => isRouteNavigation(item, destination)),
    beforeActivation.map(() => false),
  );
  assert.equal(
    [...beforeActivation, request(`${destination}&_rsc=activation`)].findIndex(
      (item) => isRouteNavigation(item, destination),
    ),
    beforeActivation.length,
    'Only the actual navigation may start the pending-feedback checkpoint',
  );
});
