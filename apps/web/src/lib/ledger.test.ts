import { describe, expect, it } from 'vitest';
import {
  checkedSum,
  equalSplit,
  formatMoney,
  MAX_AMOUNT,
  parseMoney,
  positions,
  reconcile,
  spending,
  validateExpense,
  validDate,
  type Expense,
} from './ledger';

const members = ['member-a', 'member-b', 'member-c'];
const expense: Expense = {
  id: 'expense-1',
  amount: 1001,
  currency: 'USD',
  effectiveDate: '2026-09-20',
  payerId: 'member-c',
  participantIds: ['member-b', 'member-a'],
  allocations: equalSplit(1001, ['member-b', 'member-a']),
  split: 'equal',
  category: 'Dining',
  tripId: 'maui',
};

describe('exact money', () => {
  it('parses decimal text without rounding and formats signed integers', () => {
    expect(parseMoney('10.01')).toBe(1001);
    expect(parseMoney('0.01')).toBe(1);
    expect(parseMoney('9999999.99')).toBe(MAX_AMOUNT);
    expect(formatMoney(-1001)).toBe('-10.01 USD');
    expect(formatMoney(123456, 'EUR')).toBe('1,234.56 EUR');
    expect(parseMoney('0', true)).toBe(0);
  });
  it.each([
    '0',
    '-1',
    '1.001',
    '1e3',
    'NaN',
    'Infinity',
    '1,000',
    '.50',
    '1.',
    ' 1 ',
    '10000000',
    '9007199254740991',
  ])('rejects %s', (input) => {
    expect(() => parseMoney(input)).toThrow();
  });
  it('checks accumulation and accepts no fractional minor units', () => {
    expect(() => checkedSum([Number.MAX_SAFE_INTEGER, 1])).toThrow();
    expect(() => checkedSum([0.1])).toThrow();
    expect(() => equalSplit(MAX_AMOUNT + 1, members)).toThrow();
  });
  it('allocates deterministic remainder cents regardless of selection order', () => {
    expect(equalSplit(1001, ['member-b', 'member-a'])).toEqual([
      { memberId: 'member-a', amount: 501 },
      { memberId: 'member-b', amount: 500 },
    ]);
    for (let amount = 1; amount <= 10001; amount += 17) {
      const shares = equalSplit(amount, [...members].reverse());
      expect(reconcile(amount, members, shares)).toBe(0);
      expect(
        Math.max(...shares.map((row) => row.amount)) -
          Math.min(...shares.map((row) => row.amount)),
      ).toBeLessThanOrEqual(1);
    }
  });
  it('preserves zero shares while rejecting missing, duplicate and unknown allocations', () => {
    const exact = {
      ...expense,
      split: 'exact' as const,
      allocations: [
        { memberId: 'member-a', amount: 1001 },
        { memberId: 'member-b', amount: 0 },
      ],
    };
    expect(() => validateExpense(exact, members)).not.toThrow();
    expect(
      spending([exact], { currency: 'USD', memberId: 'member-b' }),
    ).toMatchObject({ total: 0, count: 1 });
    expect(() =>
      reconcile(1001, expense.participantIds, exact.allocations.slice(0, 1)),
    ).toThrow();
    expect(() => equalSplit(1, ['member-a', 'member-a'])).toThrow();
    expect(() => equalSplit(1, [])).toThrow();
    expect(() =>
      validateExpense({ ...exact, payerId: 'stranger' }, members),
    ).toThrow();
    expect(() =>
      validateExpense({ ...exact, split: 'equal' }, members),
    ).toThrow();
    expect(
      reconcile(
        4000,
        ['member-a', 'member-b'],
        [
          { memberId: 'member-a', amount: 1500 },
          { memberId: 'member-b', amount: 2000 },
        ],
      ),
    ).toBe(500);
  });
});

describe('current ledger selectors', () => {
  it('supports three members and a nonparticipating payer with zero-sum positions', () => {
    const result = positions(members, [expense], [], 'USD');
    expect(result.map((row) => row.net)).toEqual([-501, -500, 1001]);
    expect(checkedSum(result.map((row) => row.net))).toBe(0);
    expect(checkedSum(result.map((row) => row.paid))).toBe(1001);
    expect(checkedSum(result.map((row) => row.share))).toBe(1001);
  });
  it('repayments settle or reverse equally and leave contributions/spending unchanged', () => {
    const repayment = {
      id: 'repayment-1',
      amount: 501,
      currency: 'USD' as const,
      senderId: 'member-a',
      recipientId: 'member-c',
    };
    const settled = positions(members, [expense], [repayment], 'USD');
    expect(settled.map((row) => row.net)).toEqual([0, -500, 500]);
    expect(settled.map((row) => row.paid)).toEqual([0, 0, 1001]);
    expect(
      positions(members, [expense], [{ ...repayment, amount: 600 }], 'USD').map(
        (row) => row.net,
      ),
    ).toEqual([99, -500, 401]);
    expect(spending([expense], { currency: 'USD' }).total).toBe(1001);
    expect(() =>
      positions(
        members,
        [],
        [{ ...repayment, recipientId: 'member-a' }],
        'USD',
      ),
    ).toThrow();
  });
  it('partitions currencies and recomputes effective-date/trip buckets after edits and deletion', () => {
    const euro = { ...expense, id: 'expense-eur', currency: 'EUR' as const };
    expect(spending([expense, euro], { currency: 'USD' }).total).toBe(1001);
    expect(
      positions(members, [expense, euro], [], 'EUR').map((row) => row.net),
    ).toEqual([-501, -500, 1001]);
    const moved = { ...expense, effectiveDate: '2026-10-01', tripId: null };
    expect(
      spending([moved], { currency: 'USD', end: '2026-09-30' }).total,
    ).toBe(0);
    expect(spending([moved], { currency: 'USD', tripId: 'maui' }).count).toBe(
      0,
    );
    const deleted = { ...expense, deleted: true };
    expect(spending([deleted], { currency: 'USD' }).count).toBe(0);
    expect(
      positions(members, [deleted], [], 'USD').map((row) => row.net),
    ).toEqual([0, 0, 0]);
    expect(() => spending([expense, expense], { currency: 'USD' })).toThrow();
  });
  it('validates real calendar dates without local timezone conversion', () => {
    expect(validDate('2024-02-29')).toBe(true);
    expect(validDate('2026-02-29')).toBe(false);
    expect(validDate('2026-13-01')).toBe(false);
  });
});
