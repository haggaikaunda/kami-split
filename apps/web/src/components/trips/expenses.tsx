'use client';
import type { ExpenseRecord, Snapshot } from '@/lib/data/port';
import { CATEGORIES } from '@/lib/data/mock';
import { checkedSum, formatMoney } from '@/lib/ledger';
import { tripExpenseGroups, type TripExpenseFilters } from '@/lib/trip-detail';
import { tripDateLabel } from '@/lib/trips';
import { ExpenseLink } from '../navigation/links';
import { Button, EmptyState, Field, SelectField } from '../primitives';
export function TripExpenses({
  snapshot,
  expenses,
  filters,
  active,
  change,
}: {
  snapshot: Snapshot;
  expenses: readonly ExpenseRecord[];
  filters: TripExpenseFilters;
  active: boolean;
  change: (values: Partial<TripExpenseFilters>) => void;
}) {
  const groups = tripExpenseGroups(expenses, filters);
  const filtered = !!filters.search || filters.category !== 'all';
  const knownCategory =
    filters.category === 'all' ||
    CATEGORIES.some((category) => category === filters.category);
  return (
    <section aria-label="Trip expenses">
      <div className="trip-expense-filters">
        <Field
          id="trip-expense-search"
          label="Search trip expenses"
          placeholder="Search descriptions…"
          value={filters.search}
          disabled={!active}
          onChange={(event) => change({ search: event.target.value })}
        />
        <SelectField
          id="trip-expense-category"
          label="Expense category"
          value={filters.category}
          disabled={!active}
          onChange={(event) => change({ category: event.target.value })}
        >
          <option value="all">All categories</option>
          {CATEGORIES.map((category) => (
            <option key={category}>{category}</option>
          ))}
          {!knownCategory && (
            <option value={filters.category}>
              Unavailable category filter
            </option>
          )}
        </SelectField>
      </div>
      {filtered && (
        <Button
          tone="secondary"
          disabled={!active}
          onClick={() => {
            change({ search: '', category: 'all' });
            document.getElementById('trip-expense-search')?.focus();
          }}
        >
          Clear expense filters
        </Button>
      )}
      <h2 id="trip-expenses-heading" tabIndex={-1}>
        Trip expenses
      </h2>
      <p role="status">
        {groups.reduce((count, group) => count + group.expenses.length, 0)} of{' '}
        {expenses.length} expenses ·{' '}
        {formatMoney(
          checkedSum(groups.map((group) => group.total)),
          snapshot.household.currency,
        )}{' '}
        shown
      </p>
      {groups.length ? (
        groups.map((group) => (
          <section key={group.date} aria-label={tripDateLabel(group.date)}>
            <div className="trip-day-heading">
              <h3>
                <time dateTime={group.date}>{tripDateLabel(group.date)}</time>
              </h3>
              <strong className="ui-money">
                {formatMoney(group.total, snapshot.household.currency)}
              </strong>
            </div>
            <ul className="trip-expense-list">
              {group.expenses.map((expense) => {
                const payer =
                  snapshot.members.find(
                    (member) => member.id === expense.payerId,
                  )?.name ?? 'Former member';
                const own = expense.allocations.find(
                  (row) => row.memberId === snapshot.actorId,
                );
                return (
                  <li key={expense.id}>
                    <ExpenseLink
                      expenseId={expense.id}
                      id={`trip-expense-${expense.id}`}
                    >
                      <span className="trip-expense-description">
                        <strong>{expense.description}</strong>
                        <span>
                          {payer} paid · {expense.category}
                        </span>
                      </span>
                      <span className="trip-expense-amount">
                        <strong className="ui-money">
                          {formatMoney(expense.amount, expense.currency)}
                        </strong>
                        <span>
                          {expense.participantIds.includes(snapshot.actorId)
                            ? `Your share ${formatMoney(own?.amount ?? 0, expense.currency)}`
                            : 'You are not an included participant'}
                        </span>
                      </span>
                    </ExpenseLink>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      ) : (
        <EmptyState
          title={
            filtered ? 'No expenses match these filters' : 'No expenses yet'
          }
        >
          {filtered
            ? 'Change or clear the filters to see other trip expenses.'
            : 'Add the first shared expense for this trip.'}
        </EmptyState>
      )}
    </section>
  );
}
