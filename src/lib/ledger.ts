/** Exact, currency-partitioned ledger rules. No storage or UI dependencies. */
export const MAX_AMOUNT = 999_999_999; // $9,999,999.99 per USD record
export type Currency = 'USD' | 'EUR'; // USD only is enabled by the seed adapter.
export type MemberId = string;
export type Allocation = Readonly<{ memberId: MemberId; amount: number }>;
export type Expense = Readonly<{
  id: string;
  amount: number;
  currency: Currency;
  effectiveDate: string;
  payerId: MemberId;
  participantIds: readonly MemberId[];
  allocations: readonly Allocation[];
  split: 'equal' | 'exact';
  category: string;
  tripId: string | null;
  deleted?: boolean;
}>;
export type Repayment = Readonly<{
  id: string;
  amount: number;
  currency: Currency;
  senderId: MemberId;
  recipientId: MemberId;
}>;

export function checkedSum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(total + value))
      throw new Error('Amount exceeds safe ledger range');
    total += value;
  }
  return total;
}

export function validateAmount(value: number, allowZero = false): void {
  if (
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > MAX_AMOUNT
  )
    throw new Error('Enter an exact amount within the supported range');
}

export function parseMoney(input: string, allowZero = false): number {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(input))
    throw new Error('Use up to seven whole digits and two decimal places');
  const [whole, fraction = ''] = input.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  validateAmount(amount, allowZero);
  return amount;
}

export function formatMoney(
  amount: number,
  currency: Currency = 'USD',
): string {
  checkedSum([amount]);
  const absolute = BigInt(amount < 0 ? -amount : amount);
  return `${amount < 0 ? '-' : ''}${(absolute / 100n).toLocaleString('en-US')}.${String(absolute % 100n).padStart(2, '0')} ${currency}`;
}

function uniqueIds(ids: readonly string[]): void {
  if (
    !ids.length ||
    ids.some((id) => !id.trim()) ||
    new Set(ids).size !== ids.length
  )
    throw new Error('Select distinct, stable member IDs');
}

/** Remainder cents go to ascending opaque member IDs, independent of UI order. */
export function equalSplit(
  amount: number,
  participants: readonly MemberId[],
): Allocation[] {
  validateAmount(amount);
  uniqueIds(participants);
  const ids = [...participants].sort();
  const base = Math.floor(amount / ids.length);
  const remainder = amount % ids.length;
  return ids.map((memberId, index) => ({
    memberId,
    amount: base + (index < remainder ? 1 : 0),
  }));
}

export function reconcile(
  amount: number,
  participants: readonly MemberId[],
  allocations: readonly Allocation[],
): number {
  validateAmount(amount);
  uniqueIds(participants);
  uniqueIds(allocations.map((row) => row.memberId));
  if (
    allocations.length !== participants.length ||
    allocations.some((row) => !participants.includes(row.memberId))
  )
    throw new Error('Every participant must have exactly one allocation');
  allocations.forEach((row) => validateAmount(row.amount, true));
  return checkedSum([
    amount,
    -checkedSum(allocations.map((row) => row.amount)),
  ]);
}

export function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(`${date}T00:00:00.000Z`);
  return (
    Number.isFinite(value.getTime()) &&
    value.toISOString().slice(0, 10) === date
  );
}

export function validateExpense(
  expense: Expense,
  members: readonly MemberId[],
): void {
  if (
    !expense.id ||
    !members.includes(expense.payerId) ||
    expense.participantIds.some((id) => !members.includes(id))
  )
    throw new Error('Unknown expense or member identity');
  if (
    !['USD', 'EUR'].includes(expense.currency) ||
    !validDate(expense.effectiveDate)
  )
    throw new Error('Invalid currency or effective date');
  if (
    reconcile(expense.amount, expense.participantIds, expense.allocations) !== 0
  )
    throw new Error('Allocations must equal the expense total');
  if (!['equal', 'exact'].includes(expense.split))
    throw new Error('Invalid split method');
  if (expense.split === 'equal') {
    const expected = equalSplit(expense.amount, expense.participantIds);
    if (
      expected.some(
        (row) =>
          expense.allocations.find((actual) => actual.memberId === row.memberId)
            ?.amount !== row.amount,
      )
    )
      throw new Error('Equal allocations do not match stable remainder order');
  }
}

export type Position = {
  memberId: MemberId;
  paid: number;
  share: number;
  sent: number;
  received: number;
  net: number;
};

/** Input is one current snapshot per record, never a revision history. */
export function positions(
  members: readonly MemberId[],
  expenses: readonly Expense[],
  repayments: readonly Repayment[],
  currency: Currency,
): Position[] {
  uniqueIds(members);
  if (
    new Set(expenses.map((row) => row.id)).size !== expenses.length ||
    new Set(repayments.map((row) => row.id)).size !== repayments.length
  )
    throw new Error('Supply each current record once');
  expenses.forEach((expense) => validateExpense(expense, members));
  repayments.forEach((repayment) => {
    validateAmount(repayment.amount);
    if (
      !repayment.id ||
      !['USD', 'EUR'].includes(repayment.currency) ||
      !members.includes(repayment.senderId) ||
      !members.includes(repayment.recipientId) ||
      repayment.senderId === repayment.recipientId
    )
      throw new Error(
        'Repayment requires distinct known members and a supported currency',
      );
  });
  const active = expenses.filter(
    (row) => !row.deleted && row.currency === currency,
  );
  const transfers = repayments.filter((row) => row.currency === currency);
  return members.map((memberId) => {
    const paid = checkedSum(
      active.filter((row) => row.payerId === memberId).map((row) => row.amount),
    );
    const share = checkedSum(
      active.flatMap((row) =>
        row.allocations
          .filter((allocation) => allocation.memberId === memberId)
          .map((allocation) => allocation.amount),
      ),
    );
    const sent = checkedSum(
      transfers
        .filter((row) => row.senderId === memberId)
        .map((row) => row.amount),
    );
    const received = checkedSum(
      transfers
        .filter((row) => row.recipientId === memberId)
        .map((row) => row.amount),
    );
    return {
      memberId,
      paid,
      share,
      sent,
      received,
      net: checkedSum([paid, -share, sent, -received]),
    };
  });
}

export type SpendFilter = {
  currency: Currency;
  memberId?: MemberId;
  tripId?: string;
  category?: string;
  start?: string;
  end?: string;
};
export function spending(
  expenses: readonly Expense[],
  filter: SpendFilter,
): { total: number; count: number; expenses: Expense[] } {
  if (new Set(expenses.map((row) => row.id)).size !== expenses.length)
    throw new Error('Supply each current record once');
  const selected = expenses.filter(
    (row) =>
      !row.deleted &&
      row.currency === filter.currency &&
      (!filter.tripId || row.tripId === filter.tripId) &&
      (!filter.category || row.category === filter.category) &&
      (!filter.start || row.effectiveDate >= filter.start) &&
      (!filter.end || row.effectiveDate <= filter.end) &&
      (!filter.memberId || row.participantIds.includes(filter.memberId)),
  );
  const total = checkedSum(
    selected.map((row) =>
      filter.memberId
        ? row.allocations.find(
            (allocation) => allocation.memberId === filter.memberId,
          )!.amount
        : row.amount,
    ),
  );
  return { total, count: selected.length, expenses: selected };
}
