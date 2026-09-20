import { describe, expect, it } from 'vitest';
import { fixture } from './data/fixtures';
import type { ExpenseRecord, Snapshot } from './data/port';
import { equalSplit } from './ledger';
import { directObligations, overview } from './overview';

function empty(): Snapshot {
  const snapshot = fixture('empty', '2026-09-20');
  snapshot.members = ['a', 'b', 'c'].map((id) => ({
    id,
    name: id.toUpperCase(),
    role: 'member',
    status: 'active',
  }));
  snapshot.actorId = 'a';
  return snapshot;
}
function expense(
  id: string,
  payerId: string,
  amount: number,
  participants = ['a', 'b', 'c'],
): ExpenseRecord {
  return {
    id,
    payerId,
    amount,
    participantIds: participants,
    allocations: equalSplit(amount, participants),
    split: 'equal',
    currency: 'USD',
    effectiveDate: '2026-09-20',
    category: 'Other',
    tripId: null,
    description: id,
    note: '',
    creatorId: payerId,
    createdAt: '2026-09-20T12:00:00.000Z',
    updatedAt: '2026-09-20T12:00:00.000Z',
    version: 1,
  };
}

describe('independent overview financial acceptance probes', () => {
  it('retains actual payer relationships when a member is both creditor and direct debtor', () => {
    const data = overview(fixture('three-members', '2026-09-20'));
    expect(data.positions.map((row) => [row.memberId, row.net])).toEqual([
      ['member-k', 81217],
      ['member-m', 89662],
      ['member-r', -170879],
    ]);
    expect(data.obligations).toEqual([
      {
        senderId: 'member-k',
        recipientId: 'member-m',
        amount: 1984,
        currency: 'USD',
      },
      {
        senderId: 'member-r',
        recipientId: 'member-k',
        amount: 83201,
        currency: 'USD',
      },
      {
        senderId: 'member-r',
        recipientId: 'member-m',
        amount: 87678,
        currency: 'USD',
      },
    ]);
  });

  it('keeps a zero-position cycle rather than inventing a simplified settled graph', () => {
    const snapshot = empty();
    snapshot.expenses = [
      expense('ab', 'b', 1000, ['a']),
      expense('bc', 'c', 1000, ['b']),
      expense('ca', 'a', 1000, ['c']),
    ];
    const data = overview(snapshot);
    expect(data.positions.map((row) => row.net)).toEqual([0, 0, 0]);
    expect(data.obligations).toEqual([
      { senderId: 'a', recipientId: 'b', amount: 1000, currency: 'USD' },
      { senderId: 'b', recipientId: 'c', amount: 1000, currency: 'USD' },
      { senderId: 'c', recipientId: 'a', amount: 1000, currency: 'USD' },
    ]);
  });

  it('nets only bilateral obligations and reverses only the overpaid pair', () => {
    const snapshot = empty();
    snapshot.expenses = [
      expense('a-paid', 'a', 9000),
      expense('b-paid', 'b', 6000),
    ];
    expect(directObligations(snapshot, 'USD')).toEqual([
      { senderId: 'b', recipientId: 'a', amount: 1000, currency: 'USD' },
      { senderId: 'c', recipientId: 'a', amount: 3000, currency: 'USD' },
      { senderId: 'c', recipientId: 'b', amount: 2000, currency: 'USD' },
    ]);
    snapshot.repayments = [
      {
        id: 'repay-ca',
        senderId: 'c',
        recipientId: 'a',
        amount: 3500,
        currency: 'USD',
        effectiveDate: '2026-09-20',
        note: '',
        creatorId: 'c',
        createdAt: '2026-09-20T13:00:00.000Z',
      },
    ];
    const data = overview(snapshot);
    expect(data.obligations).toEqual([
      { senderId: 'a', recipientId: 'c', amount: 500, currency: 'USD' },
      { senderId: 'b', recipientId: 'a', amount: 1000, currency: 'USD' },
      { senderId: 'c', recipientId: 'b', amount: 2000, currency: 'USD' },
    ]);
    expect(data.positions.map((row) => row.net)).toEqual([500, 1000, -1500]);
    expect(data.positions.map((row) => row.paid)).toEqual([9000, 6000, 0]);
    expect(data.spending).toBe(15000);
  });

  it('excludes deleted expenses and zero shares while partitioning currencies', () => {
    const snapshot = empty();
    snapshot.expenses = [
      {
        ...expense('tiny', 'c', 1, ['a', 'b']),
        allocations: [
          { memberId: 'a', amount: 1 },
          { memberId: 'b', amount: 0 },
        ],
        split: 'exact',
      },
      { ...expense('deleted', 'a', 10000, ['b']), deleted: true },
      { ...expense('euro', 'b', 500, ['a']), currency: 'EUR' },
    ];
    expect(directObligations(snapshot, 'USD')).toEqual([
      { senderId: 'a', recipientId: 'c', amount: 1, currency: 'USD' },
    ]);
    expect(directObligations(snapshot, 'EUR')).toEqual([
      { senderId: 'a', recipientId: 'b', amount: 500, currency: 'EUR' },
    ]);
    expect(overview(snapshot).activeExpenseCount).toBe(1);
    expect(overview(snapshot).spending).toBe(1);
  });

  it('reconciles every direct graph back to member positions across many payers and repayments', () => {
    const snapshot = empty();
    for (let i = 1; i <= 60; i++) {
      snapshot.expenses.push({
        ...expense(`e${i}`, ['a', 'b', 'c'][i % 3], i * 97),
        deleted: i % 11 === 0,
      });
      snapshot.repayments.push({
        id: `r${i}`,
        senderId: ['a', 'b', 'c'][i % 3],
        recipientId: ['a', 'b', 'c'][(i + 1) % 3],
        amount: i * 13,
        currency: 'USD',
        effectiveDate: '2026-09-20',
        note: '',
        creatorId: 'a',
        createdAt: '2026-09-20T13:00:00.000Z',
      });
    }
    const data = overview(snapshot);
    for (const member of data.positions) {
      const graphPosition = data.obligations.reduce(
        (sum, row) =>
          sum +
          (row.recipientId === member.memberId ? row.amount : 0) -
          (row.senderId === member.memberId ? row.amount : 0),
        0,
      );
      expect(graphPosition).toBe(member.net);
    }
  });
});
