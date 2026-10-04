/** Server UTC dates compare lexically; status never limits ledger reads. */
export function tripState(
  trip: { startDate: string; endDate: string },
  today: string,
) {
  return today < trip.startDate
    ? 'Upcoming'
    : today > trip.endDate
      ? 'Past'
      : 'In progress';
}
export function groupHref(id: string) {
  return `/groups/${encodeURIComponent(id)}`;
}

/** Only internal financial routes may survive sign-in; never an external redirect. */
export function financialReturn(value: string | null) {
  return value &&
    (value === '/groups' ||
      value === '/trips' ||
      /^\/groups\/[^/?#]+(?:\/expenses\/[^/?#]+)?$/.test(value))
    ? value
    : '/groups';
}
