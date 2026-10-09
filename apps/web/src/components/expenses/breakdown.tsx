'use client';
import { useState } from 'react';
import { AppIcon } from '@/components/workspace-identity';
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
function categoryName(value: string) {
  return value[0] + value.slice(1).toLowerCase();
}
/** Two arcs per edge also represent a single category covering the full circle. */
export function categoryPath(start: number, length: number) {
  const outer = 169.1,
    inner = 105.64;
  const angle = (percent: number) =>
    (percent / 100) * Math.PI * 2 - Math.PI / 2;
  const point = (radius: number, percent: number) =>
    `${190 + Math.cos(angle(percent)) * radius},${190 + Math.sin(angle(percent)) * radius}`;
  const middle = start + length / 2,
    end = start + length;
  return `M${point(outer, start)} A${outer},${outer} 0 0 1 ${point(outer, middle)} A${outer},${outer} 0 0 1 ${point(outer, end)} L${point(inner, end)} A${inner},${inner} 0 0 0 ${point(inner, middle)} A${inner},${inner} 0 0 0 ${point(inner, start)} Z`;
}
function categorySectors(
  categories: readonly CategoryTotal[],
  basis: 'total' | 'share',
  total: bigint,
) {
  let offset = 0n;
  return categories
    .map((category) => ({
      ...category,
      amount: minor(
        basis === 'share'
          ? category.viewerShareMinor
          : category.totalExpenseMinor,
      ),
    }))
    .sort((a, b) =>
      a.amount === b.amount
        ? a.category.localeCompare(b.category)
        : a.amount > b.amount
          ? -1
          : 1,
    )
    .map((category) => {
      const start = categoryGeometry(offset, total);
      offset += category.amount;
      return {
        ...category,
        start,
        length: categoryGeometry(offset, total) - start,
      };
    });
}
export function ExpenseBreakdown({
  categories,
  context = 'Across your spaces',
  totalExpenseMinor,
  viewerShareMinor,
  expenseCount,
  basis,
  onBasis,
  onViewExpenses,
}: {
  categories: readonly CategoryTotal[];
  context?: string;
  totalExpenseMinor: string;
  viewerShareMinor: string;
  expenseCount: string;
  basis: 'total' | 'share';
  onBasis: (basis: 'total' | 'share') => void;
  onViewExpenses: (category: string | null) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const total = minor(basis === 'share' ? viewerShareMinor : totalExpenseMinor);
  const sectors = categorySectors(categories, basis, total);
  const selection = sectors.find((sector) => sector.category === selected);
  const choose = (category: string) =>
    setSelected(selected === category ? null : category);
  return (
    <section className="expense-breakdown" aria-label="Spending by category">
      <header>
        <div>
          <h2>Spending by category</h2>
          <p>{context} · USD</p>
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
              <svg viewBox="0 0 380 380" aria-hidden="true">
                {total === 0n && (
                  <circle
                    cx="190"
                    cy="190"
                    r="137.37"
                    fill="none"
                    stroke="var(--color-subtle)"
                    strokeWidth="63.46"
                  />
                )}
                {sectors
                  .filter((sector) => sector.amount > 0n)
                  .map((sector) => {
                    const angle =
                      ((sector.start + sector.length / 2) / 100) * Math.PI * 2 -
                      Math.PI / 2;
                    const active = selection?.category === sector.category;
                    return (
                      <g
                        key={sector.category}
                        transform={
                          active
                            ? `translate(${Math.cos(angle) * 6} ${Math.sin(angle) * 6})`
                            : undefined
                        }
                        opacity={selection && !active ? 0.55 : 1}
                      >
                        <path
                          className={`breakdown-sector breakdown-category--${sector.category.toLowerCase()}`}
                          data-selected={active}
                          d={categoryPath(sector.start, sector.length)}
                          onClick={() => choose(sector.category)}
                        />
                        {sector.amount * 100n >= total * 8n && (
                          <text
                            className="breakdown-slice-label"
                            x={190 + Math.cos(angle) * 137.37}
                            y={190 + Math.sin(angle) * 137.37}
                          >
                            {`${(sector.amount * 100n + total / 2n) / total}%`}
                          </text>
                        )}
                      </g>
                    );
                  })}
              </svg>
              <div className="breakdown-center" aria-live="polite">
                <span>
                  {selection
                    ? categoryName(selection.category)
                    : basis === 'share'
                      ? 'Your share'
                      : 'Total expenses'}
                </span>
                <Money
                  value={money((selection?.amount ?? total).toString())}
                  currency="USD"
                />
                <small>
                  {selection?.expenseCount ?? expenseCount} expenses
                </small>
              </div>
            </div>
            <ul
              className="breakdown-legend"
              aria-label="Category amounts and percentages"
            >
              {sectors.map((sector) => (
                <li key={sector.category}>
                  <button
                    aria-pressed={selection?.category === sector.category}
                    onClick={() => choose(sector.category)}
                  >
                    <span
                      className={`breakdown-legend-dot breakdown-category--${sector.category.toLowerCase()}`}
                    />
                    <span className="breakdown-legend-label">
                      {categoryName(sector.category)}
                    </span>
                    <span className="breakdown-legend-amount">
                      <Money
                        value={money(sector.amount.toString())}
                        currency="USD"
                      />
                      <small>
                        {categoryPercentage(sector.amount, total)} ·{' '}
                        {sector.expenseCount} expenses
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="breakdown-drilldown">
            <span>
              {selection ? categoryName(selection.category) : 'All categories'}
            </span>
            <button onClick={() => onViewExpenses(selection?.category ?? null)}>
              View expenses <AppIcon name="arrow-right" />
            </button>
          </div>
          <p className="breakdown-rounding">
            Percentages are rounded to one decimal place and may not add to
            100%. Counts include matching expenses with zero viewer share.
          </p>
        </>
      )}
    </section>
  );
}
