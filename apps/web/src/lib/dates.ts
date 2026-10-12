/** Today's calendar date on this device; evaluate when creating a new draft. */
export function localCalendarDate(now = new Date()) {
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Strict Gregorian date-only validation, including leap days. */
export function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000'))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/** Format a date-only value in UTC solely to preserve its calendar components. */
export function calendarDate(
  value: string,
  options: Intl.DateTimeFormatOptions = {},
) {
  if (!validCalendarDate(value)) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options,
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

/** Actual instants use one explicit UTC display policy across the application. */
export function timestamp(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(value));
}
