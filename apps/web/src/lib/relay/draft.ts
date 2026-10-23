import { validCalendarDate as validDate } from '@/lib/dates';
export { validCalendarDate as validDate } from '@/lib/dates';
import type { CreateExpenseInput } from './__generated__/journeyCreateMutation.graphql';
import {
  parsePercentage,
  percentageShares,
  percentageText,
} from './percentage';
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
  split: 'EQUAL' | 'EXACT' | 'PERCENTAGE';
  percentages?: Record<string, string>;
  linkedPercentages?: boolean;
  percentageInitialized?: boolean;
  exact: Record<string, string>;
};
export type Member = {
  readonly id: string;
  readonly displayName: string;
  readonly canParticipate: boolean;
};
export type SavedDraft = {
  version: 1 | 2;
  actor: string;
  group: string;
  draft: Draft;
  attempt?: CreateExpenseInput;
};
export const groupCreationStorageKey = 'kami-group-creation-v1';
export const repaymentStorageKey = 'kami-financial-repayments-v1';
export const editStorageKey = 'kami-financial-edits-v1';
export const privateStorageKey = 'kami-financial-drafts-v1';
export function clearFinancialStorage() {
  sessionStorage.removeItem(groupCreationStorageKey);
  sessionStorage.removeItem(privateStorageKey);
  sessionStorage.removeItem(repaymentStorageKey);
  sessionStorage.removeItem(editStorageKey);
  // Enrollment recovery identities belong to the departing financial actor.
  for (let index = sessionStorage.length - 1; index >= 0; index--) {
    const key = sessionStorage.key(index);
    if (
      key?.startsWith('kami-personal-enrollment:') ||
      key?.startsWith('kami-personal-annotation:')
    )
      sessionStorage.removeItem(key);
  }
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}
export function storedDraft(value: unknown): value is Draft {
  return (
    object(value) &&
    ['description', 'amount', 'date', 'category', 'note', 'payer'].every(
      (key) => typeof value[key] === 'string',
    ) &&
    strings(value.participants) &&
    (value.split === 'EQUAL' ||
      value.split === 'EXACT' ||
      value.split === 'PERCENTAGE') &&
    (value.percentages === undefined ||
      (object(value.percentages) &&
        Object.values(value.percentages).every(
          (item) => typeof item === 'string',
        ))) &&
    (value.percentageInitialized === undefined ||
      typeof value.percentageInitialized === 'boolean') &&
    (value.linkedPercentages === undefined ||
      typeof value.linkedPercentages === 'boolean') &&
    (value.split !== 'PERCENTAGE' ||
      (object(value.percentages) &&
        typeof value.linkedPercentages === 'boolean')) &&
    object(value.exact) &&
    Object.values(value.exact).every((item) => typeof item === 'string')
  );
}
export function storedAttempt(
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
  if (value.split === 'PERCENTAGE')
    return (
      value.exactAllocations == null &&
      Array.isArray(value.percentages) &&
      value.percentages.every(
        (item) =>
          object(item) &&
          typeof item.participantId === 'string' &&
          Number.isInteger(item.hundredths) &&
          (item.hundredths as number) >= 0 &&
          (item.hundredths as number) <= 10000,
      )
    );
  if (value.percentages != null) return false;
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
      (item.version !== 1 && item.version !== 2) ||
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
  all[value.group] = { ...value, version: 2 };
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
    percentages: {},
    linkedPercentages: false,
    percentageInitialized: false,
  };
}
/** Reject invalid Unicode and NUL before financial submission. */
export function validText(value: string) {
  return !/[\u0000\uD800-\uDFFF]/u.test(value);
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
  } else if (draft.split === 'PERCENTAGE') {
    allocations = [];
    let sum = 0n;
    const percentages = draft.participants.flatMap((participantId) => {
      try {
        const hundredths = parsePercentage(
          draft.percentages?.[participantId] ?? '',
        );
        sum += BigInt(hundredths);
        return [{ participantId, hundredths }];
      } catch (error) {
        errors[`percentage-${participantId}`] = (error as Error).message;
        return [];
      }
    });
    if (percentages.length !== draft.participants.length)
      errors.participants =
        'Enter a percentage for every selected participant, including explicit 0%.';
    else if (sum !== 10000n)
      errors.participants = `${percentageText(Number(sum))}% allocated · ${percentageText(Number(sum > 10000n ? sum - 10000n : 10000n - sum))}% ${sum > 10000n ? 'over allocated' : 'remaining'}. Percentages must add up to exactly 100%.`;
    if (
      !errors.amount &&
      !errors.participants &&
      !Object.keys(errors).some((key) => key.startsWith('percentage-'))
    )
      allocations = percentageShares(total, percentages);
  } else if (draft.split !== 'EQUAL')
    errors.participants = 'Choose Equal, Exact or Percentage.';
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
    ...(draft.split === 'PERCENTAGE'
      ? {
          percentages: [...draft.participants].sort().map((participantId) => ({
            participantId,
            hundredths: parsePercentage(
              draft.percentages?.[participantId] ?? '',
            ),
          })),
        }
      : {}),
    ...(draft.split === 'EXACT'
      ? { exactAllocations: checked.allocations }
      : {}),
  };
}

/** First entry initializes only a fresh two-person percentage draft. Restoration never rebalances. */
export function selectSplit(
  draft: Draft,
  split: Draft['split'],
): Partial<Draft> {
  if (
    split !== 'PERCENTAGE' ||
    draft.percentageInitialized ||
    Object.keys(draft.percentages ?? {}).length
  )
    return { split };
  const pair = draft.participants.length === 2;
  return {
    split,
    linkedPercentages: pair,
    percentageInitialized: true,
    percentages: pair
      ? Object.fromEntries(draft.participants.map((id) => [id, '50']))
      : { ...draft.percentages },
  };
}
/** Linking applies only to a valid user edit; blank/intermediate text preserves the other draft. */
export function editPercentage(
  draft: Draft,
  id: string,
  text: string,
): Record<string, string> {
  const values = { ...draft.percentages, [id]: text };
  if (
    draft.linkedPercentages &&
    draft.participants.length === 2 &&
    draft.participants.includes(id)
  ) {
    try {
      const other = draft.participants.find((value) => value !== id)!;
      values[other] = percentageText(10000 - parsePercentage(text));
    } catch {
      /* preserve the other person's text */
    }
  }
  return values;
}
/** Assign only the chosen participant; invalid other fields cannot be treated as zero. */
export function remainingPercentage(
  draft: Draft,
  id: string,
): string | undefined {
  if (!draft.participants.includes(id)) return undefined;
  try {
    const sum = draft.participants
      .filter((value) => value !== id)
      .reduce(
        (total, value) =>
          total + BigInt(parsePercentage(draft.percentages?.[value] ?? '')),
        0n,
      );
    return sum <= 10000n ? percentageText(Number(10000n - sum)) : undefined;
  } catch {
    return undefined;
  }
}
