import type { ExpenseRecord } from './data/port';
import { decimalText, type ExpenseDraft } from './expense-draft';

/** The baseline is session draft data: a refresh must never silently rebase it. */
export type ExpenseEditDraft = ExpenseDraft & {
  expenseId: string;
  expectedVersion: number;
  original: string;
};
export function expenseEditDraft(record: ExpenseRecord): ExpenseEditDraft {
  return {
    expenseId: record.id,
    expectedVersion: record.version,
    original: JSON.stringify(record),
    amount: decimalText(record.amount),
    currency: record.currency,
    description: record.description,
    payerId: record.payerId,
    effectiveDate: record.effectiveDate,
    category: record.category,
    tripId: record.tripId ?? '',
    participantIds: [...record.participantIds],
    split: record.split,
    exact: Object.fromEntries(
      record.allocations.map((row) => [row.memberId, decimalText(row.amount)]),
    ),
    note: record.note,
  };
}
