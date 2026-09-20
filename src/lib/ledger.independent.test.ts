import { describe, expect, it } from 'vitest';
import {
  equalSplit,
  formatMoney,
  MAX_AMOUNT,
  parseMoney,
  positions,
  spending,
  validateAmount,
  validateExpense,
  type Currency,
  type Expense,
  type Repayment,
} from './ledger';

const members = ['alpha', 'beta', 'gamma', 'delta'];
function makeExpense(
  id: string,
  amount: number,
  currency: Currency = 'USD',
): Expense {
  return {
    id,
    amount,
    currency,
    payerId: 'delta',
    participantIds: ['gamma', 'alpha', 'beta'],
    allocations: equalSplit(amount, ['gamma', 'alpha', 'beta']),
    effectiveDate: '2026-09-20',
    split: 'equal',
    category: 'food',
    tripId: 'trip',
  };
}

describe('independent issue 14 acceptance probes', () => {
  it('round trips cents and rejects numeric boundary failures', () => {
    for (const value of [1, 9, 10, 99, 100, 101, 1001, MAX_AMOUNT]) {
      const text = `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
      expect(parseMoney(text)).toBe(value);
      expect(formatMoney(value).replaceAll(',', '')).toBe(`${text} USD`);
    }
    for (const value of [
      0,
      -1,
      0.5,
      NaN,
      Infinity,
      MAX_AMOUNT + 1,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => validateAmount(value)).toThrow();
    }
    expect(formatMoney(Number.MAX_SAFE_INTEGER)).toBe(
      '90,071,992,547,409.91 USD',
    );
    expect(formatMoney(-Number.MAX_SAFE_INTEGER)).toBe(
      '-90,071,992,547,409.91 USD',
    );
  });

  it('conserves mixed-currency totals across many unequal remainders and repayments', () => {
    const expenses: Expense[] = [];
    const repayments: Repayment[] = [];
    for (let i = 1; i <= 150; i++) {
      const currency = i % 2 ? 'USD' : 'EUR';
      const amount = i * 997;
      const participants = members.slice(0, 1 + (i % 3)).reverse();
      expenses.push({
        ...makeExpense(`e${i}`, amount, currency),
        participantIds: participants,
        allocations: equalSplit(amount, participants),
        deleted: i % 7 === 0,
      });
      repayments.push({
        id: `r${i}`,
        amount: i * 19,
        currency,
        senderId: members[i % 3],
        recipientId: 'delta',
      });
    }
    for (const currency of ['USD', 'EUR'] as const) {
      const result = positions(members, expenses, repayments, currency);
      const before = positions(members, expenses, [], currency);
      const total = expenses
        .filter((e) => !e.deleted && e.currency === currency)
        .reduce((sum, e) => sum + e.amount, 0);
      expect(result.reduce((sum, p) => sum + p.net, 0)).toBe(0);
      expect(result.reduce((sum, p) => sum + p.paid, 0)).toBe(total);
      expect(result.reduce((sum, p) => sum + p.share, 0)).toBe(total);
      expect(result.map((p) => p.paid)).toEqual(before.map((p) => p.paid));
      expect(spending(expenses, { currency }).total).toBe(total);
      for (const position of result) {
        const delta = repayments
          .filter((r) => r.currency === currency)
          .reduce(
            (sum, r) =>
              sum +
              (r.senderId === position.memberId ? r.amount : 0) -
              (r.recipientId === position.memberId ? r.amount : 0),
            0,
          );
        expect(
          position.net -
            before.find((p) => p.memberId === position.memberId)!.net,
        ).toBe(delta);
      }
    }
  });

  it('preserves equal zero shares and excludes nonparticipating payer from member spending', () => {
    const expense = makeExpense('small', 1);
    expect(expense.allocations.map((a) => a.amount)).toEqual([1, 0, 0]);
    expect(
      spending([expense], { currency: 'USD', memberId: 'beta' }),
    ).toMatchObject({ total: 0, count: 1 });
    expect(
      spending([expense], { currency: 'USD', memberId: 'delta' }),
    ).toMatchObject({ total: 0, count: 0 });
    expect(positions(members, [expense], [], 'USD').map((p) => p.net)).toEqual([
      -1, 0, 0, 1,
    ]);
  });

  it('rejects unbalanced, negative, unknown, duplicate and omitted shares', () => {
    const expense = makeExpense('validation', 3);
    for (const allocations of [
      [
        { memberId: 'alpha', amount: 2 },
        { memberId: 'beta', amount: 1 },
        { memberId: 'gamma', amount: 1 },
      ],
      [
        { memberId: 'alpha', amount: -1 },
        { memberId: 'beta', amount: 3 },
        { memberId: 'gamma', amount: 1 },
      ],
      [
        { memberId: 'stranger', amount: 1 },
        { memberId: 'beta', amount: 1 },
        { memberId: 'gamma', amount: 1 },
      ],
      [
        { memberId: 'alpha', amount: 1 },
        { memberId: 'alpha', amount: 1 },
        { memberId: 'gamma', amount: 1 },
      ],
      [{ memberId: 'alpha', amount: 3 }],
    ])
      expect(() =>
        validateExpense({ ...expense, split: 'exact', allocations }, members),
      ).toThrow();
    expect(() => positions(members, [expense, expense], [], 'USD')).toThrow();
    const repayment: Repayment = {
      id: 'repay',
      amount: 1,
      currency: 'USD',
      senderId: 'alpha',
      recipientId: 'delta',
    };
    expect(() =>
      positions(members, [], [repayment, repayment], 'USD'),
    ).toThrow();
    expect(() =>
      positions(members, [], [{ ...repayment, senderId: 'stranger' }], 'USD'),
    ).toThrow();
  });

  it('recomputes edited amount, payer, category and inclusive effective-date filters', () => {
    const edited: Expense = {
      ...makeExpense('current', 9),
      payerId: 'beta',
      category: 'travel',
      effectiveDate: '2026-10-01',
    };
    expect(positions(members, [edited], [], 'USD').map((p) => p.net)).toEqual([
      -3, 6, -3, 0,
    ]);
    expect(
      spending([edited], { currency: 'USD', category: 'food' }).count,
    ).toBe(0);
    expect(
      spending([edited], {
        currency: 'USD',
        start: '2026-10-01',
        end: '2026-10-01',
        tripId: 'trip',
        category: 'travel',
      }).total,
    ).toBe(9);
    expect(
      spending([{ ...edited, deleted: true }], { currency: 'USD' }).total,
    ).toBe(0);
  });
});
