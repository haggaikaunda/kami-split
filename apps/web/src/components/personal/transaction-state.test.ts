import { expect, it } from 'vitest';
import {
  bankMoney,
  customDateError,
  personalHref,
  reportFilter,
  transactionSelection,
  validBankDate,
} from './transaction-state';
it('validates inclusive real calendar dates without UTC reinterpretation or history clamping', () => {
  expect(validBankDate('2024-02-29')).toBe(true);
  for (const date of [
    '2023-02-29',
    '2026-04-31',
    '0000-01-01',
    '10000-01-01',
    '2026-13-01',
    '',
  ])
    expect(validBankDate(date)).toBe(false);
  expect(validBankDate('0001-01-01')).toBe(true);
  expect(customDateError('2024-02-29', '2024-02-29', '2026-01-01')).toBe('');
  expect(customDateError('2026-01-02', '2026-01-01', '2026-01-02')).toContain(
    'Start',
  );
  expect(customDateError('2026-01-01', '2026-01-03', '2026-01-02')).toContain(
    'timezone',
  );
});
it('combines current/archive filters and keeps selection keys independent of snapshots', () => {
  const params = new URLSearchParams(
    'period=custom&start=0001-01-01&end=2026-10-17&account=a&activity=transfer&state=pending&reviewed=false&excluded=true&category=UNCATEGORIZED&archive=manifest&discrepancies=true&transaction=source',
  );
  expect(reportFilter(params)).toEqual({
    period: 'CUSTOM',
    start: '0001-01-01',
    end: '2026-10-17',
    accountIds: ['a'],
    activities: ['transfer'],
    states: ['pending'],
    reviewed: false,
    excluded: true,
    categories: ['UNCATEGORIZED'],
    archiveId: 'manifest',
  });
  expect(transactionSelection(params)).toEqual({
    source: 'source',
    archive: 'manifest',
    discrepancy: true,
  });
  expect(personalHref(params, { transaction: null, archive: null })).toContain(
    'start=0001-01-01',
  );
  expect(reportFilter(new URLSearchParams('period=last-month'))).toMatchObject({
    period: 'LAST_MONTH',
  });
});
it('formats exact signed minor units including refund-heavy periods and the safe-money boundary', () => {
  expect(bankMoney('-4000')).toBe('−$40.00');
  expect(bankMoney('9007199254740991')).toBe('$90,071,992,547,409.91');
  expect(bankMoney('1')).toBe('$0.01');
});
