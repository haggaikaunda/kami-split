import { expect, it } from 'vitest';
import { createMockData } from './data/mock';
import { historyEvents } from './history';
it('independently keeps real adapter creation, correction and deletion events separately searchable', async () => {
  const { port } = createMockData();
  const before = await port.read('household-demo');
  if (before.status !== 'ok') throw new Error('seed');
  const original = before.value.expenses.find((row) => row.id === '1')!;
  const changed = await port.execute({
    householdId: 'household-demo',
    operationId: 'history-edit',
    command: {
      kind: 'update-expense',
      id: original.id,
      expectedVersion: 1,
      value: {
        ...original,
        description: 'Corrected market receipt',
        effectiveDate: '2024-01-01',
      },
    },
  });
  expect(changed.status).toBe('ok');
  const deletion = {
    householdId: 'household-demo',
    operationId: 'history-delete',
    command: {
      kind: 'delete-expense' as const,
      id: original.id,
      expectedVersion: 2,
      reason: 'Duplicate',
    },
  };
  await port.execute(deletion);
  await port.execute(deletion);
  const after = await port.read('household-demo');
  if (after.status !== 'ok') throw new Error('read');
  const filters = { search: '', type: 'all', member: 'member-m' };
  const matching = historyEvents(after.value, filters).filter(
    (event) => event.recordId === original.id,
  );
  expect(matching.map((event) => event.kind)).toEqual([
    'deleted',
    'edited',
    'created',
  ]);
  expect(
    historyEvents(after.value, { ...filters, search: 'weekly groceries' }).map(
      (event) => event.kind,
    ),
  ).toEqual(['created']);
  expect(
    historyEvents(after.value, { ...filters, search: 'corrected market' }).map(
      (event) => event.kind,
    ),
  ).toEqual(['deleted', 'edited']);
  expect(matching[2].snapshot).toEqual(original);
  expect(matching[0].at).toBe(matching[1].at);
  expect(matching[0].sequence).toBeGreaterThan(matching[1].sequence);
});
