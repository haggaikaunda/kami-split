'use client';
import { useState } from 'react';
import { CategoryIcon } from '@/components/workspace-identity';
import { Money } from '@/components/primitives';
import { minor, money } from '@/lib/relay/money';

export type CategoryTotal = {
  readonly category: string;
  readonly totalExpenseMinor: string;
  readonly viewerShareMinor: string;
  readonly expenseCount: string;
};
export function categoryPercentage(amount: bigint, total: bigint) {
  if (!total) return '0.0%';
  const tenths = (amount * 1000n + total / 2n) / total;
  if (amount > 0n && tenths === 0n) return '<0.1%';
  return `${tenths / 10n}.${tenths % 10n}%`;
}
/** Only the final normalized chart geometry crosses into floating point. */
export function categoryGeometry(amount: bigint, total: bigint) {
  return total > 0n ? Number((amount * 1000000000n) / total) / 10000000 : 0;
}
export function ExpenseBreakdown({
  categories,
  totalExpenseMinor,
  viewerShareMinor,
  expenseCount,
  basis,
  onBasis,
  onViewExpenses,
}: {
  categories: readonly CategoryTotal[];
  totalExpenseMinor: string;
  viewerShareMinor: string;
  expenseCount: string;
  basis: 'total' | 'share';
  onBasis: (basis: 'total' | 'share') => void;
  onViewExpenses: (category: string | null) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const total = minor(basis === 'share' ? viewerShareMinor : totalExpenseMinor);
  const sectors = categories.map((category, index) => {
    const amount = minor(
      basis === 'share'
        ? category.viewerShareMinor
        : category.totalExpenseMinor,
    );
    const offset = categories
      .slice(0, index)
      .reduce(
        (sum, preceding) =>
          sum +
          minor(
            basis === 'share'
              ? preceding.viewerShareMinor
              : preceding.totalExpenseMinor,
          ),
        0n,
      );
    const start = categoryGeometry(offset, total);
    return {
      ...category,
      amount,
      start,
      length: categoryGeometry(amount, total),
    };
  });
  return (
    <section className="expense-breakdown" aria-label="Spending by category">
      <header>
        <div>
          <h2>Spending by category</h2>
          <p>Complete filtered expenses · USD</p>
        </div>
        <label>
          Show{' '}
          <select
            aria-label="Chart amount"
            value={basis}
            onChange={(event) =>
              onBasis(event.target.value === 'share' ? 'share' : 'total')
            }
          >
            <option value="total">Total expenses</option>
            <option value="share">Your share</option>
          </select>
        </label>
      </header>
      {expenseCount === '0' ? (
        <p>No expenses match these filters.</p>
      ) : (
        <>
          {total === 0n && (
            <p>Your share is zero for these matching expenses.</p>
          )}
          <div className="breakdown-content">
            <div className="breakdown-chart">
              <svg viewBox="0 0 240 240" aria-hidden="true">
                <circle
                  cx="120"
                  cy="120"
                  r="92"
                  fill="none"
                  stroke="var(--color-subtle)"
                  strokeWidth="30"
                />
                {total > 0n &&
                  sectors
                    .filter((sector) => sector.amount > 0n)
                    .map((sector) => (
                      <circle
                        key={sector.category}
                        className={`breakdown-sector breakdown-category--${sector.category.toLowerCase()}`}
                        data-selected={selected === sector.category}
                        cx="120"
                        cy="120"
                        r="92"
                        pathLength="100"
                        fill="none"
                        strokeWidth="30"
                        strokeDasharray={`${sector.length} ${100 - sector.length}`}
                        strokeDashoffset={-sector.start}
                        transform={
                          selected === sector.category
                            ? `translate(${Math.cos(((sector.start + sector.length / 2) / 100) * Math.PI * 2 - Math.PI / 2) * 3} ${Math.sin(((sector.start + sector.length / 2) / 100) * Math.PI * 2 - Math.PI / 2) * 3}) rotate(-90 120 120)`
                            : 'rotate(-90 120 120)'
                        }
                      />
                    ))}
              </svg>
              <div className="breakdown-center">
                <span>
                  {basis === 'share' ? 'Your share' : 'Total expenses'}
                </span>
                <Money value={money(total.toString())} currency="USD" />
                <span>{expenseCount} matching expenses</span>
              </div>
            </div>
            <ul
              className="breakdown-legend"
              aria-label="Category amounts and percentages"
            >
              {sectors.map((sector) => (
                <li key={sector.category}>
                  <button
                    aria-pressed={selected === sector.category}
                    onClick={() =>
                      setSelected(
                        selected === sector.category ? null : sector.category,
                      )
                    }
                  >
                    <CategoryIcon category={sector.category} />
                    <span>
                      <strong>
                        {sector.category[0] +
                          sector.category.slice(1).toLowerCase()}
                      </strong>
                      <span>
                        {categoryPercentage(sector.amount, total)} ·{' '}
                        {sector.expenseCount} matching expenses
                      </span>
                    </span>
                    <Money
                      value={money(sector.amount.toString())}
                      currency="USD"
                    />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <p className="breakdown-rounding">
            Percentages are rounded to one decimal place and may not add to
            100%. Counts include matching expenses with zero viewer share.
          </p>
          <div className="breakdown-drilldown">
            <span aria-live="polite">
              {selected
                ? selected[0] + selected.slice(1).toLowerCase()
                : 'All categories'}
            </span>
            <button onClick={() => onViewExpenses(selected)}>
              View expenses
            </button>
          </div>
        </>
      )}
    </section>
  );
}
