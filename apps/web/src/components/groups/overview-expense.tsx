'use client';
import Link from 'next/link';
import { createSessionId } from '@/lib/session-id';
import { useSearchParams, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import type { FinancialScope } from '@/lib/relay/environment';
import { ExpenseDetail } from './expense-detail';
import { ExpensePresentation } from '@/components/expenses/presentation';

/** Keep the overview mounted; modified clicks retain the canonical direct URL. */
export function OverviewExpenseLink({
  scope,
  href,
  id,
  group,
  children,
}: {
  scope: FinancialScope;
  href: string;
  id: string;
  group: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <Link
      id={`expense-${id}`}
      href={href}
      onNavigate={(event) => {
        event.preventDefault();
        const url = new URL(window.location.href);
        const token = createSessionId();
        scope.visits.set(token, {
          href: url.pathname + url.search,
          focus: `expense-${id}`,
          scroll: window.scrollY,
          group,
        });
        url.searchParams.set('detailSource', token);
        url.searchParams.set('expense', id);
        url.searchParams.set('expenseGroup', group);
        router.push(url.pathname + url.search, { scroll: false });
      }}
    >
      {children}
    </Link>
  );
}

/** Details always reauthorize their original source, including direct selections. */
export function OverviewExpense({
  scope,
  allowed,
  onCommitted,
  onUnavailable,
}: {
  scope: FinancialScope;
  allowed: readonly string[];
  onCommitted: () => Promise<void>;
  onUnavailable: () => void;
}) {
  const params = useSearchParams(),
    router = useRouter();
  const id = params.get('expense'),
    group = params.get('expenseGroup') ?? allowed[0];
  if (!id || !group) return null;
  return (
    <ExpensePresentation
      title="Expense detail"
      onClose={() => {
        const token = params.get('detailSource');
        if (token && scope.visits.has(token)) {
          router.back();
          return;
        }
        const url = new URL(window.location.href);
        url.searchParams.delete('detailSource');
        url.searchParams.delete('expense');
        url.searchParams.delete('expenseGroup');
        router.replace(url.pathname + url.search, { scroll: false });
      }}
    >
      {allowed.includes(group) ? (
        <ExpenseDetail
          key={`${group}:${id}`}
          scope={scope}
          group={group}
          id={id}
          onCommitted={onCommitted}
          onUnavailable={onUnavailable}
        />
      ) : (
        <p role="alert">
          Expense source is unavailable. Refresh to check current access.
        </p>
      )}
    </ExpensePresentation>
  );
}
