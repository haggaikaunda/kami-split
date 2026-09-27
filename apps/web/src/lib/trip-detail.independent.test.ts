import { expect, it } from 'vitest';
import { createMockData } from './data/mock';
import { tripDetail, tripExpenseGroups } from './trip-detail';
import { equalSplit, spending } from './ledger';

it('independently keeps trip totals tied to current shared records across pre-trip booking, repayment and deletion', async () => {
  const { port } = createMockData();
  const read = async () => {
    const result = await port.read('household-demo');
    if (result.status !== 'ok') throw new Error(result.status);
    return result.value;
  };
  const initial = await read();
  const before = tripDetail(initial, 'maui')!;
  expect([before.total, before.count]).toEqual([164420, 7]);
  expect(before.positions.map((row) => row.share)).toEqual([82210, 82210]);
  const booking = await port.execute({
    householdId: 'household-demo',
    operationId: 'independent-pretrip',
    command: {
      kind: 'create-expense',
      value: {
        amount: 1001,
        currency: 'USD',
        effectiveDate: '2026-01-01',
        payerId: 'member-k',
        participantIds: ['member-k', 'member-m'],
        allocations: equalSplit(1001, ['member-k', 'member-m']),
        split: 'equal',
        category: 'Accommodation',
        tripId: 'maui',
        description: 'Advance booking',
        note: '',
      },
    },
  });
  if (booking.status !== 'ok') throw new Error(booking.status);
  let state = await read();
  let detail = tripDetail(state, 'maui')!;
  expect([detail.total, detail.count]).toEqual([165421, 8]);
  expect(detail.positions.map((row) => row.share)).toEqual([82711, 82710]);
  expect(detail.positions.reduce((sum, row) => sum + row.paid, 0)).toBe(
    detail.total,
  );
  expect(
    tripExpenseGroups(detail.expenses, {
      search: 'ADVANCE',
      category: 'Accommodation',
    }),
  ).toMatchObject([
    { date: '2026-01-01', total: 1001, expenses: [{ id: booking.value.id }] },
  ]);
  expect(spending(state.expenses, { currency: 'USD' }).total).toBe(513657);
  const repayment = await port.execute({
    householdId: 'household-demo',
    operationId: 'independent-transfer',
    command: {
      kind: 'record-repayment',
      value: {
        amount: 3718,
        currency: 'USD',
        senderId: 'member-k',
        recipientId: 'member-m',
        effectiveDate: '2026-09-20',
        note: '',
      },
    },
  });
  expect(repayment.status).toBe('ok');
  expect(tripDetail(await read(), 'maui')).toEqual(detail);
  expect(
    (
      await port.execute({
        householdId: 'household-demo',
        operationId: 'independent-delete-booking',
        command: {
          kind: 'delete-expense',
          id: booking.value.id,
          expectedVersion: 1,
          reason: 'Duplicate reservation',
        },
      })
    ).status,
  ).toBe('ok');
  state = await read();
  detail = tripDetail(state, 'maui')!;
  expect([detail.total, detail.count]).toEqual([164420, 7]);
  expect(
    tripExpenseGroups(detail.expenses, { search: 'ADVANCE', category: 'all' }),
  ).toEqual([]);
  expect(
    state.revisions.filter((row) => row.expenseId === booking.value.id),
  ).toHaveLength(2);
  expect(
    state.activity.filter((row) => row.recordId === booking.value.id),
  ).toHaveLength(2);
  expect(
    state.expenses.find((row) => row.id === booking.value.id)?.deleted,
  ).toBe(true);
  expect(initial.expenses).toHaveLength(24);
});

it('independently includes all three members and keeps unrelated and missing trips distinct from empty trips', async () => {
  const { port } = createMockData({ fixture: 'three-members' });
  const result = await port.read('household-demo');
  if (result.status !== 'ok') throw new Error(result.status);
  const detail = tripDetail(result.value, 'maui')!;
  expect(detail.positions.map((row) => row.memberId)).toEqual(
    result.value.members.map((row) => row.id),
  );
  expect(detail.positions.reduce((sum, row) => sum + row.share, 0)).toBe(
    detail.total,
  );
  expect(detail.positions.reduce((sum, row) => sum + row.net, 0)).toBe(0);
  expect(tripDetail(result.value, 'porto')).toMatchObject({
    total: 0,
    count: 0,
    expenses: [],
  });
  expect(tripDetail(result.value, 'missing')).toBeUndefined();
});
