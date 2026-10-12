import { expect, it } from 'vitest';
import { datePreset, expenseFilter, expenseFilterText } from './expense-filter';

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
      categories: ['DINING'],
      memberIds: [],
      paidByIds: [],
      sort: 'DATE_DESC',
      from,
      to,
    });
    expect(text).not.toContain('unrelated');
  }
});

it('canonicalizes all values and legacy aliases without losing a second selection', () => {
  const params = new URLSearchParams(
    'categories=DINING&categories=GROCERIES&category=DINING&memberIds=b&memberIds=a&memberId=a&paidByIds=b&sort=AMOUNT_ASC',
  );
  const filter = expenseFilter(expenseFilterText(params));
  expect(filter).toMatchObject({
    categories: ['DINING', 'GROCERIES'],
    memberIds: ['a', 'b'],
    paidByIds: ['b'],
    sort: 'AMOUNT_ASC',
  });
  expect(expenseFilterText(params)).toBe(
    expenseFilterText(
      new URLSearchParams(
        'sort=AMOUNT_ASC&memberIds=a&memberIds=b&paidByIds=b&categories=GROCERIES&categories=DINING',
      ),
    ),
  );
});
it('uses inclusive calendar presets across leap days, DST and year boundaries', () => {
  expect(datePreset('2026-01-03', 'last7')).toEqual({
    from: '2025-12-28',
    to: '2026-01-03',
  });
  expect(datePreset('2024-03-01', 'previousMonth')).toEqual({
    from: '2024-02-01',
    to: '2024-02-29',
  });
  expect(datePreset('2026-03-08', 'today')).toEqual({
    from: '2026-03-08',
    to: '2026-03-08',
  });
  expect(datePreset('2026-03-08', 'month')).toEqual({
    from: '2026-03-01',
    to: '2026-03-08',
  });
});
