import { expect, it } from 'vitest';
import { expenseFilter, expenseFilterText } from './expense-filter';

it('preserves same-day inclusive bounds and cross-year calendar bounds without instant conversion', () => {
  for (const [from, to] of [
    ['2026-03-08', '2026-03-08'],
    ['2026-12-31', '2027-01-01'],
  ]) {
    const text = expenseFilterText(
      new URLSearchParams({
        from,
        to,
        category: 'DINING',
        unrelated: 'ignored',
      }),
    );
    expect(expenseFilter(text)).toEqual({
      groupId: null,
      category: 'DINING',
      memberId: null,
      from,
      to,
    });
    expect(text).not.toContain('unrelated');
  }
});
