/** Routes use authorized source metadata; names never identify the Household. */
export type SpaceRoute = { id: string; isHousehold: boolean; kind?: string };
export function spaceHref(space: SpaceRoute) {
  return space.isHousehold
    ? '/household/ledger'
    : `${space.kind === 'TRIP' ? '/trips' : '/groups'}/${encodeURIComponent(space.id)}`;
}
export function spaceExpenseHref(space: SpaceRoute, expense: string) {
  return space.isHousehold
    ? `/household/ledger?${new URLSearchParams({ tab: 'expenses', expense })}`
    : `${spaceHref(space)}/expenses/${encodeURIComponent(expense)}`;
}
export function spaceRepaymentHref(space: SpaceRoute, query: URLSearchParams) {
  if (!space.isHousehold) return `${spaceHref(space)}/repayments/new?${query}`;
  return `/household/ledger?${new URLSearchParams({ tab: 'balances', repayment: '1', ...Object.fromEntries(query) })}`;
}
/** Preserve a legacy visit's ledger scope and panels during canonical replacement. */
export function householdLedgerHref(
  params: URLSearchParams,
  expense = '',
  repayment = false,
) {
  const next = new URLSearchParams(params);
  if (expense) {
    next.set('tab', 'expenses');
    next.set('expense', expense);
  }
  if (repayment) {
    next.set('tab', 'balances');
    next.set('repayment', '1');
  }
  return `/household/ledger${next.size ? `?${next}` : ''}`;
}
