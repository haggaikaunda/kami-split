import type { BankingReportFilter } from '@/lib/relay/__generated__/personalTransactionsQuery.graphql';
export const periods = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'last-60-days': 'Last 60 days',
  'last-90-days': 'Last 90 days',
  'year-to-date': 'Year to date',
  custom: 'Custom range',
} as const;
export type Period = keyof typeof periods;
export function appliedPeriod(params: Pick<URLSearchParams, 'get'>): Period {
  const value = params.get('period');
  return value && Object.hasOwn(periods, value)
    ? (value as Period)
    : 'this-month';
}
/** Source identity, never Relay's snapshot id, is the selected-row/detail key.
 * Archive and latest-discrepancy reads remain separate from canonical reporting. */
export function transactionSelection(params: Pick<URLSearchParams, 'get'>) {
  return {
    source: params.get('transaction'),
    archive: params.get('archive'),
    discrepancy: params.get('discrepancies') === 'true',
  };
}
export function reportFilter(params: URLSearchParams): BankingReportFilter {
  const period = appliedPeriod(params)
    .replaceAll('-', '_')
    .toUpperCase() as BankingReportFilter['period'];
  return {
    period,
    ...(period === 'CUSTOM'
      ? { start: params.get('start') ?? '', end: params.get('end') ?? '' }
      : {}),
    ...(params.get('archive')
      ? { archiveId: params.get('archive') }
      : { sourceDiscrepancies: params.get('discrepancies') === 'true' }),
    ...(params.get('account') ? { accountIds: [params.get('account')!] } : {}),
    ...(params.get('activity')
      ? { activities: [params.get('activity')!] }
      : {}),
    ...(params.get('category')
      ? { categories: [params.get('category')!] }
      : {}),
    ...(params.get('state') ? { states: [params.get('state')!] } : {}),
    ...(params.has('reviewed')
      ? { reviewed: params.get('reviewed') === 'true' }
      : {}),
    ...(params.has('excluded')
      ? { excluded: params.get('excluded') === 'true' }
      : {}),
  };
}
/** Every selection change starts a new signed traversal; cursors never enter URLs. */
export function personalHref(
  params: URLSearchParams,
  changes: Record<string, string | null>,
) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
  }
  next.delete('restore');
  return `/personal?${next}`;
}
export function validBankDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000'))
    return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
export function customDateError(start: string, end: string, today: string) {
  if (!validBankDate(start) || !validBankDate(end))
    return 'Enter real start and end dates in years 0001–9999.';
  if (start > end) return 'Start date must be on or before end date.';
  if (end > today)
    return 'End date must be on or before today in your saved reporting timezone.';
  return '';
}
/** Exact formatting preserves signed minor-unit strings without binary arithmetic. */
export function bankMoney(minor: string) {
  const amount = BigInt(minor);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '−' : ''}$${(absolute / 100n).toLocaleString('en-US')}.${(absolute % 100n).toString().padStart(2, '0')}`;
}
export function readable(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

/** Calendar display only: do not parse a bank date as a zoned instant. */
export function bankDateLabel(value: string, includeYear = true) {
  const [year, month, day] = value.split('-');
  const label = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ][Number(month) - 1];
  return label
    ? `${label} ${Number(day)}${includeYear ? `, ${year}` : ''}`
    : value;
}
