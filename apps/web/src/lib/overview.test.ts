import { describe, expect, it } from 'vitest';
import { fixture } from './data/fixtures';
import { directObligations, overview } from './overview';
import { checkedSum } from './ledger';

describe('overview financial selectors', () => {
  it('matches approved household money and excludes repayment from contributions', () => {
    const data = overview(fixture('sample', '2026-09-20'));
    expect(data.obligations).toEqual([
      {
        senderId: 'member-k',
        recipientId: 'member-m',
        amount: 4218,
        currency: 'USD',
      },
    ]);
    expect(data.positions.map((row) => row.paid)).toEqual([249610, 263046]);
    expect(data.spending).toBe(512656);
    expect(data.recent.some((event) => event.kind === 'repayment')).toBe(true);
  });
  it('handles exact three-member positions with direct unsimplified obligations', () => {
    const data = overview(fixture('three-members', '2026-09-20'));
    expect(data.positions.map((row) => [row.paid, row.share, row.net])).toEqual(
      [
        [249610, 170893, 81217],
        [263046, 170884, 89662],
        [0, 170879, -170879],
      ],
    );
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
    expect(checkedSum(data.positions.map((row) => row.net))).toBe(0);
  });
  it('settles exactly, reverses overpayment, and never adds repayment to spending', () => {
    const snapshot = fixture('sample', '2026-09-20');
    snapshot.repayments.push({
      ...snapshot.repayments[0],
      id: 'settle',
      amount: 4218,
    });
    expect(directObligations(snapshot, 'USD')).toEqual([]);
    snapshot.repayments[snapshot.repayments.length - 1] = {
      ...snapshot.repayments.at(-1)!,
      amount: 5000,
    };
    expect(directObligations(snapshot, 'USD')).toEqual([
      {
        senderId: 'member-m',
        recipientId: 'member-k',
        amount: 782,
        currency: 'USD',
      },
    ]);
    expect(overview(snapshot).spending).toBe(512656);
  });
  it('uses current active expense revisions and keeps empty data distinct from loading', () => {
    const snapshot = fixture('sample', '2026-09-20');
    snapshot.expenses[0] = { ...snapshot.expenses[0], deleted: true };
    expect(overview(snapshot).spending).toBe(504220);
    expect(overview(fixture('empty', '2026-09-20')).obligations).toEqual([]);
  });
});
