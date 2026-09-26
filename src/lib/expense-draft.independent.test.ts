import { describe, expect, it } from 'vitest';
import { fixture } from './data/fixtures';
import { defaultExpenseDraft, validateExpenseDraft } from './expense-draft';

describe('independent add-expense draft requirements', () => {
  it('defaults active membership and clamps only the suggested trip date', () => {
    const snapshot = fixture('three-members', '2026-09-20');
    snapshot.members[2].status = 'inactive';
    expect(defaultExpenseDraft(snapshot)).toMatchObject({
      payerId: 'member-k',
      participantIds: ['member-k', 'member-m'],
      split: 'equal',
      currency: 'USD',
      effectiveDate: '2026-09-20',
    });
    expect(defaultExpenseDraft(snapshot, 'maui')).toMatchObject({
      tripId: 'maui',
      effectiveDate: '2026-09-13',
    });
    expect(defaultExpenseDraft(snapshot, 'porto')).toMatchObject({
      tripId: 'porto',
      effectiveDate: '2027-05-12',
    });
    const draft = {
      ...defaultExpenseDraft(snapshot, 'porto'),
      amount: '10.01',
      description: 'Advance booking',
      effectiveDate: '2026-09-01',
    };
    expect(validateExpenseDraft(draft, snapshot).value?.effectiveDate).toBe(
      '2026-09-01',
    );
  });
  it('accepts a nonparticipating payer and preserves an explicitly included zero share', () => {
    const snapshot = fixture('three-members', '2026-09-20');
    const draft = {
      ...defaultExpenseDraft(snapshot),
      amount: '10.01',
      description: 'Three-member purchase',
      participantIds: ['member-m', 'member-r'],
    };
    const equal = validateExpenseDraft(draft, snapshot);
    expect(equal.value?.payerId).toBe('member-k');
    expect(equal.allocations).toEqual([
      { memberId: 'member-m', amount: 501 },
      { memberId: 'member-r', amount: 500 },
    ]);
    const exact = validateExpenseDraft(
      {
        ...draft,
        split: 'exact',
        exact: { 'member-m': '10.01', 'member-r': '0' },
      },
      snapshot,
    );
    expect(exact.value?.participantIds).toEqual(['member-m', 'member-r']);
    expect(exact.value?.allocations).toEqual([
      { memberId: 'member-m', amount: 1001 },
      { memberId: 'member-r', amount: 0 },
    ]);
    expect(
      validateExpenseDraft(
        {
          ...draft,
          split: 'exact',
          exact: { 'member-m': '10.01', 'member-r': '' },
        },
        snapshot,
      ).fields['allocation-member-r'],
    ).toBeTruthy();
  });
  it('rejects hidden invalid fields and incomplete participant membership independently of reconciliation', () => {
    const snapshot = fixture('sample', '2026-09-20');
    const draft = {
      ...defaultExpenseDraft(snapshot),
      amount: '10.01',
      description: 'Valid',
    };
    for (const amount of ['0', '-1', '1.001', '10000000', '1e3'])
      expect(
        validateExpenseDraft({ ...draft, amount }, snapshot).fields.amount,
      ).toBeTruthy();
    expect(
      validateExpenseDraft({ ...draft, description: '  ' }, snapshot).fields
        .description,
    ).toBeTruthy();
    expect(
      validateExpenseDraft({ ...draft, effectiveDate: '2026-02-29' }, snapshot)
        .fields.effectiveDate,
    ).toBeTruthy();
    expect(
      validateExpenseDraft({ ...draft, participantIds: [] }, snapshot).fields
        .participantIds,
    ).toBeTruthy();
    expect(
      validateExpenseDraft(
        { ...draft, participantIds: ['member-k', 'member-k'] },
        snapshot,
      ).fields.participantIds,
    ).toBeTruthy();
    expect(
      validateExpenseDraft({ ...draft, payerId: 'stranger' }, snapshot).fields
        .payerId,
    ).toBeTruthy();
    expect(
      validateExpenseDraft({ ...draft, currency: 'EUR' }, snapshot).fields
        .currency,
    ).toBeTruthy();
  });
  it('reports exact remaining and excess minor units instead of rounding shares', () => {
    const snapshot = fixture('sample', '2026-09-20');
    const draft = {
      ...defaultExpenseDraft(snapshot),
      amount: '40',
      description: 'Exact',
      split: 'exact' as const,
      exact: { 'member-k': '15', 'member-m': '20' },
    };
    expect(validateExpenseDraft(draft, snapshot).remaining).toBe(500);
    expect(
      validateExpenseDraft(
        { ...draft, exact: { 'member-k': '15', 'member-m': '25.01' } },
        snapshot,
      ).remaining,
    ).toBe(-1);
    expect(
      validateExpenseDraft(
        { ...draft, exact: { 'member-k': '15', 'member-m': '25' } },
        snapshot,
      ).value?.amount,
    ).toBe(4000);
  });
});
