/** Present a stored calendar date without shifting it into the device time zone. */
export function overviewDate(value: string, month = false) {
  return new Intl.DateTimeFormat('en-US', {
    month: month ? 'long' : 'short',
    ...(month ? { year: 'numeric' as const } : { day: 'numeric' as const }),
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}
