'use client';
import { useEffect, useState } from 'react';
import { fetchQuery } from 'relay-runtime';
import document, {
  type journeyExpenseQuery,
} from '@/lib/relay/__generated__/journeyExpenseQuery.graphql';
import type { FinancialScope } from '@/lib/relay/environment';
import { money } from '@/lib/relay/money';
type Expense = Extract<
  NonNullable<journeyExpenseQuery['response']['node']>,
  { readonly __typename: 'Expense' }
>;
export function ExpenseDetail({
  scope,
  group,
  id,
  onUnavailable,
}: {
  scope: FinancialScope;
  group: string;
  id: string;
  onUnavailable?: () => void;
}) {
  const [expense, setExpense] = useState<Expense>();
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    const subscription = fetchQuery<journeyExpenseQuery>(
      scope.environment,
      document,
      { id },
      { fetchPolicy: 'network-only' },
    ).subscribe({
      next(result) {
        if (!active || !scope.isLive()) return;
        // Do not render any fields until both canonical IDs match.
        if (
          result.node?.__typename === 'Expense' &&
          result.node.id === id &&
          result.node.groupId === group
        )
          setExpense(result.node);
        else {
          setFailed(true);
          onUnavailable?.();
        }
      },
      error() {
        if (active && scope.isLive()) {
          setFailed(true);
          onUnavailable?.();
        }
      },
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
    // The owning list invalidates on failure; request identity owns the lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, group, id, version]);
  if (failed)
    return (
      <>
        <p role="alert">
          Expense unavailable. No expense details can be shown.
        </p>
        <button
          onClick={() => {
            setFailed(false);
            setExpense(undefined);
            setVersion((v) => v + 1);
          }}
        >
          Retry expense
        </button>
      </>
    );
  if (!expense) return <p role="status">Loading authorized expense…</p>;
  return (
    <section>
      <h2>{expense.description}</h2>
      <p>
        {money(expense.totalMinor)} {expense.currency} ·{' '}
        <time dateTime={expense.effectiveDate}>{expense.effectiveDate}</time> ·{' '}
        {expense.category}
      </p>
      <p>Paid by {expense.payer.displayName}</p>
      <p>{expense.note}</p>
      <p>
        Created by {expense.creator.displayName} ·{' '}
        <time dateTime={expense.createdAt}>
          {expense.createdAt.replace('T', ' ').replace('Z', ' UTC')}
        </time>
      </p>
      <ul>
        {expense.allocations.map((share) => (
          <li key={share.participant.id}>
            {share.participant.displayName}: {money(share.amountMinor)}
          </li>
        ))}
      </ul>
    </section>
  );
}
