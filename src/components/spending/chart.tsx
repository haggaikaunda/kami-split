'use client';
import { formatMoney } from '@/lib/ledger';
import type { Currency } from '@/lib/ledger';
import type { SpendingBucket } from '@/lib/spending-chart';
import { Button } from '../primitives';
/** Exact values remain domain integers; ratios affect only visual bar geometry. */
export function SpendingChart({
  title,
  namespace,
  rows,
  currency,
  tableOpen,
  onTableChange,
  onSelect,
  horizontal = false,
  disabled = false,
}: {
  title: string;
  namespace: string;
  rows: readonly SpendingBucket[];
  currency: Currency;
  tableOpen: boolean;
  onTableChange: () => void;
  onSelect: (id: string, triggerId: string) => void;
  horizontal?: boolean;
  disabled?: boolean;
}) {
  const maximum = Math.max(0, ...rows.map((row) => row.total));
  const tableId = `${namespace}-data`;
  return (
    <section className="spending-plot" aria-label={title}>
      <div className="spending-scale">
        <span>Scale: 0 to {formatMoney(maximum, currency)}</span>
        <span>Expenses only</span>
      </div>
      <div
        className="spending-scroll"
        role="region"
        aria-label={`${title} bars; scroll for all periods`}
        tabIndex={0}
      >
        <div
          className={horizontal ? 'spending-horizontal' : 'spending-columns'}
          style={
            horizontal
              ? undefined
              : { minWidth: `${Math.max(18, rows.length * 4.5)}rem` }
          }
        >
          {rows.map((row) => {
            const id = `${namespace}-bar-${encodeURIComponent(row.id)}`;
            const percent = maximum === 0 ? 0 : (row.total / maximum) * 100;
            return (
              <button
                type="button"
                id={id}
                className="spending-bar-button"
                key={row.id}
                disabled={disabled}
                aria-label={`${row.label}: ${formatMoney(row.total, currency)}, ${row.count} ${row.count === 1 ? 'expense' : 'expenses'}. Inspect records`}
                onClick={() => onSelect(row.id, id)}
              >
                <span className="spending-bar-space" aria-hidden="true">
                  <span
                    className="spending-bar-fill"
                    style={
                      horizontal
                        ? { width: `${percent}%` }
                        : { height: `${percent}%` }
                    }
                  />
                </span>
                <span className="spending-bar-label">
                  {horizontal ? row.label : row.shortLabel}
                </span>
                {horizontal && (
                  <span className="ui-money">
                    {formatMoney(row.total, currency)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {!rows.length && <p>No categories have recorded expenses yet.</p>}
      <p className="ui-hint">
        Select any bar to inspect its records, including periods with no
        expenses.
      </p>
      <Button
        tone="secondary"
        aria-expanded={tableOpen}
        aria-controls={tableId}
        disabled={disabled}
        onClick={onTableChange}
      >
        {tableOpen ? 'Hide exact data' : 'View exact data'} for{' '}
        {title.toLowerCase()}
      </Button>
      {tableOpen && (
        <div
          id={tableId}
          className="ui-table-scroll"
          role="region"
          aria-label={`${title} exact data`}
          tabIndex={0}
        >
          <table>
            <caption>
              {title} · exact amounts in {currency}
            </caption>
            <thead>
              <tr>
                <th scope="col">Period or category</th>
                <th scope="col">Amount</th>
                <th scope="col">Expenses</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = `${namespace}-table-${encodeURIComponent(row.id)}`;
                return (
                  <tr key={row.id}>
                    <th scope="row">
                      <Button
                        id={id}
                        tone="secondary"
                        disabled={disabled}
                        aria-label={`Inspect ${row.label}: ${formatMoney(row.total, currency)}, ${row.count} expenses`}
                        onClick={() => onSelect(row.id, id)}
                      >
                        {row.label}
                      </Button>
                    </th>
                    <td className="ui-money">
                      {formatMoney(row.total, currency)}
                    </td>
                    <td>{row.count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
