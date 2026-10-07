import type { UpdateExpenseInput } from './__generated__/expenseEditMutation.graphql';
import type { journeyExpenseQuery } from './__generated__/journeyExpenseQuery.graphql';
import {
  editStorageKey,
  storedDraft,
  storedAttempt,
  type Draft,
} from './draft';
import { percentageText } from './percentage';
import { minor } from './money';
export type EditableExpense = Extract<
  NonNullable<journeyExpenseQuery['response']['node']>,
  { readonly __typename: 'Expense' }
>;
export type EditDraft = {
  version: 1;
  actor: string;
  group: string;
  expense: string;
  baseVersion: string;
  draft: Draft;
  attempt?: UpdateExpenseInput;
};
function decimal(value: string) {
  const cents = minor(value);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}
/** Restore intent from saved values, never infer percentages from rounded cents. */
export function expenseDraft(expense: EditableExpense): Draft {
  return {
    description: expense.description,
    amount: decimal(expense.totalMinor),
    date: expense.effectiveDate,
    category: expense.category as Draft['category'],
    note: expense.note,
    payer: expense.payer.id,
    participants: expense.allocations.map((a) => a.participant.id),
    split: expense.split as Draft['split'],
    exact: Object.fromEntries(
      expense.allocations.map((a) => [
        a.participant.id,
        decimal(a.amountMinor),
      ]),
    ),
    percentages: Object.fromEntries(
      expense.allocations
        .filter((a) => a.percentageHundredths != null)
        .map((a) => [
          a.participant.id,
          percentageText(a.percentageHundredths!),
        ]),
    ),
    percentageInitialized: true,
    linkedPercentages: false,
  };
}
function envelope(): Record<string, EditDraft> {
  const value: unknown = JSON.parse(
    sessionStorage.getItem(editStorageKey) ?? '{}',
  );
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid edit storage');
  for (const [id, item] of Object.entries(value)) {
    if (
      !item ||
      typeof item !== 'object' ||
      item.version !== 1 ||
      item.expense !== id ||
      typeof item.actor !== 'string' ||
      typeof item.group !== 'string' ||
      typeof item.baseVersion !== 'string' ||
      !storedDraft(item.draft) ||
      (item.attempt !== undefined &&
        (!storedAttempt(item.attempt, item.group) ||
          item.attempt.expenseId !== id ||
          item.attempt.expectedVersion !== item.baseVersion))
    )
      throw new Error('Invalid edit storage');
  }
  return value as Record<string, EditDraft>;
}
export function readEditDraft(actor: string, group: string, expense: string) {
  const value = envelope()[expense];
  if (value && (value.actor !== actor || value.group !== group))
    throw new Error('Different edit owner');
  return value;
}
export function saveEditDraft(value: EditDraft) {
  const all = envelope();
  if (all[value.expense] && all[value.expense].actor !== value.actor)
    throw new Error('Different edit owner');
  all[value.expense] = value;
  sessionStorage.setItem(editStorageKey, JSON.stringify(all));
}
export function removeEditDraft(actor: string, group: string, expense: string) {
  readEditDraft(actor, group, expense);
  const all = envelope();
  delete all[expense];
  sessionStorage.setItem(editStorageKey, JSON.stringify(all));
}
