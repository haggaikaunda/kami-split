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
  if (!value || !value.startsWith('/') || value.startsWith('//'))
    return '/groups';
  const url = new URL(value, 'https://kami.invalid');
  const repayment = /^\/groups\/[^/?#]+\/repayments\/new$/.test(url.pathname);
  if (
    url.origin !== 'https://kami.invalid' ||
    url.hash ||
    !(
      url.pathname === '/groups' ||
      url.pathname === '/trips' ||
      repayment ||
      /^\/groups\/[^/?#]+(?:\/expenses\/[^/?#]+)?$/.test(url.pathname)
    )
  )
    return '/groups';
  const allowed = repayment ? ['sender', 'recipient', 'amount'] : ['tab'];
  if ([...url.searchParams.keys()].some((k) => !allowed.includes(k)))
    return '/groups';
  return url.pathname + url.search;
}
