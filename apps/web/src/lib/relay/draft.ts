import type { CreateExpenseInput } from './__generated__/journeyCreateMutation.graphql';
import { equalShares, minor, parseAmount } from './money';
export const categories = [
  'DINING',
  'GROCERIES',
  'ACCOMMODATION',
  'TRANSPORT',
  'ACTIVITIES',
  'HOME',
  'OTHER',
] as const;
export type Draft = {
  description: string;
  amount: string;
  date: string;
  category: (typeof categories)[number];
  note: string;
  payer: string;
  participants: string[];
  split: 'EQUAL' | 'EXACT';
  exact: Record<string, string>;
};
export type Member = {
  readonly id: string;
  readonly displayName: string;
  readonly canParticipate: boolean;
};
export type SavedDraft = {
  version: 1;
  actor: string;
  group: string;
  draft: Draft;
  attempt?: CreateExpenseInput;
};
export const repaymentStorageKey = 'kami-financial-repayments-v1';
export const privateStorageKey = 'kami-financial-drafts-v1';
export function clearFinancialStorage() {
  sessionStorage.removeItem(privateStorageKey);
  sessionStorage.removeItem(repaymentStorageKey);
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}
function storedDraft(value: unknown): value is Draft {
  return (
    object(value) &&
    ['description', 'amount', 'date', 'category', 'note', 'payer'].every(
      (key) => typeof value[key] === 'string',
    ) &&
    strings(value.participants) &&
    (value.split === 'EQUAL' || value.split === 'EXACT') &&
    object(value.exact) &&
    Object.values(value.exact).every((item) => typeof item === 'string')
  );
}
function storedAttempt(
  value: unknown,
  group: string,
): value is CreateExpenseInput {
  if (
    !object(value) ||
    value.groupId !== group ||
    typeof value.key !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value.key,
    )
  )
    return false;
  if (
    ![
      'totalMinor',
      'description',
      'effectiveDate',
      'category',
      'note',
      'payerId',
    ].every((key) => typeof value[key] === 'string') ||
    value.currency !== 'USD' ||
    !strings(value.participantIds)
  )
    return false;
  if (value.split === 'EQUAL') return value.exactAllocations == null;
  return (
    value.split === 'EXACT' &&
    Array.isArray(value.exactAllocations) &&
    value.exactAllocations.every(
      (item) =>
        object(item) &&
        typeof item.participantId === 'string' &&
        typeof item.amountMinor === 'string',
    )
  );
}
function storedEnvelope(): Record<string, SavedDraft> {
  const value: unknown = JSON.parse(
    sessionStorage.getItem(privateStorageKey) ?? '{}',
  );
  if (!object(value)) throw new Error('Saved draft cannot be safely read.');
  for (const [group, item] of Object.entries(value)) {
    if (
      !object(item) ||
      item.version !== 1 ||
      typeof item.actor !== 'string' ||
      item.group !== group ||
      !storedDraft(item.draft) ||
      (item.attempt !== undefined && !storedAttempt(item.attempt, group))
    )
      throw new Error('Saved draft cannot be safely read.');
  }
  return value as Record<string, SavedDraft>;
}
/** A tab owns this envelope. Malformed storage blocks writes rather than losing an attempt. */
export function readDraft(
  actor: string,
  group: string,
): SavedDraft | undefined {
  const item = storedEnvelope()[group];
  if (item && item.actor !== actor)
    throw new Error('Saved draft belongs to a different account.');
  return item;
}
export function saveDraft(value: SavedDraft) {
  const all = storedEnvelope();
  all[value.group] = value;
  sessionStorage.setItem(privateStorageKey, JSON.stringify(all));
}
export function removeDraft(group: string) {
  const all = storedEnvelope();
  delete all[group];
  sessionStorage.setItem(privateStorageKey, JSON.stringify(all));
}
export function newDraft(
  today: string,
  payer: string,
  members: readonly Member[],
): Draft {
  return {
    description: '',
    amount: '',
    date: today,
    category: 'OTHER',
    note: '',
    payer,
    participants: members.filter((m) => m.canParticipate).map((m) => m.id),
    split: 'EQUAL',
    exact: {},
  };
}
/** Reject invalid Unicode and NUL before financial submission. */
export function validText(value: string) {
  return !/[\u0000\uD800-\uDFFF]/u.test(value);
}
/** Strict Gregorian wire date validation, including leap days. */
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000'))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function validate(draft: Draft, members: readonly Member[]) {
  const errors: Record<string, string> = {};
  let total = '0';
  try {
    total = parseAmount(draft.amount);
  } catch (error) {
    errors.amount = (error as Error).message;
  }
  const description = draft.description.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  if (
    !validText(description) ||
    [...description].length < 1 ||
    [...description].length > 120
  )
    errors.description = 'Enter a description of 1–120 characters.';
  if (!validText(draft.note) || [...draft.note].length > 2000)
    errors.note = 'Use at most 2,000 characters without invalid characters.';
  if (!validDate(draft.date)) errors.date = 'Enter a valid calendar date.';
  if (!categories.includes(draft.category))
    errors.category = 'Select a category.';
  const eligible = new Set(
    members.filter((m) => m.canParticipate).map((m) => m.id),
  );
  if (!eligible.has(draft.payer))
    errors.payer = 'Choose a currently eligible payer.';
  if (
    !draft.participants.length ||
    new Set(draft.participants).size !== draft.participants.length ||
    draft.participants.some((id) => !eligible.has(id))
  )
    errors.participants = 'Choose eligible participants, each once.';
  let allocations = equalShares(total, draft.participants);
  if (draft.split === 'EXACT') {
    allocations = draft.participants.map((participantId) => {
      try {
        return {
          participantId,
          amountMinor: parseAmount(draft.exact[participantId] ?? '', true),
        };
      } catch {
        errors.participants =
          'Enter a valid exact amount for every selected participant, including zero.';
        return { participantId, amountMinor: '0' };
      }
    });
    if (
      allocations.reduce((sum, a) => sum + minor(a.amountMinor), 0n) !==
      minor(total)
    )
      errors.participants ??= 'Exact shares must add up to the expense total.';
  } else if (draft.split !== 'EQUAL')
    errors.participants = 'Choose Equal or Exact.';
  return { errors, total, description, allocations };
}
export function createInput(
  draft: Draft,
  members: readonly Member[],
  groupId: string,
  key: string,
): CreateExpenseInput {
  const checked = validate(draft, members);
  if (Object.keys(checked.errors).length)
    throw new Error('Check the highlighted expense fields.');
  return {
    groupId,
    key,
    currency: 'USD',
    totalMinor: checked.total,
    description: checked.description,
    effectiveDate: draft.date,
    category: draft.category,
    note: draft.note,
    payerId: draft.payer,
    participantIds: [...draft.participants].sort(),
    split: draft.split,
    ...(draft.split === 'EXACT'
      ? { exactAllocations: checked.allocations }
      : {}),
  };
}
