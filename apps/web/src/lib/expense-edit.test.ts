import { describe, expect, it } from 'vitest';
import { createMockData } from './data/mock';
import { expenseEditDraft } from './expense-edit';
import { validateExpenseDraft } from './expense-draft';

describe('expense edit prefill', () => {
  it('copies every field, explicit zero membership and original version without aliasing', async () => {
    const data = await createMockData().port.read('household-demo');
    if (data.status !== 'ok') throw new Error('fixture');
    const original = {
      ...data.value.expenses[0],
      amount: 1001,
      split: 'exact' as const,
      participantIds: ['member-k', 'member-m'],
      allocations: [
        { memberId: 'member-k', amount: 1001 },
        { memberId: 'member-m', amount: 0 },
      ],
      note: 'Before trip booking',
    };
    const draft = expenseEditDraft(original);
    expect(draft).toMatchObject({
      amount: '10.01',
      expectedVersion: original.version,
      description: original.description,
      effectiveDate: original.effectiveDate,
      currency: original.currency,
      category: original.category,
      payerId: original.payerId,
      tripId: original.tripId ?? '',
      note: original.note,
      exact: { 'member-k': '10.01', 'member-m': '0.00' },
    });
    expect(JSON.parse(draft.original)).toEqual(original);
    expect(
      validateExpenseDraft(draft, data.value).value?.participantIds,
    ).toEqual(original.participantIds);
    draft.participantIds.pop();
    expect(original.participantIds).toHaveLength(2);
  });
});
