import { describe, expect, it } from 'vitest';
import { fixture } from './data/fixtures';
import {
  repaymentDefaults,
  repaymentPreview,
  validateRepaymentDraft,
} from './repayment-draft';
import { overview } from './overview';

describe('repayment drafts and exact pair preview', () => {
  const snapshot = fixture('sample', '2026-09-20');
  it('defaults the two-member debt in its named direction', () => {
    expect(repaymentDefaults(snapshot)).toMatchObject({
      senderId: 'member-k',
      recipientId: 'member-m',
      amount: '42.18',
    });
    expect(
      repaymentDefaults(fixture('three-members', '2026-09-20')),
    ).toMatchObject({ senderId: '', recipientId: '', amount: '' });
    expect(repaymentDefaults(fixture('empty', '2026-09-20')).amount).toBe('');
  });
  it.each([
    [100, 4118, false],
    [4218, 0, false],
    [4219, -1, true],
  ])('previews %i exactly', (amount, after, requiresAcknowledgment) => {
    expect(repaymentPreview(snapshot, 'member-k', 'member-m', amount)).toEqual({
      before: 4218,
      after,
      requiresAcknowledgment,
    });
  });
  it('requires acknowledgment for an opposite-direction payment', () => {
    const values = {
      ...repaymentDefaults(snapshot),
      senderId: 'member-m',
      recipientId: 'member-k',
      amount: '1.00',
    };
    expect(
      validateRepaymentDraft(values, snapshot).fields.acknowledged,
    ).toBeTruthy();
    expect(
      validateRepaymentDraft(
        { ...values, acknowledged: true, acknowledgedBefore: -4218 },
        snapshot,
      ).preview?.after,
    ).toBe(-4318);
  });
  it.each(['0', '-1', '1.001', '1e2'])(
    'rejects invalid amount %s',
    (amount) => {
      expect(
        validateRepaymentDraft(
          { ...repaymentDefaults(snapshot), amount },
          snapshot,
        ).value,
      ).toBeUndefined();
    },
  );
  it('rejects same member and invalid date', () => {
    const result = validateRepaymentDraft(
      {
        ...repaymentDefaults(snapshot),
        recipientId: 'member-k',
        effectiveDate: '2026-02-30',
      },
      snapshot,
    );
    expect(result.fields.recipientId).toBeTruthy();
    expect(result.fields.effectiveDate).toBeTruthy();
  });
  it('updates equal/opposite positions without changing spending or contributions', () => {
    const before = overview(snapshot);
    const value = validateRepaymentDraft(
      repaymentDefaults(snapshot),
      snapshot,
    ).value!;
    const after = overview({
      ...snapshot,
      repayments: [
        ...snapshot.repayments,
        {
          ...value,
          id: 'new',
          creatorId: snapshot.actorId,
          createdAt: '2026-09-20T12:00:00Z',
        },
      ],
    });
    expect(after.positions.map((row) => row.net)).toEqual([0, 0]);
    expect(after.spending).toBe(before.spending);
    expect(after.positions.map((row) => row.paid)).toEqual(
      before.positions.map((row) => row.paid),
    );
  });
});
