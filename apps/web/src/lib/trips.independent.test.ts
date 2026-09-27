import { expect, it } from 'vitest';
import { createMockData } from './data/mock';
import { tripCards } from './trips';
it('independently creates one empty default-cover trip without changing household finances on retry', async () => {
  const { port } = createMockData({ clock: () => '2026-09-20T12:00:00Z' });
  const before = await port.read('household-demo');
  if (before.status !== 'ok') throw new Error('fixture');
  const command = {
    householdId: 'household-demo',
    operationId: 'trip-once',
    command: {
      kind: 'create-trip' as const,
      value: {
        name: 'Today together',
        destination: '',
        start: '2026-09-20',
        end: '2026-09-20',
      },
    },
  };
  const saved = await port.execute(command);
  expect(await port.execute(command)).toEqual(saved);
  const after = await port.read('household-demo');
  if (after.status !== 'ok' || saved.status !== 'ok') throw new Error('save');
  expect(after.value.trips).toHaveLength(before.value.trips.length + 1);
  expect(after.value.expenses).toEqual(before.value.expenses);
  expect(after.value.repayments).toEqual(before.value.repayments);
  expect(after.value.activity).toEqual(before.value.activity);
  const card = tripCards(after.value, 'all').find(
    (row) => row.trip.id === saved.value.id,
  )!;
  expect(card.trip.cover).toBeNull();
  expect(card.status).toBe('In progress');
  expect(card.total).toBe(0);
  expect(card.count).toBe(0);
  expect(
    tripCards(after.value, 'upcoming').some(
      (row) => row.trip.id === saved.value.id,
    ),
  ).toBe(false);
  expect(
    tripCards(after.value, 'past').some(
      (row) => row.trip.id === saved.value.id,
    ),
  ).toBe(false);
});
