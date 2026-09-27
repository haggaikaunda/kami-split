import { describe, expect, it } from 'vitest';
import { fixture } from './data/fixtures';
import { createMockData } from './data/mock';
import {
  bucketFromId,
  categoryBuckets,
  expenseScopeAmount,
  householdDefinitions,
  householdSeries,
  monthLastDay,
  readChartPeriod,
  shiftChartPeriod,
  spendingBucket,
  tripSeries,
} from './spending-chart';
import { checkedSum, equalSplit } from './ledger';
const snapshot = fixture('sample', '2026-09-20');
describe('current exact spending buckets', () => {
  it.each([
    [2024, 29],
    [2026, 28],
    [2000, 29],
    [1900, 28],
    [0, 29],
  ])('handles February in %i', (year, days) => {
    expect(monthLastDay(year, 2)).toBe(days);
    expect(
      householdDefinitions({ mode: 'daily', year, month: 2 }),
    ).toHaveLength(days);
  });
  it('shifts by month, year and five years across boundaries without unsupported dates', () => {
    expect(
      shiftChartPeriod({ mode: 'daily', year: 2026, month: 12 }, 1),
    ).toEqual({ mode: 'daily', year: 2027, month: 1 });
    expect(
      shiftChartPeriod({ mode: 'daily', year: 2026, month: 1 }, -1),
    ).toEqual({ mode: 'daily', year: 2025, month: 12 });
    expect(
      shiftChartPeriod({ mode: 'monthly', year: 2026, month: 9 }, -1)?.year,
    ).toBe(2025);
    expect(
      shiftChartPeriod({ mode: 'yearly', year: 2026, month: 9 }, 1)?.year,
    ).toBe(2031);
    expect(
      shiftChartPeriod({ mode: 'yearly', year: 4, month: 1 }, -1),
    ).toBeUndefined();
    expect(
      shiftChartPeriod({ mode: 'daily', year: 9999, month: 12 }, 1),
    ).toBeUndefined();
    expect(
      readChartPeriod(
        new URLSearchParams('chartMode=daily&period=2026-99'),
        '2026-09-20',
      ),
    ).toEqual({ mode: 'daily', year: 2026, month: 9 });
  });
  it('includes every zero period and matches the approved household sums', () => {
    const daily = householdSeries(
      snapshot,
      { mode: 'daily', year: 2026, month: 9 },
      'household',
    );
    expect(daily.buckets).toHaveLength(30);
    expect(daily.total).toBe(191456);
    expect(daily.count).toBe(11);
    expect(daily.buckets[9]).toMatchObject({
      id: 'day:2026-09-10',
      total: 0,
      count: 0,
    });
    const monthly = householdSeries(
      snapshot,
      { mode: 'monthly', year: 2026, month: 9 },
      'household',
    );
    expect(monthly.buckets).toHaveLength(12);
    expect(monthly.total).toBe(366656);
    const yearly = householdSeries(
      snapshot,
      { mode: 'yearly', year: 2026, month: 9 },
      'household',
    );
    expect(yearly.buckets.map((row) => row.id)).toEqual([
      'year:2022',
      'year:2023',
      'year:2024',
      'year:2025',
      'year:2026',
    ]);
    expect(yearly.total).toBe(512656);
  });
  it('uses actor allocations, including zero shares, instead of what that actor paid', () => {
    const row = {
      ...snapshot.expenses[0],
      id: 'odd',
      amount: 1001,
      payerId: 'member-m',
      participantIds: ['member-k', 'member-m'],
      allocations: [
        { memberId: 'member-k', amount: 0 },
        { memberId: 'member-m', amount: 1001 },
      ],
      split: 'exact' as const,
    };
    const data = { ...snapshot, expenses: [row] };
    const period = { mode: 'monthly' as const, year: 2026, month: 9 };
    expect(householdSeries(data, period, 'share')).toMatchObject({
      total: 0,
      count: 1,
    });
    expect(
      householdSeries({ ...data, actorId: 'member-m' }, period, 'share').total,
    ).toBe(1001);
    expect(expenseScopeAmount(row, 'share', 'member-k')).toBe(0);
    const excluded = {
      ...row,
      participantIds: ['member-m'],
      allocations: [{ memberId: 'member-m', amount: 1001 }],
    };
    expect(
      householdSeries({ ...data, expenses: [excluded] }, period, 'share').count,
    ).toBe(0);
  });
  it('does not duplicate trip spending or include repayment/deleted records', () => {
    const period = { mode: 'monthly' as const, year: 2026, month: 9 };
    const baseline = householdSeries(snapshot, period, 'household').total;
    const deleted = {
      ...snapshot,
      expenses: snapshot.expenses.map((row) =>
        row.id === '2' ? { ...row, deleted: true } : row,
      ),
      repayments: [
        ...snapshot.repayments,
        { ...snapshot.repayments[0], id: 'huge', amount: 999999999 },
      ],
    };
    expect(householdSeries(deleted, period, 'household').total).toBe(
      baseline - 6800,
    );
    expect(
      categoryBuckets(snapshot, 'maui').map((row) => [row.category, row.total]),
    ).toEqual([
      ['Accommodation', 64000],
      ['Activities', 14000],
      ['Dining', 8620],
      ['Groceries', 4210],
      ['Transport', 73590],
    ]);
    expect(
      checkedSum(categoryBuckets(snapshot, 'maui').map((row) => row.total)),
    ).toBe(164420);
  });
  it('recomputes an already selected bucket after a real date mutation, including newly empty results', async () => {
    const { port } = createMockData();
    const before = await port.read('household-demo');
    if (before.status !== 'ok') throw Error('no fixture');
    const record = before.value.expenses.find((row) => row.id === '2')!;
    const result = await port.execute({
      householdId: 'household-demo',
      operationId: 'move-day',
      command: {
        kind: 'update-expense',
        id: '2',
        expectedVersion: record.version,
        value: { ...record, effectiveDate: '2026-10-01' },
      },
    });
    expect(result.status).toBe('ok');
    const after = await port.read('household-demo');
    if (after.status !== 'ok') throw Error('no fixture');
    expect(
      spendingBucket(after.value, bucketFromId('month:2026-09')!, 'household'),
    ).toMatchObject({ total: 184656, count: 10 });
    expect(
      spendingBucket(after.value, bucketFromId('day:2026-09-18')!, 'household'),
    ).toMatchObject({ total: 0, count: 0, expenses: [] });
    expect(
      spendingBucket(after.value, bucketFromId('month:2026-10')!, 'household'),
    ).toMatchObject({ total: 6800, count: 1 });
  });
  it('keeps large exact amounts safe and zero empty household geometry data', () => {
    const empty = { ...snapshot, expenses: [] };
    expect(
      householdSeries(
        empty,
        { mode: 'monthly', year: 2026, month: 9 },
        'household',
      ).buckets.every((row) => row.total === 0),
    ).toBe(true);
    const amount = 999999999;
    const row = {
      ...snapshot.expenses[0],
      amount,
      allocations: equalSplit(amount, snapshot.expenses[0].participantIds),
    };
    expect(
      householdSeries(
        { ...snapshot, expenses: [row] },
        { mode: 'daily', year: 2026, month: 9 },
        'household',
      ).total,
    ).toBe(amount);
  });
});
describe('trip chart full extent and stable identities', () => {
  const trip = snapshot.trips.find((row) => row.id === 'maui')!;
  it('includes zero travel days and out-of-range bookings, retaining a removed bucket identity', () => {
    const base = tripSeries(snapshot, trip);
    expect(base.buckets).toHaveLength(9);
    expect(base.total).toBe(164420);
    expect(
      base.buckets.filter((row) => row.count === 0).map((row) => row.start),
    ).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
    const booking = {
      ...snapshot.expenses.find((row) => row.tripId === 'maui')!,
      id: 'booking',
      effectiveDate: '2026-09-01',
    };
    const expanded = tripSeries(
      { ...snapshot, expenses: [...snapshot.expenses, booking] },
      trip,
    );
    expect(expanded.start).toBe('2026-09-01');
    expect(expanded.buckets).toHaveLength(13);
    expect(
      spendingBucket(
        snapshot,
        bucketFromId('day:2026-09-01')!,
        'household',
        trip.id,
      ).count,
    ).toBe(0);
  });
  it('represents long ranges with bounded explicit aggregation instead of truncation', () => {
    const long = { ...trip, start: '2020-01-01', end: '2027-12-31' };
    const result = tripSeries(snapshot, long);
    expect(result.granularity).toBe('year');
    expect(result.buckets).toHaveLength(8);
    expect(result.total).toBe(164420);
    expect(result.coverage).toBe('2020-01-01 to 2027-12-31');
    const extreme = tripSeries(snapshot, {
      ...trip,
      start: '0000-01-01',
      end: '9999-12-31',
    });
    expect(extreme.granularity).toBe('years');
    expect(extreme.buckets.length).toBeLessThanOrEqual(60);
    expect(extreme.total).toBe(164420);
    expect(extreme.buckets.at(-1)?.end).toBe('9999-12-31');
    expect(
      tripSeries(snapshot, { ...trip, start: '2026-01-01', end: '2026-12-31' })
        .granularity,
    ).toBe('month');
  });
  it('rejects malformed bucket identities and preserves category names', () => {
    for (const value of [
      'day:2026-02-30',
      'month:2026-13',
      'years:2027-2020',
      'category:',
      'day:javascript:',
    ])
      expect(bucketFromId(value)).toBeUndefined();
    expect(bucketFromId('category:Home')).toMatchObject({ category: 'Home' });
  });
});
