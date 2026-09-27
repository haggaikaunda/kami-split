import { describe, expect, it } from 'vitest';
import { createMockData } from './data/mock';
import type { Command, Snapshot } from './data/port';
import { equalSplit, spending } from './ledger';
import { tripDetail, tripExpenseGroups } from './trip-detail';
async function snapshot(
  source: ReturnType<typeof createMockData>,
): Promise<Snapshot> {
  const result = await source.port.read('household-demo');
  if (result.status !== 'ok') throw new Error('Fixture unavailable');
  return result.value;
}
describe('trip details use current household records', () => {
  it('matches Maui and keeps three-member financial sums exact without repayments', async () => {
    const source = createMockData();
    const before = await snapshot(source),
      model = tripDetail(before, 'maui')!;
    expect(model.total).toBe(164420);
    expect(model.count).toBe(7);
    expect(model.positions.map((row) => [row.paid, row.share])).toEqual([
      [82210, 82210],
      [82210, 82210],
    ]);
    expect(model.expenses.map((row) => row.id)).toEqual(
      before.expenses
        .filter((row) => row.tripId === 'maui')
        .map((row) => row.id),
    );
    await source.port.execute({
      householdId: 'household-demo',
      operationId: 'household-only-repayment',
      command: {
        kind: 'record-repayment',
        value: {
          senderId: 'member-k',
          recipientId: 'member-m',
          amount: 1000,
          currency: 'USD',
          effectiveDate: before.today,
          note: '',
        },
      },
    });
    expect(tripDetail(await snapshot(source), 'maui')).toEqual(model);
    const three = await snapshot(createMockData({ fixture: 'three-members' }));
    const positions = tripDetail(three, 'maui')!.positions;
    expect(positions).toHaveLength(3);
    expect(positions.reduce((sum, row) => sum + row.paid, 0)).toBe(164420);
    expect(positions.reduce((sum, row) => sum + row.share, 0)).toBe(164420);
  });
  it('includes pre-trip dates and recomputes add, association removal, and deletion without double counting', async () => {
    const source = createMockData();
    const before = await snapshot(source),
      base = before.expenses[0];
    let serial = 0;
    const execute = (command: Command) =>
      source.port.execute({
        householdId: 'household-demo',
        operationId: `trip-mutation-${++serial}`,
        command,
      });
    const created = await execute({
      kind: 'create-expense',
      value: {
        ...base,
        description: 'Early booking',
        tripId: 'maui',
        effectiveDate: '2026-01-03',
        amount: 1001,
        allocations: equalSplit(1001, base.participantIds),
      },
    });
    if (created.status !== 'ok' || !('version' in created.value))
      throw new Error('Create failed');
    const added = await snapshot(source);
    expect(tripDetail(added, 'maui')!.total).toBe(165421);
    expect(spending(added.expenses, { currency: 'USD' }).total).toBe(
      spending(before.expenses, { currency: 'USD' }).total + 1001,
    );
    expect(
      tripExpenseGroups(tripDetail(added, 'maui')!.expenses, {
        search: 'EARLY',
        category: 'all',
      })[0].date,
    ).toBe('2026-01-03');
    await execute({
      kind: 'update-expense',
      id: created.value.id,
      expectedVersion: 1,
      value: { ...created.value, tripId: null },
    });
    const moved = await snapshot(source);
    expect(tripDetail(moved, 'maui')!.total).toBe(164420);
    expect(spending(moved.expenses, { currency: 'USD' }).total).toBe(
      spending(added.expenses, { currency: 'USD' }).total,
    );
    const poke = moved.expenses.find((row) => row.id === '102')!;
    await execute({
      kind: 'delete-expense',
      id: poke.id,
      expectedVersion: poke.version,
      reason: 'Trip test',
    });
    const deleted = await snapshot(source);
    expect(tripDetail(deleted, 'maui')!.total).toBe(164420 - poke.amount);
    expect(
      tripDetail(deleted, 'maui')!.expenses.some((row) => row.id === poke.id),
    ).toBe(false);
    expect(
      deleted.expenses.some((row) => row.id === poke.id && row.deleted),
    ).toBe(true);
  });
  it('filters current descriptions/categories and groups by effective date with exact day sums', async () => {
    const data = await snapshot(createMockData());
    const model = tripDetail(data, 'maui')!;
    const poke = model.expenses.find((row) => row.id === '102')!;
    const groups = tripExpenseGroups(model.expenses, {
      search: '  PoKe ',
      category: poke.category,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].expenses.map((row) => row.id)).toEqual(['102']);
    expect(groups[0].date).toBe(poke.effectiveDate);
    expect(groups[0].total).toBe(poke.amount);
    expect(
      tripExpenseGroups(model.expenses, {
        search: 'Poke',
        category: 'Unavailable',
      }),
    ).toEqual([]);
    const all = tripExpenseGroups(model.expenses, {
      search: '',
      category: 'all',
    });
    expect(all.map((group) => group.date)).toEqual(
      all
        .map((group) => group.date)
        .sort()
        .reverse(),
    );
    expect(all.reduce((sum, group) => sum + group.total, 0)).toBe(model.total);
  });
  it('distinguishes an empty trip from an unavailable trip', async () => {
    const data = await snapshot(createMockData());
    expect(tripDetail(data, 'porto')).toMatchObject({
      total: 0,
      count: 0,
      expenses: [],
    });
    expect(tripDetail(data, 'unknown')).toBeUndefined();
  });
});
