'use client';
import financialStyles from './presentation.module.css';
import { cx } from '../ui/classnames';

import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { AppIcon } from '../workspace-identity';
import { Button, Member } from '../ui/primitives';
import { SpaceChip } from '../workspace/patterns';

/** The caller supplies exact domain-formatted text; this component never rounds money. */
export function Money({
  value,
  currency,
}: {
  value: string;
  currency: string;
}) {
  return (
    <span
      data-ui={`money${value.length > 14 ? ' money--long' : ''}`}
      className={cx(
        financialStyles['money'],
        value.length > 14 && financialStyles['money--long'],
      )}
      role={value.length > 14 ? 'group' : undefined}
      tabIndex={value.length > 14 ? 0 : undefined}
      aria-label={value.length > 14 ? `${value} ${currency}` : undefined}
    >
      <span data-ui="money-value" className={financialStyles['money-value']}>
        {value}
      </span>{' '}
      <span
        data-ui={`currency${currency === 'USD' && value.includes('$') ? ' currency--redundant' : ''}`}
        className={cx(
          financialStyles['currency'],
          currency === 'USD' &&
            value.includes('$') &&
            financialStyles['currency--redundant'],
        )}
      >
        {currency}
      </span>
    </span>
  );
}

export type ChartRow = {
  id: string;
  label: string;
  value: string;
  count: number;
  magnitude: number;
};

/** Magnitude affects geometry only; the exact domain-formatted value is always visible. */
export function ChartTable({
  title,
  currency,
  rows,
  onSelect,
}: {
  title: string;
  currency: string;
  rows: readonly ChartRow[];
  onSelect?: (id: string) => void;
}) {
  const maximum = Math.max(0, ...rows.map((row) => row.magnitude));
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-ui="chart form-region"
      className={financialStyles['chart']}
    >
      <h3 id={titleId}>{title}</h3>
      <div data-ui="bars" className={financialStyles['bars']}>
        {rows.map((row) => (
          <div
            key={row.id}
            data-ui="bar-row"
            className={financialStyles['bar-row']}
          >
            <span>{row.label}</span>
            <span
              data-ui="bar-track"
              className={financialStyles['bar-track']}
              aria-hidden="true"
            >
              <span
                style={{
                  width: `${maximum > 0 ? (Math.max(0, row.magnitude) / maximum) * 100 : 0}%`,
                }}
              />
            </span>
            {onSelect ? (
              <Button
                tone="secondary"
                onClick={() => onSelect(row.id)}
                aria-label={`${row.label}: ${row.value} ${currency}, ${row.count} expenses`}
              >
                <Money value={row.value} currency={currency} />
              </Button>
            ) : (
              <Money value={row.value} currency={currency} />
            )}
          </div>
        ))}
      </div>
      <div
        data-ui="table-scroll"
        className={financialStyles['table-scroll']}
        role="region"
        aria-label={`${title} exact values`}
        tabIndex={0}
      >
        <table>
          <caption>{title}: exact values</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Amount ({currency})</th>
              <th scope="col">Expenses</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.label}</th>
                <td>
                  <Money value={row.value} currency={currency} />
                </td>
                <td>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function SummaryMetric({
  label,
  children,
  detail,
  icon,
  tone,
}: {
  label: ReactNode;
  children: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  tone?: 'total' | 'net' | 'share';
}) {
  return (
    <div
      data-ui={`summary-metric${tone ? ` summary-metric--${tone}` : ''}`}
      className={cx(
        financialStyles['summary-metric'],
        tone && financialStyles[`summary-metric--${tone}`],
      )}
    >
      <div
        data-ui="metric-heading"
        className={financialStyles['metric-heading']}
      >
        {icon && (
          <span
            data-ui="metric-icon"
            className={financialStyles['metric-icon']}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <span data-ui="metric-label">{label}</span>
      </div>
      <strong
        data-ui="metric-value"
        className={financialStyles['metric-value']}
      >
        {children}
      </strong>
      {detail && (
        <span
          data-ui="metric-detail"
          className={financialStyles['metric-detail']}
        >
          {detail}
        </span>
      )}
    </div>
  );
}

/** Sign comes from exact domain arithmetic. The component never parses formatted money. */
export function SignedBalanceMetric({
  position,
  scope = 'group',
  label,
  value,
  currency,
  detail,
}: {
  position: 'positive' | 'negative' | 'zero';
  scope?: 'group' | 'household';
  label?: ReactNode;
  value: string;
  currency: string;
  detail?: ReactNode;
}) {
  return (
    <div
      data-ui={`signed-balance signed-balance--${position}`}
      className={cx(
        financialStyles['signed-balance'],
        financialStyles[`signed-balance--${position}`],
      )}
    >
      <SummaryMetric
        tone="net"
        icon={<AppIcon name="arrow-up-right" />}
        label={
          label ??
          (position === 'positive'
            ? "You're owed"
            : position === 'negative'
              ? 'You owe'
              : scope === 'household'
                ? 'Net zero across spaces'
                : 'Settled')
        }
        detail={detail}
      >
        <Money value={value} currency={currency} />
      </SummaryMetric>
    </div>
  );
}

/** A navigation row with visible source-space context and exact supplied money. */
export function ExpenseRow({
  href,
  description,
  metadata,
  space,
  value,
  currency,
}: {
  href: string;
  description: string;
  metadata: ReactNode;
  space: string;
  value: string;
  currency: string;
}) {
  return (
    <Link
      data-ui="expense-row"
      className={financialStyles['expense-row']}
      href={href}
    >
      <span>
        <strong>{description}</strong>
        <span data-ui="row-detail" className={financialStyles['row-detail']}>
          {metadata}
        </span>
        <SpaceChip>{space}</SpaceChip>
      </span>
      <Money value={value} currency={currency} />
    </Link>
  );
}

export function MonthSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      data-ui="month-section form-region"
      className={financialStyles['month-section']}
      aria-labelledby={id}
    >
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div
      data-ui="filter-bar"
      className={financialStyles['filter-bar']}
      role="group"
      aria-label="Expense filters"
    >
      {children}
    </div>
  );
}

export function BalanceSpaceRow({
  space,
  href,
  children,
}: {
  space: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <div data-ui="balance-row" className={financialStyles['balance-row']}>
      <Link href={href}>
        <SpaceChip>{space}</SpaceChip>
      </Link>
      <div>{children}</div>
    </div>
  );
}

export function MemberBalanceRow({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <div data-ui="balance-row" className={financialStyles['balance-row']}>
      <Member name={name} />
      <div>{children}</div>
    </div>
  );
}

/** Only callers with an explicit group and counterparty may offer settlement entry. */
export function RecommendedRepaymentRow({
  group,
  sender,
  recipient,
  value,
  currency,
  action,
}: {
  group: string;
  sender: string;
  recipient: string;
  value: string;
  currency: string;
  action?: ReactNode;
}) {
  return (
    <div data-ui="repayment-row" className={financialStyles['repayment-row']}>
      <div>
        <strong>
          {sender} pays {recipient}
        </strong>
        <span data-ui="row-detail" className={financialStyles['row-detail']}>
          {group}
        </span>
      </div>
      <Money value={value} currency={currency} />
      {action}
    </div>
  );
}
