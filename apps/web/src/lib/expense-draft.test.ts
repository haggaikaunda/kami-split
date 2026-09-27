import { describe, expect, it } from 'vitest';
import { fixture } from './data/fixtures';
import { defaultExpenseDraft, validateExpenseDraft } from './expense-draft';
const snapshot = fixture('three-members', '2026-09-20');
function draft() {
  return {
    ...defaultExpenseDraft(snapshot),
    amount: '10.01',
    description: 'Shared meal',
  };
}
describe('new expense draft rules', () => {
  it('uses current actor, active membership, equal split and editable trip-clamped dates', () => {
    expect(defaultExpenseDraft(snapshot)).toMatchObject({
      payerId: 'member-k',
      participantIds: ['member-k', 'member-m', 'member-r'],
      split: 'equal',
      currency: 'USD',
      effectiveDate: '2026-09-20',
    });
    expect(defaultExpenseDraft(snapshot, 'maui').effectiveDate).toBe(
      '2026-09-13',
    );
    expect(defaultExpenseDraft(snapshot, 'porto').effectiveDate).toBe(
      '2027-05-12',
    );
    const valid = validateExpenseDraft(
      { ...draft(), tripId: 'maui', effectiveDate: '2026-08-01' },
      snapshot,
    );
    expect(valid.fields).toEqual({});
    expect(valid.value?.effectiveDate).toBe('2026-08-01');
  });
  it('reconciles deterministic odd cents and supports a nonparticipating payer', () => {
    const result = validateExpenseDraft(
      {
        ...draft(),
        payerId: 'member-r',
        participantIds: ['member-m', 'member-k'],
      },
      snapshot,
    );
    expect(result.remaining).toBe(0);
    expect(result.value?.allocations).toEqual([
      { memberId: 'member-k', amount: 501 },
      { memberId: 'member-m', amount: 500 },
    ]);
  });
  it.each(['0', '-1', '1.001', '1e2', '10000000', 'NaN'])(
    'rejects unsafe or non-exact amount %s',
    (amount) => {
      expect(
        validateExpenseDraft({ ...draft(), amount }, snapshot).fields.amount,
      ).toBeTruthy();
    },
  );
  it('preserves explicit zero shares and reports remaining and excess amounts exactly', () => {
    const exact = {
      ...draft(),
      participantIds: ['member-k', 'member-m'],
      split: 'exact' as const,
      exact: { 'member-k': '10.01', 'member-m': '0' },
    };
    expect(validateExpenseDraft(exact, snapshot).value?.allocations[1]).toEqual(
      { memberId: 'member-m', amount: 0 },
    );
    expect(
      validateExpenseDraft(
        { ...exact, exact: { ...exact.exact, 'member-k': '10' } },
        snapshot,
      ).remaining,
    ).toBe(1);
    expect(
      validateExpenseDraft(
        { ...exact, exact: { ...exact.exact, 'member-k': '11' } },
        snapshot,
      ).remaining,
    ).toBe(-99);
    expect(
      validateExpenseDraft(
        { ...exact, exact: { ...exact.exact, 'member-m': '' } },
        snapshot,
      ).fields['allocation-member-m'],
    ).toBeTruthy();
  });
  it('rejects all missing identities/required fields without normalizing invalid input away', () => {
    expect(
      validateExpenseDraft(
        {
          ...draft(),
          description: ' ',
          effectiveDate: '',
          participantIds: [],
          payerId: 'stranger',
          tripId: 'missing',
          currency: 'EUR',
          note: 'x'.repeat(2001),
        },
        snapshot,
      ).fields,
    ).toMatchObject({
      description: expect.any(String),
      effectiveDate: expect.any(String),
      participantIds: expect.any(String),
      payerId: expect.any(String),
      tripId: expect.any(String),
      currency: expect.any(String),
      note: expect.any(String),
    });
  });
});
