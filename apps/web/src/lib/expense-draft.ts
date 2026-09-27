import {
  checkedSum,
  equalSplit,
  parseMoney,
  validateExpense,
  validDate,
  type Allocation,
} from './ledger';
import { CATEGORIES } from './data/mock';
import type { ExpenseInput, Snapshot } from './data/port';

export type ExpenseDraft = {
  amount: string;
  currency: string;
  description: string;
  payerId: string;
  effectiveDate: string;
  category: string;
  tripId: string;
  participantIds: string[];
  split: 'equal' | 'exact';
  exact: Record<string, string>;
  note: string;
};
export function defaultExpenseDraft(
  snapshot: Snapshot,
  tripId?: string,
): ExpenseDraft {
  const trip = snapshot.trips.find((row) => row.id === tripId);
  return {
    amount: '',
    currency: 'USD',
    description: '',
    payerId: snapshot.actorId,
    effectiveDate: trip
      ? [trip.start, snapshot.today, trip.end].sort()[1]
      : snapshot.today,
    category: 'Other',
    tripId: trip?.id ?? '',
    participantIds: snapshot.members
      .filter((row) => row.status === 'active')
      .map((row) => row.id),
    split: 'equal',
    exact: {},
    note: '',
  };
}
export function decimalText(amount: number): string {
  return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;
}
export function validateExpenseDraft(
  draft: ExpenseDraft,
  snapshot: Snapshot,
): {
  fields: Record<string, string>;
  value?: ExpenseInput;
  allocations: Allocation[];
  remaining?: number;
} {
  const fields: Record<string, string> = {};
  const active = snapshot.members
    .filter((row) => row.status === 'active')
    .map((row) => row.id);
  let amount: number | undefined;
  try {
    amount = parseMoney(draft.amount);
  } catch {
    fields.amount =
      'Enter a positive amount with at most two decimal places, up to 9,999,999.99.';
  }
  if (draft.currency !== 'USD')
    fields.currency = 'Only USD is available in this preview.';
  if (!draft.description.trim() || draft.description.trim().length > 120)
    fields.description = 'Enter a description of 1–120 characters.';
  if (!active.includes(draft.payerId))
    fields.payerId = 'Choose an active payer.';
  if (!validDate(draft.effectiveDate))
    fields.effectiveDate = 'Enter a valid expense date.';
  if (!CATEGORIES.includes(draft.category as (typeof CATEGORIES)[number]))
    fields.category = 'Choose a category.';
  if (draft.tripId && !snapshot.trips.some((row) => row.id === draft.tripId))
    fields.tripId = 'Choose an available trip.';
  if (
    !draft.participantIds.length ||
    new Set(draft.participantIds).size !== draft.participantIds.length ||
    draft.participantIds.some((id) => !active.includes(id))
  )
    fields.participantIds = 'Include at least one distinct active participant.';
  if (draft.note.length > 2000) fields.note = 'Use at most 2,000 characters.';
  const allocations: Allocation[] = [];
  if (!fields.participantIds) {
    if (draft.split === 'equal' && amount !== undefined)
      allocations.push(...equalSplit(amount, draft.participantIds));
    else if (draft.split === 'exact')
      for (const id of draft.participantIds) {
        try {
          allocations.push({
            memberId: id,
            amount: parseMoney(draft.exact[id] ?? '', true),
          });
        } catch {
          fields[`allocation-${id}`] =
            'Enter an exact non-negative amount, including zero.';
        }
      }
  }
  const remaining =
    amount !== undefined &&
    allocations.length === draft.participantIds.length &&
    draft.participantIds.length > 0
      ? checkedSum([amount, -checkedSum(allocations.map((row) => row.amount))])
      : undefined;
  if (remaining !== undefined && remaining !== 0)
    fields.allocations =
      remaining > 0
        ? 'Allocate the remaining amount before saving.'
        : 'Reduce allocations to match the total.';
  if (Object.keys(fields).length || amount === undefined)
    return { fields, allocations, remaining };
  const value: ExpenseInput = {
    amount,
    currency: 'USD',
    description: draft.description.trim(),
    payerId: draft.payerId,
    effectiveDate: draft.effectiveDate,
    category: draft.category,
    tripId: draft.tripId || null,
    participantIds: [...draft.participantIds],
    split: draft.split,
    allocations,
    note: draft.note,
  };
  try {
    validateExpense({ ...value, id: 'new-expense' }, active);
  } catch {
    return {
      fields: { allocations: 'Check the complete split before saving.' },
      allocations,
      remaining,
    };
  }
  return { fields, value, allocations, remaining };
}
