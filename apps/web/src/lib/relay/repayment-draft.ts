import type { RecordRepaymentInput } from './__generated__/journeyRepaymentMutation.graphql';
import {
  repaymentStorageKey,
  validDate,
  validText,
  type Member,
} from './draft';
import { minor, parseAmount } from './money';
export type RepaymentDraft = {
  sender: string;
  recipient: string;
  amount: string;
  date: string;
  note: string;
};
export type SavedRepayment = {
  version: 1;
  actor: string;
  group: string;
  draft: RepaymentDraft;
  attempt?: RecordRepaymentInput;
};
/** Convert suggested wire cents to editable decimal text without floating point. */
export function amountText(value: string) {
  try {
    const n = minor(value);
    return n > 0n
      ? `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`
      : '';
  } catch {
    return '';
  }
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function envelope(): Record<string, SavedRepayment> {
  const value: unknown = JSON.parse(
    sessionStorage.getItem(repaymentStorageKey) ?? '{}',
  );
  if (!object(value)) throw new Error('Invalid repayment storage');
  for (const [group, item] of Object.entries(value)) {
    if (
      !object(item) ||
      item.version !== 1 ||
      typeof item.actor !== 'string' ||
      item.group !== group ||
      !object(item.draft) ||
      !['sender', 'recipient', 'amount', 'date', 'note'].every(
        (k) => typeof (item.draft as Record<string, unknown>)[k] === 'string',
      )
    )
      throw new Error('Invalid repayment storage');
    const a = item.attempt;
    if (
      a !== undefined &&
      (!object(a) ||
        a.groupId !== group ||
        a.currency !== 'USD' ||
        ![
          'key',
          'senderId',
          'recipientId',
          'amountMinor',
          'effectiveDate',
          'note',
        ].every((k) => typeof a[k] === 'string') ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          a.key as string,
        ))
    )
      throw new Error('Invalid repayment attempt');
  }
  return value as Record<string, SavedRepayment>;
}
export function readRepayment(actor: string, group: string) {
  const item = envelope()[group];
  if (item && item.actor !== actor)
    throw new Error('Different repayment actor');
  return item;
}
export function saveRepayment(value: SavedRepayment) {
  const all = envelope();
  all[value.group] = structuredClone(value);
  sessionStorage.setItem(repaymentStorageKey, JSON.stringify(all));
}
export function removeRepayment(group: string) {
  const all = envelope();
  delete all[group];
  sessionStorage.setItem(repaymentStorageKey, JSON.stringify(all));
}
/** Eligibility applies to new writes; frozen attempts recover under server authorization. */
export function validateRepayment(
  draft: RepaymentDraft,
  members: readonly Member[],
) {
  const errors: Record<string, string> = {};
  let amount = '0';
  try {
    amount = parseAmount(draft.amount);
  } catch (e) {
    errors.amount = (e as Error).message;
  }
  const eligible = new Set(
    members.filter((m) => m.canParticipate).map((m) => m.id),
  );
  if (!eligible.has(draft.sender))
    errors.sender = 'Choose a currently eligible sender in this group.';
  if (!eligible.has(draft.recipient) || draft.recipient === draft.sender)
    errors.recipient = 'Choose a distinct eligible recipient in this group.';
  if (!validDate(draft.date)) errors.date = 'Enter a valid calendar date.';
  if (!validText(draft.note) || [...draft.note].length > 2000)
    errors.note = 'Use at most 2,000 characters without invalid characters.';
  return { errors, amount };
}
