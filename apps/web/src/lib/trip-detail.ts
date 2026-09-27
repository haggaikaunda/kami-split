import type { ExpenseRecord, Snapshot } from './data/port';
import { checkedSum, positions, spending } from './ledger';
export function tripDetail(snapshot: Snapshot, tripId: string) {
  const trip = snapshot.trips.find((row) => row.id === tripId);
  if (!trip) return undefined;
  const currency = snapshot.household.currency;
  const facts = spending(snapshot.expenses, { currency, tripId });
  return {
    trip,
    currency,
    ...facts,
    positions: positions(
      snapshot.members.map((row) => row.id),
      facts.expenses,
      [],
      currency,
    ),
  };
}
export type TripDetail = NonNullable<ReturnType<typeof tripDetail>>;
export type TripExpenseFilters = { search: string; category: string };
/** Effective dates determine groups; revisions and repayments never enter this list. */
export function tripExpenseGroups(
  expenses: readonly ExpenseRecord[],
  filters: TripExpenseFilters,
) {
  const search = filters.search.trim().toLowerCase();
  const selected = expenses.filter(
    (row) =>
      !row.deleted &&
      row.description.toLowerCase().includes(search) &&
      (filters.category === 'all' || row.category === filters.category),
  );
  const days = [...new Set(selected.map((row) => row.effectiveDate))]
    .sort()
    .reverse();
  return days.map((date) => {
    const rows = selected
      .filter((row) => row.effectiveDate === date)
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      );
    return {
      date,
      expenses: rows,
      total: checkedSum(rows.map((row) => row.amount)),
    };
  });
}
