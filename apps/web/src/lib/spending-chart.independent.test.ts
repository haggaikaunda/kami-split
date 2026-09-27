import { expect, it } from 'vitest';
import { createMockData } from './data/mock';
import {
  bucketFromId,
  spendingBucket,
  tripSeries,
  categoryBuckets,
} from './spending-chart';

it('independently preserves included zero-share expenses and recalculates their selected bucket after deletion', async () => {
  const { port, demo } = createMockData();
  const read = async () => {
    const row = await port.read('household-demo');
    if (row.status !== 'ok') throw new Error(row.status);
    return row.value;
  };
  const created = await port.execute({
    householdId: 'household-demo',
    operationId: 'independent-zero-share',
    command: {
      kind: 'create-expense',
      value: {
        amount: 4101,
        currency: 'USD',
        effectiveDate: '2026-09-30',
        payerId: 'member-k',
        participantIds: ['member-k', 'member-m'],
        allocations: [
          { memberId: 'member-k', amount: 4101 },
          { memberId: 'member-m', amount: 0 },
        ],
        split: 'exact',
        category: 'Dining',
        tripId: 'maui',
        description: 'Included guest',
        note: '',
      },
    },
  });
  if (created.status !== 'ok') throw new Error(created.status);
  demo.actor('member-m');
  const identity = bucketFromId('day:2026-09-30')!;
  const state = await read();
  expect(spendingBucket(state, identity, 'share')).toMatchObject({
    total: 0,
    count: 1,
    expenses: [{ id: created.value.id }],
  });
  expect(spendingBucket(state, identity, 'household')).toMatchObject({
    total: 4101,
    count: 1,
  });
  expect(
    (
      await port.execute({
        householdId: 'household-demo',
        operationId: 'independent-chart-delete',
        command: {
          kind: 'delete-expense',
          id: created.value.id,
          expectedVersion: 1,
          reason: 'Duplicate',
        },
      })
    ).status,
  ).toBe('ok');
  const refreshed = await read();
  expect(spendingBucket(refreshed, identity, 'share')).toMatchObject({
    id: identity.id,
    total: 0,
    count: 0,
    expenses: [],
  });
  expect(
    state.expenses.find((row) => row.id === created.value.id)?.deleted,
  ).not.toBe(true);
  expect(
    refreshed.revisions.filter((row) => row.expenseId === created.value.id),
  ).toHaveLength(2);
});

it('independently reconciles long-range trip buckets and categories without truncation or hidden currency mixing', async () => {
  const { port } = createMockData();
  const before = await port.read('household-demo');
  if (before.status !== 'ok') throw new Error(before.status);
  const source = before.value.expenses.find((row) => row.tripId === 'maui')!;
  // The preview accepts only USD writes; the domain fixture verifies that a
  // future adapter carrying another supported currency cannot mix it into USD.
  const result = { value: structuredClone(before.value) };
  result.value.expenses.push({
    ...source,
    id: 'independent-eur',
    currency: 'EUR',
    description: 'Separate currency',
    effectiveDate: '2026-09-20',
  });
  const trip = {
    ...result.value.trips.find((row) => row.id === 'maui')!,
    start: '1000-01-01',
    end: '9999-12-31',
  };
  const series = tripSeries(result.value, trip);
  expect(series.buckets.length).toBeLessThanOrEqual(60);
  expect([series.start, series.end, series.total, series.count]).toEqual([
    '1000-01-01',
    '9999-12-31',
    164420,
    7,
  ]);
  expect(series.buckets[0].start).toBe('1000-01-01');
  expect(series.buckets.at(-1)?.end).toBe('9999-12-31');
  expect(
    series.buckets
      .flatMap((row) => row.expenses)
      .map((row) => row.id)
      .sort(),
  ).toEqual(
    before.value.expenses
      .filter((row) => row.tripId === 'maui')
      .map((row) => row.id)
      .sort(),
  );
  expect(
    categoryBuckets(result.value, 'maui').reduce(
      (sum, row) => sum + row.total,
      0,
    ),
  ).toBe(164420);
  expect(
    categoryBuckets(result.value, 'maui').map((row) => [
      row.category,
      row.total,
    ]),
  ).toEqual([
    ['Accommodation', 64000],
    ['Activities', 14000],
    ['Dining', 8620],
    ['Groceries', 4210],
    ['Transport', 73590],
  ]);
});
