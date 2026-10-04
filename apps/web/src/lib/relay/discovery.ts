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
