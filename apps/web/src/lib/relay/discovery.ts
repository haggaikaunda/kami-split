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
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\u0000-\u0020\u007f]/.test(value)
  )
    return '/groups';
  const url = new URL(value, 'https://kami.invalid');
  const household = [
    '/household',
    '/household/expenses',
    '/household/activity',
    '/household/ledger',
  ].includes(url.pathname);
  const personal = url.pathname === '/personal';
  const creation = ['/groups/new', '/trips/new'].includes(url.pathname);
  const repayment = /^\/(?:groups|trips)\/[^/?#]+\/repayments\/new$/.test(
    url.pathname,
  );
  if (
    url.origin !== 'https://kami.invalid' ||
    url.hash ||
    !(
      household ||
      personal ||
      url.pathname === '/account' ||
      url.pathname === '/invitations' ||
      url.pathname === '/groups' ||
      url.pathname === '/trips' ||
      repayment ||
      creation ||
      /^\/(?:groups|trips)\/[^/?#]+(?:\/expenses\/[^/?#]+)?$/.test(url.pathname)
    )
  )
    return '/groups';
  const allowed = personal
    ? ['tab', 'period', 'from', 'to', 'category', 'status', 'account']
    : url.pathname === '/account'
      ? []
      : url.pathname === '/invitations'
        ? ['group']
        : household
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

/** Resolve a Group/Trip route, including nested records, without confusing global routes with IDs. */
export function groupRouteId(pathname: string) {
  const match = pathname.match(/^\/(?:groups|trips)\/([^/]+)(?:\/|$)/);
  if (!match) return;
  const id = routeId(match[1]);
  return id === 'activity' || id === 'new' ? undefined : id;
}
