'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { AppIcon } from '@/components/workspace-identity';
import { Button } from '../ui/primitives';
import { Money } from '../financial/presentation';
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
export function categoryPath(start: number, length: number, size = 380) {
  const outer = size * 0.445,
    inner = size * 0.278;
  const angle = (percent: number) =>
    (percent / 100) * Math.PI * 2 - Math.PI / 2;
  const point = (radius: number, percent: number) =>
    `${size / 2 + Math.cos(angle(percent)) * radius},${size / 2 + Math.sin(angle(percent)) * radius}`;
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
  const noteId = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const chart = useRef<HTMLDivElement>(null);
  const [chartSize, setChartSize] = useState(380);
  useEffect(() => {
    const element = chart.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const width = Math.round(element.getBoundingClientRect().width);
      if (width > 0) setChartSize(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [expenseCount]);
  const total = minor(basis === 'share' ? viewerShareMinor : totalExpenseMinor);
  const sectors = categorySectors(categories, basis, total);
  const roundedPercentages =
    total > 0n &&
    sectors.some((sector) => (sector.amount * 1000n) % total !== 0n);
  const shareCountNote = basis === 'share' && BigInt(expenseCount) > 0n;
  const hasNote = roundedPercentages || shareCountNote;
  const selection = sectors.find((sector) => sector.category === selected);
  const choose = (category: string) =>
    setSelected(selected === category ? null : category);
  return (
    <>
      <section
        className="expense-breakdown"
        aria-label="Spending by category"
        aria-describedby={hasNote ? noteId : undefined}
      >
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
              <div className="breakdown-chart" ref={chart}>
                <svg
                  viewBox={`0 0 ${chartSize} ${chartSize}`}
                  aria-hidden="true"
                >
                  {total === 0n && (
                    <circle
                      cx={chartSize / 2}
                      cy={chartSize / 2}
                      r={chartSize * 0.3615}
                      fill="none"
                      stroke="var(--color-subtle)"
                      strokeWidth={chartSize * 0.167}
                    />
                  )}
                  {sectors
                    .filter((sector) => sector.amount > 0n)
                    .map((sector) => {
                      const angle =
                        ((sector.start + sector.length / 2) / 100) *
                          Math.PI *
                          2 -
                        Math.PI / 2;
                      const active = selection?.category === sector.category;
                      return (
                        <g key={sector.category}>
                          <path
                            transform={
                              active
                                ? `translate(${Math.cos(angle) * 6} ${Math.sin(angle) * 6})`
                                : undefined
                            }
                            opacity={selection && !active ? 0.55 : 1}
                            className={`breakdown-sector breakdown-category--${sector.category.toLowerCase()}`}
                            data-selected={active}
                            d={categoryPath(
                              sector.start,
                              sector.length,
                              chartSize,
                            )}
                            onClick={() => choose(sector.category)}
                          />
                          {sector.amount * 100n >= total * 8n && (
                            <text
                              className="breakdown-slice-label"
                              x={
                                chartSize / 2 +
                                Math.cos(angle) * chartSize * 0.3615
                              }
                              y={
                                chartSize / 2 +
                                Math.sin(angle) * chartSize * 0.3615 +
                                4
                              }
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
                {selection
                  ? `${categoryName(selection.category)} · ${categoryPercentage(selection.amount, total)} of this view`
                  : 'All categories'}
              </span>
              <Button
                tone="text"
                onClick={() => onViewExpenses(selection?.category ?? null)}
              >
                View expenses <AppIcon name="arrow-right" />
              </Button>
            </div>
          </>
        )}
      </section>
      {hasNote && (
        <p className="breakdown-rounding" id={noteId}>
          {roundedPercentages &&
            'Percentages are rounded to one decimal place and may not add to 100%.'}
          {roundedPercentages && shareCountNote && ' '}
          {shareCountNote &&
            'Counts include all matching expenses, including any with zero viewer share.'}
        </p>
      )}
    </>
  );
}
