import type { RepaymentInput, Snapshot } from './data/port';
import { checkedSum, parseMoney, validDate } from './ledger';
import { directObligations } from './overview';

export type RepaymentDraft = {
  senderId: string;
  recipientId: string;
  amount: string;
  effectiveDate: string;
  note: string;
  acknowledged: boolean;
  acknowledgedBefore: number | null;
};
export function repaymentDefaults(snapshot: Snapshot): RepaymentDraft {
  const active = snapshot.members.filter(
    (member) => member.status === 'active',
  );
  const debt = directObligations(snapshot, snapshot.household.currency);
  const pair =
    active.length === 2
      ? debt.find((row) =>
          active.every((member) =>
            [row.senderId, row.recipientId].includes(member.id),
          ),
        )
      : undefined;
  return {
    senderId: pair?.senderId ?? '',
    recipientId: pair?.recipientId ?? '',
    amount: pair
      ? `${Math.floor(pair.amount / 100)}.${String(pair.amount % 100).padStart(2, '0')}`
      : '',
    effectiveDate: snapshot.today,
    note: '',
    acknowledged: false,
    acknowledgedBefore: null,
  };
}
/** Positive values mean sender owes recipient; negative values name the opposite direction. */
export function repaymentPreview(
  snapshot: Snapshot,
  senderId: string,
  recipientId: string,
  amount: number,
) {
  const edge = directObligations(snapshot, snapshot.household.currency).find(
    (row) =>
      (row.senderId === senderId && row.recipientId === recipientId) ||
      (row.senderId === recipientId && row.recipientId === senderId),
  );
  const before = edge
    ? edge.senderId === senderId
      ? edge.amount
      : -edge.amount
    : 0;
  const after = checkedSum([before, -amount]);
  return { before, after, requiresAcknowledgment: after < 0 };
}
export function validateRepaymentDraft(
  values: RepaymentDraft,
  snapshot: Snapshot,
) {
  const fields: Record<string, string> = {};
  const active = snapshot.members
    .filter((member) => member.status === 'active')
    .map((member) => member.id);
  if (!active.includes(values.senderId))
    fields.senderId = 'Choose an active sender.';
  if (
    !active.includes(values.recipientId) ||
    values.senderId === values.recipientId
  )
    fields.recipientId = 'Choose a different active recipient.';
  let amount: number | undefined;
  try {
    amount = parseMoney(values.amount);
  } catch {
    fields.amount = 'Enter a positive amount with up to two decimal places.';
  }
  if (!validDate(values.effectiveDate))
    fields.effectiveDate = 'Enter a valid date.';
  if (values.note.length > 2000) fields.note = 'Use at most 2,000 characters.';
  const preview =
    amount !== undefined && !fields.senderId && !fields.recipientId
      ? repaymentPreview(snapshot, values.senderId, values.recipientId, amount)
      : undefined;
  if (
    preview?.requiresAcknowledgment &&
    (!values.acknowledged || values.acknowledgedBefore !== preview.before)
  )
    fields.acknowledged = 'Acknowledge the balance in the opposite direction.';
  const value: RepaymentInput | undefined =
    !Object.keys(fields).length && amount !== undefined
      ? {
          senderId: values.senderId,
          recipientId: values.recipientId,
          amount,
          currency: snapshot.household.currency,
          effectiveDate: values.effectiveDate,
          note: values.note,
        }
      : undefined;
  return { fields, preview, value };
}
