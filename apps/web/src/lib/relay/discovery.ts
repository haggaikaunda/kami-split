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
  const household = [
    '/household',
    '/household/expenses',
    '/household/activity',
    '/household/ledger',
  ].includes(url.pathname);
  const creation = ['/groups/new', '/trips/new'].includes(url.pathname);
  const repayment = /^\/(?:groups|trips)\/[^/?#]+\/repayments\/new$/.test(
    url.pathname,
  );
  if (
    url.origin !== 'https://kami.invalid' ||
    url.hash ||
    !(
      household ||
      url.pathname === '/groups' ||
      url.pathname === '/trips' ||
      repayment ||
      creation ||
      /^\/(?:groups|trips)\/[^/?#]+(?:\/expenses\/[^/?#]+)?$/.test(url.pathname)
    )
  )
    return '/groups';
  const allowed = household
    ? [
        'tab',
        'expense',
        'repayment',
        'sender',
        'recipient',
        'amount',
        'category',
        'memberId',
        'from',
        'to',
        'after',
        'groupId',
        'kind',
      ]
    : creation
      ? ['kind']
      : repayment
        ? ['sender', 'recipient', 'amount']
        : ['tab'];
  if ([...url.searchParams.keys()].some((k) => !allowed.includes(k)))
    return '/groups';
  return url.pathname + url.search;
}

/** Normalize Next route params once; client transitions may retain escaped typed-ID colons. */
export function routeId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    // Invalid path input still goes through the ordinary safe server not-found boundary.
    return value;
  }
}
