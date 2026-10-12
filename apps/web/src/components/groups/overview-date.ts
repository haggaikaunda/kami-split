import { calendarDate } from '@/lib/dates';
/** Present a stored calendar date without shifting it into the device time zone. */
export function overviewDate(
  value: string,
  month = false,
  includeYear = false,
) {
  return calendarDate(value, {
    month: month ? 'long' : 'short',
    year: month || includeYear ? 'numeric' : undefined,
    day: month ? undefined : 'numeric',
  });
}

/** Label the actual range of recent rows, which can span months or years. */
export function overviewPeriod(dates: readonly string[]) {
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))].sort();
  if (!months.length) return '';
  const first = overviewDate(`${months[0]}-01`, true);
  return months.length === 1
    ? first
    : `${first} – ${overviewDate(`${months.at(-1)}-01`, true)}`;
}
export function overviewSpansYears(dates: readonly string[]) {
  return new Set(dates.map((date) => date.slice(0, 4))).size > 1;
}
