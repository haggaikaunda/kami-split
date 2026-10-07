// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import {
  expenseDraft,
  readEditDraft,
  saveEditDraft,
  type EditableExpense,
} from './edit-draft';
import {
  clearFinancialStorage,
  createInput,
  editStorageKey,
  newDraft,
  saveDraft,
  readDraft,
} from './draft';
const members = [
  { id: 'a', displayName: 'A', canParticipate: true },
  { id: 'b', displayName: 'B', canParticipate: true },
];
const expense = {
  __typename: 'Expense',
  id: 'expense',
  groupId: 'group',
  version: '1',
  canEdit: true,
  editLockReason: null,
  description: 'Lunch',
  totalMinor: '101',
  currency: 'USD',
  effectiveDate: '2026-10-01',
  category: 'DINING',
  note: '  preserved\n',
  payer: { id: 'a', displayName: 'A' },
  creator: { id: 'a', displayName: 'A' },
  createdAt: '2026-10-01T12:00:00Z',
  split: 'PERCENTAGE',
  allocations: [
    {
      participant: { id: 'b', displayName: 'B' },
      amountMinor: '101',
      percentageHundredths: 10000,
    },
    {
      participant: { id: 'a', displayName: 'A' },
      amountMinor: '0',
      percentageHundredths: 0,
    },
  ],
} as EditableExpense;
beforeEach(() => sessionStorage.clear());
it('prefills exact minor units, literal notes and zero participants from saved percentage intent', () => {
  const draft = expenseDraft(expense);
  expect(draft.amount).toBe('1.01');
  expect(draft.note).toBe('  preserved\n');
  expect(draft.participants).toEqual(['b', 'a']);
  expect(draft.percentages).toEqual({ b: '100', a: '0' });
  expect(draft.exact).toEqual({ b: '1.01', a: '0.00' });
  expect(draft.linkedPercentages).toBe(false);
  expect(createInput(draft, members, 'group', 'key').percentages).toEqual([
    { participantId: 'a', hundredths: 0 },
    { participantId: 'b', hundredths: 10000 },
  ]);
});
it('isolates create and edit recovery by actor/group/expense and clears all on logout', () => {
  const draft = expenseDraft(expense);
  const attempt = {
    ...createInput(draft, members, 'group', crypto.randomUUID()),
    expenseId: 'expense',
    expectedVersion: '1',
  };
  saveEditDraft({
    version: 1,
    actor: 'actor',
    group: 'group',
    expense: 'expense',
    baseVersion: '1',
    draft,
    attempt,
  });
  saveDraft({
    version: 2,
    actor: 'actor',
    group: 'group',
    draft: newDraft('2026-10-01', 'a', members),
  });
  expect(readDraft('actor', 'group')?.draft.description).toBe('');
  expect(readEditDraft('actor', 'group', 'expense')?.attempt).toEqual(attempt);
  expect(() => readEditDraft('other', 'group', 'expense')).toThrow();
  expect(() => readEditDraft('actor', 'other', 'expense')).toThrow();
  expect(readEditDraft('actor', 'group', 'other')).toBeUndefined();
  clearFinancialStorage();
  expect(readEditDraft('actor', 'group', 'expense')).toBeUndefined();
});
it('blocks malformed retained attempts rather than overwriting unknown recovery', () => {
  sessionStorage.setItem(
    editStorageKey,
    JSON.stringify({
      expense: {
        version: 1,
        actor: 'actor',
        group: 'group',
        expense: 'expense',
        baseVersion: '1',
        draft: expenseDraft(expense),
        attempt: { key: 'bad' },
      },
    }),
  );
  expect(() => readEditDraft('actor', 'group', 'expense')).toThrow();
});
